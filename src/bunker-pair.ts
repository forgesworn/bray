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
import { SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { randomBytes } from 'node:crypto'
import type { EventTemplate } from 'nostr-tools'
import { CLIENT_NAME, CLIENT_KEYS_FILE, REQUEST_TIMEOUT_MS, withTimeout } from './bunker-context.js'
import { readStateFile, writeStateFile } from './state.js'
import { validateRelayScheme } from './validation.js'

/** Saved by `bunker connect` and `bunker pair`; read by loadConfig. */
export const BUNKER_URI_FILE = 'bunker-uri'

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

  const clientSk = generateSecretKey()
  const secret = randomBytes(16).toString('hex')
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSk),
    relays,
    secret,
    name: CLIENT_NAME,
  })

  // Answer NIP-42 challenges with the client key, as BunkerContext does.
  const pool = new SimplePool()
  pool.automaticallyAuth = () => async (template: EventTemplate) => finalizeEvent(template, clientSk)

  let signer: BunkerSigner | undefined
  try {
    // Subscribe before showing the URI, so a fast signer cannot answer first.
    // skipSwitchRelays: switchRelays() would change the relays after this
    // resolves; the relays the user chose are the ones pairing worked over.
    // fromURI's numeric maxWait only bounds the wait for EOSE and never closes
    // the subscription, so it would wait for ever. An abort signal closes it.
    const timeoutMs = options.timeoutMs ?? PAIR_TIMEOUT_MS
    const abort = new AbortController()
    const pending = BunkerSigner.fromURI(clientSk, uri, { pool, skipSwitchRelays: true }, abort.signal)
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      options.onUri(uri)
      signer = await withTimeout(pending, timeoutMs + 5_000, 'nostrconnect pairing')
    } catch (e) {
      abort.abort()
      throw new Error(`no signer answered within ${Math.round(timeoutMs / 1000)}s (${(e as Error).message})`)
    } finally {
      clearTimeout(timer)
    }

    const signerPubkey = signer.bp.pubkey
    const account = await withTimeout(signer.getPublicKey(), REQUEST_TIMEOUT_MS, 'bunker get_public_key')

    // The signer approved this client key: keep it for the next start.
    const keys = readStateFile<Record<string, string>>(CLIENT_KEYS_FILE, options.stateDir)
    keys[signerPubkey] = Buffer.from(clientSk).toString('hex')
    writeStateFile(CLIENT_KEYS_FILE, keys, options.stateDir)

    const bunkerUri = toBunkerURL({ pubkey: signerPubkey, relays, secret: null })
    writeStateFile(BUNKER_URI_FILE, { uri: bunkerUri, paired: true }, options.stateDir)

    return { npub: npubEncode(account), signerPubkey, relays, bunkerUri }
  } finally {
    try { await signer?.close() } catch { /* already closed */ }
    pool.destroy()
    clientSk.fill(0)
  }
}
