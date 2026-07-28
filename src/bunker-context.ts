/**
 * BunkerContext — an IdentityContext-compatible interface backed by a NIP-46 bunker.
 *
 * Instead of holding the secret key locally, all signing is delegated to a
 * remote bunker via encrypted Nostr relay messages.
 *
 * Usage:
 *   BUNKER_URI=bunker://<pubkey>?relay=wss://...&relay=wss://...&secret=<pairing-nonce>
 *
 * A bunker URI can list multiple relays; all of them are used. The
 * `secret=` parameter is a NIP-46 pairing nonce (proof-of-URI-possession)
 * that the client echoes to the signer on the initial `connect` request,
 * and is NOT a private key.
 */

import { BunkerSigner } from 'nostr-tools/nip46'
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import { generateSecretKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import WebSocket from 'ws'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { PublicIdentity, SignFn } from './types.js'
import type { SigningContext } from './signing-context.js'
import { readStateFile, writeStateFile } from './state.js'

useWebSocketImplementation(WebSocket)

/** Bound the NIP-46 connect handshake. nostr-tools' BunkerSigner has no
 *  per-request timeout, so an offline signer or unreachable relays make the
 *  connect hang forever. */
const CONNECT_TIMEOUT_MS = 15_000
/** Bound individual signer round-trips (sign_event, get_public_key, nip44). */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Reject if `promise` does not settle within `ms`. Converts a silent NIP-46
 * hang into a catchable error so callers can fail fast or retry with backoff
 * instead of wedging -- which, at startup under an MCP health check, becomes a
 * respawn loop that floods the signer.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export interface BunkerConfig {
  pubkey: string
  /**
   * All relays declared in the URI. A bunker URI can (and usually does)
   * list several relays for redundancy; every one must be tried since the
   * remote signer is listening on all of them. Earlier versions of this
   * parser only read the first `?relay=` parameter and discarded the
   * rest, which could produce a silent hang if the first relay was down.
   */
  relays: string[]
  /**
   * NIP-46 pairing nonce from the URI's `?secret=` parameter. This is
   * NOT a private key. It is a proof-of-URI-possession token that the
   * client must echo back to the signer in its first `connect` request
   * so the signer knows the client received the URI out-of-band. Any
   * client with the URI can present this value; after the first
   * `connect` the signer TOFU-approves the client for crypto methods
   * and the nonce is not needed again for that specific client.
   *
   * Earlier versions of this interface named this field `secret` without
   * the distinction and the code then used it as a client private key,
   * which was both a hang (wrong client identity, remote signer rejected
   * the unknown client) and a security bug (any URI-holder could
   * impersonate the client on the wire). Do not do that.
   */
  connectSecret?: string
}

/** Parse a bunker:// URI */
export function parseBunkerUri(uri: string): BunkerConfig {
  // bunker://<pubkey>?relay=<url>&relay=<url>...&secret=<hex>
  const url = new URL(uri)
  const pubkey = url.hostname || url.pathname.replace('//', '')
  const relays = url.searchParams.getAll('relay')
  const connectSecret = url.searchParams.get('secret') ?? undefined
  if (!pubkey) {
    throw new Error('Invalid bunker URI: missing pubkey')
  }
  if (relays.length === 0) {
    throw new Error('Invalid bunker URI: missing relay parameter(s)')
  }
  return { pubkey, relays, connectSecret }
}

/** Client name shown on remote-signer approval screens (e.g. Heartwood's OLED). */
export const CLIENT_NAME = 'nostr-bray'

/**
 * Params for the NIP-46 `connect` request:
 * `[remote_pubkey, secret, permissions, metadata]`.
 * The metadata name is self-asserted UX for signer approval screens —
 * not authentication. The connect secret remains the security boundary.
 */
export function buildConnectParams(config: BunkerConfig): string[] {
  return [config.pubkey, config.connectSecret ?? '', '', JSON.stringify({ name: CLIENT_NAME })]
}

const CLIENT_KEYS_FILE = 'client-keys.json'

/**
 * Resolve the client secret key for a given bunker.
 *
 * Caches a freshly-generated client key per bunker pubkey so that repeat
 * invocations against the same bunker reuse the same client identity,
 * letting the remote signer's TOFU approval persist across reconnects
 * without needing a fresh button press each time.
 *
 * Critically, the URI's `connectSecret` is NEVER used as a client
 * private key here. It's a public pairing nonce (see BunkerConfig docs)
 * and using it as a key would leak the client identity to anyone who
 * has the URI.
 */
export function resolveClientKey(
  config: BunkerConfig,
  stateDir?: string,
): Uint8Array {
  const cache = readStateFile<Record<string, string>>(CLIENT_KEYS_FILE, stateDir)
  if (cache[config.pubkey]) {
    return Buffer.from(cache[config.pubkey], 'hex')
  }

  const sk = generateSecretKey()
  cache[config.pubkey] = Buffer.from(sk).toString('hex')
  writeStateFile(CLIENT_KEYS_FILE, cache, stateDir)
  return sk
}

export class BunkerContext implements SigningContext {
  protected signer: BunkerSigner
  protected pool: SimplePool
  protected pubkeyHex: string | undefined
  private clientSk: Uint8Array
  private config: ReturnType<typeof parseBunkerUri>

  protected constructor(
    signer: BunkerSigner,
    pool: SimplePool,
    clientSk: Uint8Array,
    config: ReturnType<typeof parseBunkerUri>,
  ) {
    this.signer = signer
    this.pool = pool
    this.clientSk = clientSk
    this.config = config
  }

  /**
   * Construct a BunkerContext WITHOUT performing the network handshake.
   * Lets a caller bring its process up immediately and connect in the
   * background (see {@link establish}), so a slow or unreachable signer
   * cannot wedge startup. Under an MCP stdio health check that respawns
   * "failed to connect" servers, a wedged startup turns a flaky signer into
   * a respawn loop that floods the bunker with `connect` requests.
   */
  static create(uri: string, stateDir?: string): BunkerContext {
    const config = parseBunkerUri(uri)
    const clientSk = resolveClientKey(config, stateDir)
    const pool = new SimplePool()

    const signer = BunkerSigner.fromBunker(
      clientSk,
      {
        pubkey: config.pubkey,
        relays: config.relays,
        // The URI pairing nonce -- gets echoed in the `connect` call so
        // the remote signer can TOFU-approve this client. If omitted the
        // signer will still accept the connect but every subsequent
        // request will require a manual approval on the signer side.
        secret: config.connectSecret ?? null,
      },
      { pool },
    )

    // Do NOT use config.pubkey as the identity -- it is the bunker's
    // transport key from the URI, not the signing identity. The actual
    // identity pubkey is resolved lazily via resolvePublicKey().
    // The parsed config is retained so establish() can send the connect
    // handshake with its client-name metadata.
    return new BunkerContext(signer, pool, clientSk, config)
  }

  /**
   * Perform the NIP-46 `connect` handshake, bounded by `timeoutMs`.
   *
   * nostr-tools' BunkerSigner has no per-request timeout, so a signer that is
   * offline or whose relays are unreachable makes `signer.connect()` hang
   * forever. We race it against a timer and reject on expiry so the caller can
   * retry with backoff. Ping is redundant (a successful connect proves the
   * signer is alive) and getPublicKey is deferred to first access.
   */
  async establish(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    // Sent via sendRequest (not signer.connect()) so params[3] can carry the
    // client-name metadata that signer approval screens display. nostr-tools'
    // connect() is literally sendRequest('connect', [pubkey, secret]);
    // semantics are otherwise identical.
    await withTimeout(
      this.signer.sendRequest('connect', buildConnectParams(this.config)),
      timeoutMs,
      'bunker connect',
    )
  }

  /** Connect to a remote bunker. Blocks until the connection is established. */
  static async connect(
    uri: string,
    timeoutMs = CONNECT_TIMEOUT_MS,
    stateDir?: string,
  ): Promise<BunkerContext> {
    const ctx = BunkerContext.create(uri, stateDir)
    try {
      await ctx.establish(timeoutMs)
    } catch (e) {
      ctx.destroy()
      throw e
    }
    return ctx
  }

  /**
   * Resolve the signing identity pubkey from the remote bunker.
   * Called lazily on first access so startup stays fast (no extra
   * NIP-46 round-trip). The result is cached for subsequent calls.
   */
  async resolvePublicKey(): Promise<string> {
    if (!this.pubkeyHex) {
      this.pubkeyHex = await withTimeout(
        this.signer.getPublicKey(),
        REQUEST_TIMEOUT_MS,
        'bunker get_public_key',
      )
    }
    return this.pubkeyHex
  }

  /** The remote identity's npub */
  get activeNpub(): string {
    if (!this.pubkeyHex) {
      throw new Error('pubkey not yet resolved — call resolvePublicKey() first')
    }
    return npubEncode(this.pubkeyHex)
  }

  /** The remote identity's hex pubkey */
  get activePublicKeyHex(): string {
    if (!this.pubkeyHex) {
      throw new Error('pubkey not yet resolved — call resolvePublicKey() first')
    }
    return this.pubkeyHex
  }

  /** Sign an event via the remote bunker */
  getSigningFunction(): SignFn {
    return async (template: EventTemplate): Promise<NostrEvent> => {
      return withTimeout(
        this.signer.signEvent(template) as unknown as Promise<NostrEvent>,
        REQUEST_TIMEOUT_MS,
        'bunker sign_event',
      )
    }
  }

  /** List identities — bunker mode only has one (the remote key) */
  async listIdentities(): Promise<PublicIdentity[]> {
    return [{ npub: this.activeNpub, purpose: 'bunker', index: 0 }]
  }

  /** NIP-44 encrypt via the remote bunker */
  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    return withTimeout(
      this.signer.nip44Encrypt(recipientPubkey, plaintext),
      REQUEST_TIMEOUT_MS,
      'bunker nip44_encrypt',
    )
  }

  /** NIP-44 decrypt via the remote bunker */
  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    return withTimeout(
      this.signer.nip44Decrypt(senderPubkey, ciphertext),
      REQUEST_TIMEOUT_MS,
      'bunker nip44_decrypt',
    )
  }

  /** Clean up */
  destroy(): void {
    this.signer.close()
    this.pool.destroy()
    this.clientSk.fill(0)
  }
}
