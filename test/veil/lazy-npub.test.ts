import { describe, it, expect, vi } from 'vitest'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'

vi.mock('nostr-veil/nip85', () => ({ parseAssertion: vi.fn() }))
vi.mock('nostr-veil/proof', () => ({ verifyProof: vi.fn() }))

// A bunker-backed identity throws on `activeNpub` until the bunker has
// answered. The trust layer is built at startup, before that, so VeilScoring
// must not read the npub in its constructor.
describe('VeilScoring with a lazy npub', () => {
  it('does not read the npub at construction and reads it on each query', async () => {
    let resolved: string | null = null
    const getter = () => {
      if (!resolved) throw new Error('pubkey not yet resolved')
      return resolved
    }
    const pool = { query: vi.fn().mockResolvedValue([]) }
    const cache = new TrustCache({ ttl: 60_000, maxEntries: 10 })

    expect(() => new VeilScoring(pool as any, cache, getter)).not.toThrow()
    const scoring = new VeilScoring(pool as any, cache, getter)

    await expect(scoring.scorePubkey('a'.repeat(64))).rejects.toThrow('not yet resolved')

    resolved = 'npub1resolved'
    const result = await scoring.scorePubkey('b'.repeat(64))
    expect(result.score).toBe(0)
    expect(pool.query).toHaveBeenLastCalledWith('npub1resolved', expect.anything())
  })
})
