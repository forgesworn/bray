/**
 * nostrconnect:// pairing (NIP-46, client-initiated).
 *
 * bray makes a fresh client key and a one-time secret, shows a
 * `nostrconnect://` URI for the user to paste or scan into their signer app,
 * and waits for the signer to answer on the chosen relays with that secret.
 * The signer's reply tells bray which pubkey to talk to. bray then saves:
 *
 * - the client key, under the signer's pubkey in `client-keys.json`, so every
 *   later start presents the key the signer approved;
 * - a `bunker://` URI with no secret in `bunker-uri`, marked `paired`, so the
 *   MCP server and CLI use the signer without BUNKER_URI.
 *
 * The secret is single-use, so it is never saved. A paired signer is not sent
 * `connect` again on later starts (see BunkerContext.establish).
 */

import { BunkerSigner, createNostrConnectURI, toBunkerURL } from 'nostr-tools/nip46'
import { getConversationKey, decrypt } from 'nostr-tools/nip44'
import type { SubCloser } from 'nostr-tools/abstract-pool'
import { SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { EventTemplate } from 'nostr-tools'
import { CLIENT_NAME, CLIENT_KEYS_FILE, REQUEST_TIMEOUT_MS, TimeoutError, withTimeout } from './bunker-context.js'
import { readStateFile, writeStateFile } from './state.js'
import { isOnionUrl, validateRelayScheme } from './validation.js'

/** Saved by `bunker connect` and `bunker pair`; read by loadConfig. */
export const BUNKER_URI_FILE = 'bunker-uri'

/** NIP-46 request and response events. */
const NOSTR_CONNECT_KIND = 24133

/** How long to try to reach each relay before leaving it out. */
const CONNECT_WAIT_MS = 10_000

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Show the URI after this long even if a relay has not confirmed the subscription. */
const LISTEN_WAIT_MS = 5_000

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** How long to wait for the signer to answer, by default: five minutes. */
export const PAIR_TIMEOUT_MS = 5 * 60_000

export interface PairOptions {
  /** Relays the signer should answer on. At least one. */
  relays: string[]
  /** Give up after this long. Default {@link PAIR_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Accept ws:// relays on private addresses (BRAY_ALLOW_PRIVATE_RELAYS=1). */
  allowPrivateRelays?: boolean
  /** Called with the nostrconnect:// URI once bray is listening for the answer. */
  onUri: (uri: string) => void
  /**
   * Called with the account npub the signer will sign as, before anything is
   * saved. Return false to discard the pairing. Anyone who sees the URI can
   * answer it, so the caller should show the npub and have the user confirm.
   */
  confirm?: (npub: string) => Promise<boolean>
  /** Called for each relay that could not be reached; pairing goes ahead on the rest. */
  onRelayUnreachable?: (relay: string, reason: string) => void
  /** TOR_PROXY: when set, clearnet relays are refused unless allowed. */
  torProxy?: string
  /** ALLOW_CLEARNET_WITH_TOR=1. */
  allowClearnetWithTor?: boolean
  /** Override the state directory (tests). */
  stateDir?: string
}

export interface PairResult {
  /** The account the signer signs as. */
  npub: string
  /** The signer's transport pubkey (hex), which may differ from the account. */
  signerPubkey: string
  relays: string[]
  /** The saved bunker:// URI. It carries no secret. */
  bunkerUri: string
}

/** Thrown when the user declines the account a signer offered. */
export class PairingDeclinedError extends Error {
  constructor(npub: string) {
    super(`pairing discarded: ${npub} was not confirmed`)
    this.name = 'PairingDeclinedError'
  }
}

/** Wait for a signer to pair with bray over nostrconnect://, then save it. */
export async function pairWithNostrConnect(options: PairOptions): Promise<PairResult> {
  const relays = [...new Set(options.relays.map(r => r.trim()).filter(Boolean))]
  if (relays.length === 0) {
    throw new Error('pairing needs at least one relay for the signer to answer on')
  }
  for (const relay of relays) {
    if (!/^wss?:\/\//i.test(relay)) throw new Error(`not a relay URL: ${relay.slice(0, 128)}`)
    validateRelayScheme(relay, options.allowPrivateRelays ?? false)
  }
  // Pairing connects directly, not through the SOCKS proxy, so with Tor
  // configured only .onion relays are allowed unless clearnet is allowed.
  if (options.torProxy && !options.allowClearnetWithTor) {
    const clearnet = relays.filter(r => !isOnionUrl(r))
    if (clearnet.length > 0) {
      throw new Error(`TOR_PROXY is set: pairing would reach clearnet relays directly. Use .onion relays or set ALLOW_CLEARNET_WITH_TOR=1: ${clearnet.join(', ').slice(0, 256)}`)
    }
  }

  const clientSk = generateSecretKey()
  const clientPk = getPublicKey(clientSk)
  const secret = randomBytes(16).toString('hex')

  // Answer NIP-42 challenges with the client key, as BunkerContext does.
  const pool = new SimplePool()
  pool.automaticallyAuth = () => async (template: EventTemplate) => finalizeEvent(template, clientSk)

  const timeoutMs = options.timeoutMs ?? PAIR_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let sub: SubCloser | undefined
  let signer: BunkerSigner | undefined
  try {
    // Connect before showing anything, and offer the signer only the relays
    // bray can actually listen on.
    const attempts = await Promise.allSettled(
      relays.map(relay => pool.ensureRelay(relay, { connectionTimeout: CONNECT_WAIT_MS })),
    )
    const reachable = relays.filter((_relay, i) => attempts[i].status === 'fulfilled')
    attempts.forEach((attempt, i) => {
      if (attempt.status === 'rejected') options.onRelayUnreachable?.(relays[i], reasonText(attempt.reason))
    })
    if (reachable.length === 0) {
      throw new Error(`could not reach any relay: ${relays.join(', ').slice(0, 256)}`)
    }
    const uri = createNostrConnectURI({
      clientPubkey: clientPk,
      relays: reachable,
      secret,
      name: CLIENT_NAME,
    })

    // Listen for the signer's answer ourselves, rather than through
    // BunkerSigner.fromURI, so the URI is shown only once the relays have
    // confirmed the subscription (EOSE). The filter asks only for new events,
    // so an answer that reached a relay before then would be lost. fromURI's
    // timeout also never fires: its maxWait only bounds EOSE.
    let listening!: () => void
    const ready = new Promise<void>(resolve => { listening = resolve })
    const answered = new Promise<string>((resolve, reject) => {
      sub = pool.subscribe(reachable, { kinds: [NOSTR_CONNECT_KIND], '#p': [clientPk], limit: 0 }, {
        // Fire oneose even if a relay never sends EOSE.
        maxWait: LISTEN_WAIT_MS,
        oneose: () => listening(),
        onevent: event => {
          // The pool has checked the event's signature. Anyone may send one,
          // so ignore whatever does not decrypt to the right secret.
          try {
            const reply = JSON.parse(decrypt(event.content, getConversationKey(clientSk, event.pubkey))) as { result?: unknown }
            if (typeof reply.result === 'string' && sameSecret(reply.result, secret)) resolve(event.pubkey)
          } catch { /* not for us */ }
        },
        onclose: reasons => reject(new Error(reasons.map(r => `${r.url}: ${r.reason}`).join('; ') || 'subscription closed')),
      })
    })
    answered.catch(() => { /* reported by the races below */ })
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutError('timeout')), timeoutMs)
    })

    let signerPubkey: string
    try {
      await Promise.race([ready, answered, timedOut])
      options.onUri(uri)
      signerPubkey = await Promise.race([answered, timedOut])
    } catch (e) {
      if (e instanceof TimeoutError) {
        throw new Error(`no signer answered within ${Math.round(timeoutMs / 1000)}s`)
      }
      throw new Error(`could not listen on the relays: ${(e as Error).message}`)
    }
    sub?.close()
    sub = undefined

    // The signer has approved this client key; talk to it as a paired bunker.
    signer = BunkerSigner.fromBunker(clientSk, { pubkey: signerPubkey, relays: reachable, secret: null }, { pool })
    const account = await withTimeout(signer.getPublicKey(), REQUEST_TIMEOUT_MS, 'bunker get_public_key')
    const npub = npubEncode(account)
    if (options.confirm && !(await options.confirm(npub))) {
      throw new PairingDeclinedError(npub)
    }

    // The signer approved this client key: keep it for the next start. It
    // replaces any key bray held for this signer pubkey before.
    const keys = readStateFile<Record<string, string>>(CLIENT_KEYS_FILE, options.stateDir)
    keys[signerPubkey] = Buffer.from(clientSk).toString('hex')
    writeStateFile(CLIENT_KEYS_FILE, keys, options.stateDir)

    const bunkerUri = toBunkerURL({ pubkey: signerPubkey, relays: reachable, secret: null })
    writeStateFile(BUNKER_URI_FILE, { uri: bunkerUri, paired: true }, options.stateDir)

    return { npub, signerPubkey, relays: reachable, bunkerUri }
  } finally {
    clearTimeout(timer)
    sub?.close()
    try { await signer?.close() } catch { /* already closed */ }
    pool.destroy()
    clientSk.fill(0)
  }
}
