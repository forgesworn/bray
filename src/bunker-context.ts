/**
 * BunkerContext — an IdentityContext-compatible interface backed by a NIP-46 bunker.
 *
 * Instead of holding the secret key locally, all signing is delegated to a
 * remote bunker via encrypted Nostr relay messages.
 *
 * Usage:
 *   BUNKER_URI=bunker://pk?relay=wss://...
 *   or
 *   BUNKER_URI=bunker://pk?relay=wss://...&secret=clienthex
 */

import { BunkerSigner } from 'nostr-tools/nip46'
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import WebSocket from 'ws'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { PublicIdentity, SignFn } from './types.js'
import type { SigningContext } from './signing-context.js'

useWebSocketImplementation(WebSocket)

export interface BunkerConfig {
  pubkey: string
  relays: string[]
  secret?: string  // client secret key hex
}

/** Parse a bunker:// URI */
export function parseBunkerUri(uri: string): BunkerConfig {
  // bunker://<pubkey>?relay=<url>&relay=<url>&secret=<hex>
  const url = new URL(uri)
  const pubkey = url.hostname || url.pathname.replace('//', '')
  const relays = url.searchParams.getAll('relay')
  const secret = url.searchParams.get('secret') ?? undefined
  if (!pubkey || relays.length === 0) {
    throw new Error('Invalid bunker URI: missing pubkey or relay')
  }
  return { pubkey, relays, secret }
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
  static async connect(uri: string, timeoutMs = 15_000): Promise<BunkerContext> {
    const config = parseBunkerUri(uri)
    const clientSk = config.secret
      ? Buffer.from(config.secret, 'hex')
      : generateSecretKey()
    const pool = new SimplePool()

    const signer = BunkerSigner.fromBunker(
      clientSk,
      { pubkey: config.pubkey, relays: config.relays, secret: null },
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
