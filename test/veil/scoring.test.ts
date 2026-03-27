import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event as NostrEvent } from 'nostr-tools'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'
import { mockAssertionEvent } from '../helpers/mock-veil.js'

vi.mock('nostr-veil/nip85', () => ({
  parseAssertion: vi.fn((event: any) => {
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')
    return { kind: event.kind, subject: dTag?.[1] ?? '', metrics: {} }
  }),
}))

vi.mock('nostr-veil/proof', () => ({
  verifyProof: vi.fn(),
}))

import { verifyProof } from 'nostr-veil/proof'

const mockVerifyProof = vi.mocked(verifyProof)

function mockPool(events: NostrEvent[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

const TEST_NPUB = 'npub1test'
const TEST_PUBKEY = 'c'.padEnd(64, 'c')

describe('VeilScoring', () => {
  let cache: TrustCache

  beforeEach(() => {
    cache = new TrustCache({ ttl: 60_000, maxEntries: 100 })
    vi.clearAllMocks()
  })

  describe('scorePubkey', () => {
    it('returns score 0 with no-endorsements flag when pool returns no assertions', async () => {
      const pool = mockPool([])
      const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
      const result = await scoring.scorePubkey(TEST_PUBKEY)

      expect(result.pubkey).toBe(TEST_PUBKEY)
      expect(result.score).toBe(0)
      expect(result.flags).toContain('no endorsements found')
    })

    it('caches results so pool.query is only called once for two calls', async () => {
      const events = [mockAssertionEvent({ subject: TEST_PUBKEY })]
      const pool = mockPool(events)
      const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)

      const first = await scoring.scorePubkey(TEST_PUBKEY)
      const second = await scoring.scorePubkey(TEST_PUBKEY)

      expect(pool.query).toHaveBeenCalledTimes(1)
      expect(first.score).toBe(second.score)
      expect(first.endorsements).toBe(1)
    })

    it('returns ring-endorsement flag when event has veil-sig tags and proof is valid', async () => {
      const ringEvent = mockAssertionEvent({ subject: TEST_PUBKEY, ringEndorsement: true })
      ringEvent.tags.push(['veil-sig', '{}', 'keyimage123'])

      const pool = mockPool([ringEvent])

      mockVerifyProof.mockReturnValue({
        valid: true,
        circleSize: 3,
        threshold: 2,
        distinctSigners: 2,
        errors: [],
      })

      const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
      const result = await scoring.scorePubkey(TEST_PUBKEY)

      expect(mockVerifyProof).toHaveBeenCalledWith(ringEvent)
      expect(result.flags).toContain('ring proof verified')
      expect(result.ringEndorsements).toBe(2)
    })

    it('adds ring-proof-invalid flag when verifyProof returns invalid', async () => {
      const ringEvent = mockAssertionEvent({ subject: TEST_PUBKEY, ringEndorsement: true })
      ringEvent.tags.push(['veil-sig', '{}', 'bad-keyimage'])

      const pool = mockPool([ringEvent])

      mockVerifyProof.mockReturnValue({
        valid: false,
        circleSize: 3,
        threshold: 2,
        distinctSigners: 1,
        errors: ['Invalid LSAG signature at index 0'],
      })

      const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
      const result = await scoring.scorePubkey(TEST_PUBKEY)

      expect(result.flags).toContain('ring proof invalid')
    })
  })

  describe('scoreEvents', () => {
    it('annotates events with _trustScore from their author trust', async () => {
      const authorA = 'a'.padEnd(64, 'a')
      const authorB = 'b'.padEnd(64, 'b')

      const events: NostrEvent[] = [
        { id: '1'.padEnd(64, '1'), pubkey: authorA, created_at: 1000, kind: 1, tags: [], content: 'hello', sig: 'sig1'.padEnd(128, '1') },
        { id: '2'.padEnd(64, '2'), pubkey: authorB, created_at: 1001, kind: 1, tags: [], content: 'world', sig: 'sig2'.padEnd(128, '2') },
        { id: '3'.padEnd(64, '3'), pubkey: authorA, created_at: 1002, kind: 1, tags: [], content: 'again', sig: 'sig3'.padEnd(128, '3') },
      ]

      // Pool returns different results per author query
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([mockAssertionEvent({ subject: authorA })])
          .mockResolvedValueOnce([]),
        getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
      }

      const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
      const scored = await scoring.scoreEvents(events)

      expect(scored).toHaveLength(3)

      const [evA1, evB, evA2] = scored
      expect(evA1._trustScore).toBe(1) // 1 endorsement
      expect(evB._trustScore).toBe(0)
      expect(evA2._trustScore).toBe(1) // cached result

      // Pool queried once per unique author
      expect(pool.query).toHaveBeenCalledTimes(2)
    })
  })
})
