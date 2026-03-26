export interface TrustCacheEntry {
  score: number
  endorsements: number
  ringEndorsements: number
}

interface CacheItem {
  entry: TrustCacheEntry
  storedAt: number
  lastAccess: number
}

export interface TrustCacheOptions {
  ttl: number       // milliseconds
  maxEntries: number
}

export class TrustCache {
  private readonly items = new Map<string, CacheItem>()
  private readonly ttl: number
  private readonly maxEntries: number
  private accessCounter = 0

  constructor(opts: TrustCacheOptions) {
    this.ttl = opts.ttl
    this.maxEntries = opts.maxEntries
  }

  get(pubkey: string): TrustCacheEntry | undefined {
    const item = this.items.get(pubkey)
    if (!item) return undefined
    if (Date.now() - item.storedAt > this.ttl) {
      this.items.delete(pubkey)
      return undefined
    }
    item.lastAccess = ++this.accessCounter
    return item.entry
  }

  set(pubkey: string, entry: TrustCacheEntry): void {
    if (this.items.size >= this.maxEntries && !this.items.has(pubkey)) {
      this.evictLru()
    }
    this.items.set(pubkey, {
      entry,
      storedAt: Date.now(),
      lastAccess: ++this.accessCounter,
    })
  }

  get size(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  private evictLru(): void {
    let oldestKey: string | undefined
    let oldestAccess = Infinity
    for (const [key, item] of this.items) {
      if (item.lastAccess < oldestAccess) {
        oldestAccess = item.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) this.items.delete(oldestKey)
  }
}
