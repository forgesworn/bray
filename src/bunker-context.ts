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

  protected constructor(signer: BunkerSigner, pool: SimplePool, clientSk: Uint8Array) {
    this.signer = signer
    this.pool = pool
    this.clientSk = clientSk
  }

  /** Connect to a remote bunker. Blocks until the connection is established. */
  static async connect(uri: string, _timeoutMs = 15_000): Promise<BunkerContext> {
    const config = parseBunkerUri(uri)
    const clientSk = resolveClientKey(config)
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

    // Connect and verify
    await signer.connect()
    await signer.ping()

    const ctx = new BunkerContext(signer, pool, clientSk)
    ctx.pubkeyHex = await signer.getPublicKey()
    return ctx
  }

  /** The remote identity's npub */
  get activeNpub(): string {
    return npubEncode(this.pubkeyHex!)
  }

  /** The remote identity's hex pubkey */
  get activePublicKeyHex(): string {
    return this.pubkeyHex!
  }

  /** Sign an event via the remote bunker */
  getSigningFunction(): SignFn {
    return async (template: EventTemplate): Promise<NostrEvent> => {
      return this.signer.signEvent(template) as unknown as NostrEvent
    }
  }

  /** List identities — bunker mode only has one (the remote key) */
  async listIdentities(): Promise<PublicIdentity[]> {
    return [{ npub: this.activeNpub, purpose: 'bunker', index: 0 }]
  }

  /** NIP-44 encrypt via the remote bunker */
  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    return this.signer.nip44Encrypt(recipientPubkey, plaintext)
  }

  /** NIP-44 decrypt via the remote bunker */
  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    return this.signer.nip44Decrypt(senderPubkey, ciphertext)
  }

  /** Clean up */
  destroy(): void {
    this.signer.close()
    this.pool.destroy()
    this.clientSk.fill(0)
  }
}
