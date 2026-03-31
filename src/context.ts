import { fromNsec, fromMnemonic, derive, zeroise } from 'nsec-tree'
import { derivePersona } from 'nsec-tree/persona'
import { createBlindProof, createFullProof } from 'nsec-tree/proof'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { decode, npubEncode, nsecEncode } from 'nostr-tools/nip19'
import type { TreeRoot, Identity, LinkageProof } from 'nsec-tree'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { PublicIdentity, SignFn } from './types.js'
import type { ExtendedSigningContext } from './signing-context.js'

interface CacheEntry {
  identity: Identity
  purpose: string
  index: number
  personaName?: string
  lastUsed: number
}

/** Build an Identity-compatible object from raw key bytes */
function rawIdentity(privateKey: Uint8Array): Identity {
  const publicKeyHex = getPublicKey(privateKey)
  const publicKey = Buffer.from(publicKeyHex, 'hex')
  return {
    nsec: nsecEncode(privateKey),
    npub: npubEncode(publicKeyHex),
    privateKey: new Uint8Array(privateKey), // copy so original can be cleaned
    publicKey: new Uint8Array(publicKey),
    purpose: 'master',
    index: 0,
  }
}

export interface ContextOptions {
  maxCache?: number
}

export class IdentityContext implements ExtendedSigningContext {
  private root: TreeRoot
  private cache = new Map<string, CacheEntry>()
  private masterEntry: CacheEntry
  private activeEntry: CacheEntry
  private maxCacheSize: number

  constructor(secretKey: string, format: 'nsec' | 'hex' | 'mnemonic', opts?: ContextOptions) {
    this.maxCacheSize = opts?.maxCache ?? 5

    // Parse the raw secret key bytes — this IS the user's actual Nostr identity
    let rawKeyBytes: Uint8Array
    if (format === 'mnemonic') {
      // Mnemonic: create tree root, derive a "default" identity as master
      this.root = fromMnemonic(secretKey)
      const derived = derive(this.root, 'master', 0)
      this.masterEntry = { identity: derived, purpose: 'master', index: 0, lastUsed: Date.now() }
      this.activeEntry = this.masterEntry
      return
    } else if (format === 'hex') {
      rawKeyBytes = Buffer.from(secretKey, 'hex')
    } else {
      // nsec bech32
      rawKeyBytes = decode(secretKey).data as Uint8Array
    }

    // Master identity = the user's actual keypair (their real npub)
    this.masterEntry = {
      identity: rawIdentity(rawKeyBytes),
      purpose: 'master',
      index: 0,
      lastUsed: Date.now(),
    }
    this.activeEntry = this.masterEntry

    // nsec-tree root for child derivation
    this.root = fromNsec(rawKeyBytes)
  }

  /** Current active identity's npub (bech32) */
  get activeNpub(): string {
    return this.activeEntry.identity.npub
  }

  /** Current active identity's hex public key — use this in relay filters */
  get activePublicKeyHex(): string {
    return Buffer.from(this.activeEntry.identity.publicKey).toString('hex')
  }

  /** Derive a child identity by purpose and index */
  async derive(purpose: string, index: number): Promise<PublicIdentity> {
    // Return from cache if already derived
    for (const [npub, entry] of this.cache) {
      if (entry.purpose === purpose && entry.index === index && !entry.personaName) {
        entry.lastUsed = Date.now()
        return { npub, purpose, index }
      }
    }

    const identity = derive(this.root, purpose, index)
    const entry: CacheEntry = {
      identity,
      purpose,
      index,
      lastUsed: Date.now(),
    }
    this.putCache(identity.npub, entry)
    return { npub: identity.npub, purpose, index }
  }

  /** Derive a named persona */
  async derivePersona(name: string, index: number): Promise<PublicIdentity> {
    // Return from cache if already derived
    for (const [npub, entry] of this.cache) {
      if (entry.personaName === name && entry.index === index) {
        entry.lastUsed = Date.now()
        return { npub, purpose: entry.purpose, index: entry.index, personaName: name }
      }
    }

    const persona = derivePersona(this.root, name, index)
    const entry: CacheEntry = {
      identity: persona.identity,
      purpose: persona.identity.purpose,
      index: persona.index,
      personaName: name,
      lastUsed: Date.now(),
    }
    this.putCache(persona.identity.npub, entry)
    return {
      npub: persona.identity.npub,
      purpose: persona.identity.purpose,
      index: persona.index,
      personaName: name,
    }
  }

