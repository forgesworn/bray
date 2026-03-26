import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TrustCache, type TrustCacheEntry } from '../../src/veil/cache.js'

describe('TrustCache', () => {
  let cache: TrustCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new TrustCache({ ttl: 5000, maxEntries: 3 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves entries by pubkey', () => {
    const entry: TrustCacheEntry = { score: 42, endorsements: 3, ringEndorsements: 1 }
    cache.set('abc123', entry)
    expect(cache.get('abc123')).toEqual(entry)
  })

  it('returns undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires entries after TTL', () => {
    cache.set('abc123', { score: 42, endorsements: 3, ringEndorsements: 1 })
    vi.advanceTimersByTime(6000)
    expect(cache.get('abc123')).toBeUndefined()
  })

  it('evicts LRU entry when max exceeded', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.set('b', { score: 2, endorsements: 0, ringEndorsements: 0 })
    cache.set('c', { score: 3, endorsements: 0, ringEndorsements: 0 })
    cache.get('a')  // make 'a' recently used
    cache.set('d', { score: 4, endorsements: 0, ringEndorsements: 0 })
    expect(cache.get('b')).toBeUndefined()  // 'b' was LRU
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('d')).toBeDefined()
  })

  it('reports correct size', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.set('b', { score: 2, endorsements: 0, ringEndorsements: 0 })
    expect(cache.size).toBe(2)
  })

  it('clears all entries', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})
