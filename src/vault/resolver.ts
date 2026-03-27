import { getCurrentEpochId } from 'dominion-protocol'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'

export interface VaultAccess {
  vaultTiers: string[]
  theirVaultTiers: string[]
  canDecrypt: boolean
  currentEpoch: string
  revoked: boolean
}

interface DominionConfig {
  tiers: Record<string, string[]>
  individualGrants: Array<{ pubkey: string; label: string }>
  revokedPubkeys: string[]
}

interface CacheItem {
  access: VaultAccess
  storedAt: number
  lastAccess: number
}

interface VaultResolverOptions {
  ttl: number
  maxEntries: number
}

export class VaultResolver {
  private readonly cache = new Map<string, CacheItem>()
  private readonly ttl: number
  private readonly maxEntries: number
  private accessCounter = 0

  constructor(
    private readonly pool: Pick<RelayPool, 'query'>,
    opts: VaultResolverOptions,
  ) {
    this.ttl = opts.ttl
    this.maxEntries = opts.maxEntries
  }

  async resolve(myPubkey: string, targetPubkey: string, _myPrivkeyHex: string): Promise<VaultAccess> {
    const cacheKey = `${myPubkey}:${targetPubkey}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const currentEpoch = getCurrentEpochId()

    // Query target's vault config to see if we are a member of any tier
    const theirConfigEvents = await this.pool.query(myPubkey, {
      kinds: [30078],
      authors: [targetPubkey],
      '#d': ['dominion:vault-config'],
    } as any)

    const theirVaultTiers: string[] = []
    let revoked = false

    if (theirConfigEvents.length > 0) {
      const newest = theirConfigEvents.reduce(
        (a: NostrEvent, b: NostrEvent) => b.created_at > a.created_at ? b : a,
      )
      try {
        const config: DominionConfig = JSON.parse(newest.content)
        for (const [tierName, members] of Object.entries(config.tiers)) {
          if (Array.isArray(members) && members.includes(myPubkey)) {
            theirVaultTiers.push(tierName)
          }
        }
        revoked = config.revokedPubkeys?.includes(myPubkey) ?? false
      } catch { /* unparseable config — treat as no membership */ }
    }

    // Query our vault config to see which tiers the target belongs to
    const ourConfigEvents = await this.pool.query(myPubkey, {
      kinds: [30078],
      authors: [myPubkey],
      '#d': ['dominion:vault-config'],
    } as any)

    const vaultTiers: string[] = []

    if (ourConfigEvents.length > 0) {
      const newest = ourConfigEvents.reduce(
        (a: NostrEvent, b: NostrEvent) => b.created_at > a.created_at ? b : a,
      )
      try {
        const config: DominionConfig = JSON.parse(newest.content)
        for (const [tierName, members] of Object.entries(config.tiers)) {
          if (Array.isArray(members) && members.includes(targetPubkey)) {
            vaultTiers.push(tierName)
          }
        }
      } catch { /* unparseable config */ }
    }

    const canDecrypt = theirVaultTiers.length > 0 && !revoked

    const access: VaultAccess = { vaultTiers, theirVaultTiers, canDecrypt, currentEpoch, revoked }
    this.setCache(cacheKey, access)
    return access
  }

  clear(): void {
    this.cache.clear()
  }

  private getCached(key: string): VaultAccess | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined
    if (Date.now() - item.storedAt > this.ttl) {
      this.cache.delete(key)
      return undefined
    }
    item.lastAccess = ++this.accessCounter
    return item.access
  }

  private setCache(key: string, access: VaultAccess): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLru()
    }
    this.cache.set(key, { access, storedAt: Date.now(), lastAccess: ++this.accessCounter })
  }

  private evictLru(): void {
    let oldestKey: string | undefined
    let oldestAccess = Infinity
    for (const [key, item] of this.cache) {
      if (item.lastAccess < oldestAccess) {
        oldestAccess = item.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) this.cache.delete(oldestKey)
  }
}