  /** Switch active identity by purpose+index, persona name, or "master" */
  async switch(purposeOrName: string, index?: number): Promise<void> {
    if (purposeOrName === 'master') {
      this.activeEntry = this.masterEntry
      this.masterEntry.lastUsed = Date.now()
      return
    }

    // Check cache for matching purpose or persona name
    for (const [, entry] of this.cache) {
      const matchesPurpose = entry.purpose === purposeOrName && (index === undefined || entry.index === index)
      const matchesPersona = entry.personaName === purposeOrName && (index === undefined || entry.index === index)
      if (matchesPurpose || matchesPersona) {
        entry.lastUsed = Date.now()
        this.activeEntry = entry
        return
      }
    }

    // Not in cache — derive on the fly
    const identity = derive(this.root, purposeOrName, index ?? 0)
    const entry: CacheEntry = {
      identity,
      purpose: purposeOrName,
      index: index ?? 0,
      lastUsed: Date.now(),
    }
    this.putCache(identity.npub, entry)
    this.activeEntry = entry
  }

  /** Get a signing function bound to the current active identity */
  getSigningFunction(): SignFn {
    return async (template: EventTemplate): Promise<NostrEvent> => {
      return finalizeEvent(template, this.activeEntry.identity.privateKey) as unknown as NostrEvent
    }
  }

  /** NIP-44 encrypt using the active identity's key. */
  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    const { getConversationKey, encrypt } = await import('nostr-tools/nip44')
    const ck = getConversationKey(this.activePrivateKey, recipientPubkey)
    return encrypt(plaintext, ck)
  }

  /** NIP-44 decrypt using the active identity's key. */
  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    const { getConversationKey, decrypt } = await import('nostr-tools/nip44')
    const ck = getConversationKey(this.activePrivateKey, senderPubkey)
    return decrypt(ciphertext, ck)
  }

  /** List all known identities — returns public info only, never private keys */
  async listIdentities(): Promise<PublicIdentity[]> {
    const result: PublicIdentity[] = [
      { npub: this.masterEntry.identity.npub, purpose: 'master', index: 0 },
    ]
    for (const [, entry] of this.cache) {
      result.push({
        npub: entry.identity.npub,
        purpose: entry.purpose,
        index: entry.index,
        personaName: entry.personaName,
      })
    }
    return result
  }

  /** Create a linkage proof for the active identity.
   *  Only works for derived identities — the master IS the raw key, not a tree child. */
  async prove(mode: 'blind' | 'full' = 'blind'): Promise<LinkageProof> {
    if (this.activeEntry === this.masterEntry) {
      throw new Error('Cannot prove master identity — it is the raw key, not a derived child. Switch to a derived identity first.')
    }
    const child = this.activeEntry.identity
    if (mode === 'full') {
      return createFullProof(this.root, child)
    }
    return createBlindProof(this.root, child)
  }

  /** Recover identities by scanning derived keys for known purposes. */
  async recover(lookahead?: number): Promise<PublicIdentity[]> {
    const { recover: recoverIdentities } = await import('nsec-tree')
    const defaultPurposes = ['messaging', 'signing', 'social', 'commerce', 'master']
    const range = lookahead ?? 20
    const recoveredMap = recoverIdentities(this.root, defaultPurposes, range)
    const result: PublicIdentity[] = []
    for (const [, identities] of recoveredMap) {
      for (const identity of identities) {
        const entry: CacheEntry = {
          identity,
          purpose: identity.purpose,
          index: identity.index,
          lastUsed: Date.now(),
        }
        this.putCache(identity.npub, entry)
        result.push({ npub: identity.npub, purpose: identity.purpose, index: identity.index })
      }
    }
    return result
  }

  /** Get the nsec-tree root's master pubkey (the derivation anchor, distinct from the raw key's pubkey) */
  get treeRootPubkey(): string {
    return this.root.masterPubkey
  }

  /** Get the active identity's private key for NIP-17/44/04 crypto operations */
  get activePrivateKey(): Uint8Array {
    return this.activeEntry.identity.privateKey
  }

  /** Test helper — returns reference to private key bytes for verifying zeroise */
  _getPrivateKeyRefForTesting(npub: string): Uint8Array | undefined {
    if (this.masterEntry.identity.npub === npub) return this.masterEntry.identity.privateKey
    const entry = this.cache.get(npub)
    return entry?.identity.privateKey
  }

  /** Destroy all identities and the tree root */
  destroy(): void {
    zeroise(this.masterEntry.identity)
    for (const [, entry] of this.cache) {
      zeroise(entry.identity)
    }
    this.cache.clear()
    this.root.destroy()
  }

  /** Insert into LRU cache, evicting oldest if at capacity */
  private putCache(npub: string, entry: CacheEntry): void {
    if (this.cache.has(npub)) {
      this.cache.set(npub, entry)
      return
    }

    if (this.cache.size >= this.maxCacheSize) {
      let oldestNpub: string | undefined
      let oldestTime = Infinity
      for (const [n, e] of this.cache) {
        // Never evict the active identity
        if (n === this.activeEntry.identity.npub) continue
        if (e.lastUsed < oldestTime) {
          oldestTime = e.lastUsed
          oldestNpub = n
        }
      }
      if (oldestNpub) {
        const evicted = this.cache.get(oldestNpub)!
        zeroise(evicted.identity)
        this.cache.delete(oldestNpub)
      }
    }

    this.cache.set(npub, entry)
  }
}
