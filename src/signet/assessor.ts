import {
  computeBadge,
  computeTrustScore,
  buildBadgeFilters,
  parseCredential,
  isCredentialExpired,
} from 'signet-protocol'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'

export interface SignetAssessment {
  tier: 1 | 2 | 3 | 4 | null
  score: number
  credentials: number
  verifiedBy?: string
  ageRange?: string
  expired: boolean
}

interface CacheItem {
  assessment: SignetAssessment
  storedAt: number
  lastAccess: number
}

interface SignetAssessorOptions {
  ttl: number
  maxEntries: number
}

export class SignetAssessor {
  private readonly cache = new Map<string, CacheItem>()
  private readonly ttl: number
  private readonly maxEntries: number
  private accessCounter = 0

  constructor(
    private readonly pool: RelayPool,
    opts: SignetAssessorOptions,
  ) {
    this.ttl = opts.ttl
    this.maxEntries = opts.maxEntries
  }

  async assess(callerNpub: string, pubkey: string): Promise<SignetAssessment> {
    const cacheKey = `${callerNpub}:${pubkey}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    // Query kind 31000 events about this pubkey
    const filters = buildBadgeFilters([pubkey]) as unknown as Filter[]
    const events: NostrEvent[] = []
    for (const filter of filters) {
      const batch = await this.pool.query(callerNpub, filter)
      events.push(...batch)
    }

    if (events.length === 0) {
      const empty: SignetAssessment = { tier: null, score: 0, credentials: 0, expired: false }
      this.setCache(cacheKey, empty)
      return empty
    }

    const badge = await computeBadge(pubkey, events, { verifySignatures: false })
    const credentials = events.filter(e => parseCredential(e) !== null)
    const vouches = events.filter(e => e.tags.some(t => t[0] === 'type' && t[1] === 'vouch'))
    const breakdown = computeTrustScore(pubkey, credentials, vouches)
    const expired = credentials.some(e => isCredentialExpired(e))

    let verifiedBy: string | undefined
    let ageRange: string | undefined
    for (const ev of credentials) {
      const profTag = ev.tags.find(t => t[0] === 'profession')
      if (profTag) verifiedBy = profTag[1]
      const ageTag = ev.tags.find(t => t[0] === 'age-range')
      if (ageTag) ageRange = ageTag[1]
    }

    const assessment: SignetAssessment = {
      tier: badge.tier as 1 | 2 | 3 | 4 | null,
      score: breakdown.score,
      credentials: badge.credentialCount,
      verifiedBy,
      ageRange,
      expired,
    }

    this.setCache(cacheKey, assessment)
    return assessment
  }

  clear(): void {
    this.cache.clear()
  }

  private getCached(key: string): SignetAssessment | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined
    if (Date.now() - item.storedAt > this.ttl) {
      this.cache.delete(key)
      return undefined
    }
    item.lastAccess = ++this.accessCounter
    return item.assessment
  }

  private setCache(key: string, assessment: SignetAssessment): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLru()
    }
    this.cache.set(key, { assessment, storedAt: Date.now(), lastAccess: ++this.accessCounter })
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
