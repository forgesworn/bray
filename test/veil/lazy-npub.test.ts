import { describe, it, expect, vi } from 'vitest'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'

vi.mock('nostr-veil/nip85', () => ({ parseAssertion: vi.fn() }))
vi.mock('nostr-veil/proof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nostr-veil/proof')>()),
  verifyProof: vi.fn(),
}))

// A bunker-backed identity throws on `activeNpub` and `activePublicKeyHex`
// until the bunker has answered. The trust layer is built at startup, before
// that, so VeilScoring must not read the identity in its constructor.
describe('VeilScoring with a lazy identity', () => {
  it('does not read the identity at construction and reads it on each query', async () => {
    let resolved: { npub: string; hex: string } | null = null
    const ctx = {
      get activeNpub(): string {
        if (!resolved) throw new Error('pubkey not yet resolved')
        return resolved.npub
      },
      get activePublicKeyHex(): string {
        if (!resolved) throw new Error('pubkey not yet resolved')
        return resolved.hex
      },
    }
    const pool = { query: vi.fn().mockResolvedValue([]) }
    const cache = new TrustCache({ ttl: 60_000, maxEntries: 10 })

    expect(() => new VeilScoring(pool as any, cache, ctx)).not.toThrow()
    const scoring = new VeilScoring(pool as any, cache, ctx)

    await expect(scoring.scorePubkey('a'.repeat(64))).rejects.toThrow('not yet resolved')

    resolved = { npub: 'npub1resolved', hex: 'e'.repeat(64) }
    const result = await scoring.scorePubkey('b'.repeat(64))
    expect(result.score).toBe(0)
    expect(pool.query).toHaveBeenLastCalledWith('npub1resolved', expect.anything())
  })
})
