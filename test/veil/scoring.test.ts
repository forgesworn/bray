import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event as NostrEvent } from 'nostr-tools'
import { computeCircleId } from 'nostr-veil/proof'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'
import { mockAssertionEvent, mockFollowEvent, mockRingProofEvent, mockVeilPool } from '../helpers/mock-veil.js'

vi.mock('nostr-veil/nip85', () => ({
  parseAssertion: vi.fn((event: any) => {
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')
    return { kind: event.kind, subject: dTag?.[1] ?? '', metrics: {} }
  }),
}))

// verifyProof is mocked; computeCircleId stays real so circle anchoring is
// tested against the genuine hash.
vi.mock('nostr-veil/proof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nostr-veil/proof')>()),
  verifyProof: vi.fn(),
}))

import { verifyProof } from 'nostr-veil/proof'

const mockVerifyProof = vi.mocked(verifyProof)

const VALID_PROOF = { valid: true, circleSize: 3, threshold: 1, distinctSigners: 1, subjectInRing: false, independentSigners: 1, errors: [] as string[] }

const hex = (c: string) => c.repeat(64)
const CALLER = hex('9')
const SUBJECT = hex('c')
const FOLLOW_A = hex('1')
const FOLLOW_B = hex('2')
const FOLLOW_C = hex('3')
const STRANGER = hex('7')
const OTHER_STRANGER = hex('8')
const PUBLISHER = hex('5')

const ctxFor = (activePublicKeyHex = CALLER) => ({ activeNpub: 'npub1test', activePublicKeyHex })

function members(...keys: string[]): string[] {
  return [...keys].sort()
}

describe('VeilScoring', () => {
  let cache: TrustCache

  beforeEach(() => {
    cache = new TrustCache({ ttl: 60_000, maxEntries: 100 })
    vi.clearAllMocks()
    mockVerifyProof.mockReturnValue(VALID_PROOF)
  })

  function scoringFor(
    pool: ReturnType<typeof mockVeilPool>,
    opts: ConstructorParameters<typeof VeilScoring>[3] = {},
    ctx = ctxFor(),
  ) {
    return new VeilScoring(pool as any, cache, ctx, opts)
  }

  const followsOf = (...keys: string[]) => [mockFollowEvent(CALLER, keys)]

  describe('scorePubkey', () => {
    it('returns score 0 with no-endorsements flag when pool returns no assertions', async () => {
      const result = await scoringFor(mockVeilPool()).scorePubkey(SUBJECT)

      expect(result.pubkey).toBe(SUBJECT)
      expect(result.score).toBe(0)
      expect(result.untrustedEndorsements).toBe(0)
      expect(result.untrustedRingEndorsements).toBe(0)
      expect(result.flags).toContain('no endorsements found')
    })

    it('caches results so the assertion query runs once for two calls', async () => {
      const pool = mockVeilPool({
        assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
        follows: followsOf(FOLLOW_A),
      })
      const scoring = scoringFor(pool)

      const first = await scoring.scorePubkey(SUBJECT)
      const second = await scoring.scorePubkey(SUBJECT)

      const assertionQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(30382))
      expect(assertionQueries).toHaveLength(1)
      expect(first.score).toBe(second.score)
      expect(first.endorsements).toBe(1)
    })

    it('adds ring-proof-invalid flag when verifyProof returns invalid', async () => {
      const proof = mockRingProofEvent({
        publisher: FOLLOW_A, subject: SUBJECT, members: members(FOLLOW_A, FOLLOW_B), keyImages: ['bad-keyimage'],
      })
      mockVerifyProof.mockReturnValue({ ...VALID_PROOF, valid: false, errors: ['Invalid LSAG signature at index 0'] })

      const result = await scoringFor(mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, FOLLOW_B) }))
        .scorePubkey(SUBJECT)

      expect(result.flags).toContain('ring proof invalid')
      expect(result.ringEndorsements).toBe(0)
      expect(result.untrustedRingEndorsements).toBe(0)
      // A proof-bearing event is never a plain endorsement, valid or not
      expect(result.endorsements).toBe(0)
      expect(result.untrustedEndorsements).toBe(0)
    })

    it('ignores events about another subject or of another kind, even with a valid ring proof', async () => {
      const ring = members(FOLLOW_A, FOLLOW_B)
      const otherSubject = mockRingProofEvent({
        publisher: FOLLOW_A, subject: hex('d'), members: ring, keyImages: ['keyimage-other'],
      })
      const wrongKind = {
        ...mockRingProofEvent({ publisher: FOLLOW_A, subject: SUBJECT, members: ring, keyImages: ['keyimage-kind'] }),
        kind: 30383,
      }

      const result = await scoringFor(mockVeilPool({
        assertions: [otherSubject, wrongKind],
        follows: followsOf(FOLLOW_A, FOLLOW_B),
      })).scorePubkey(SUBJECT)

      expect(mockVerifyProof).not.toHaveBeenCalled()
      expect(result.endorsements).toBe(0)
      expect(result.ringEndorsements).toBe(0)
      expect(result.score).toBe(0)
    })

    describe('plain assertions', () => {
      it('ignores an assertion the subject published about themselves', async () => {
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: SUBJECT, subject: SUBJECT })],
          // The subject is a follow, so only the self check keeps this at 0
          follows: followsOf(SUBJECT),
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.score).toBe(0)
        expect(result.endorsements).toBe(0)
        expect(result.untrustedEndorsements).toBe(0)
        expect(result.flags).toContain('self-endorsement ignored')
      })

      it('counts an assertion from a follow, and reports one from a stranger without scoring it', async () => {
        const pool = mockVeilPool({
          assertions: [
            mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT }),
            mockAssertionEvent({ provider: STRANGER, subject: SUBJECT }),
          ],
          follows: followsOf(FOLLOW_A),
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
        expect(result.untrustedEndorsements).toBe(1)
        expect(result.score).toBe(1)
      })

      it('scores 0 when only strangers endorse, so strict mode does not pass them', async () => {
        const pool = mockVeilPool({
          assertions: [
            mockAssertionEvent({ provider: STRANGER, subject: SUBJECT }),
            mockAssertionEvent({ provider: OTHER_STRANGER, subject: SUBJECT }),
          ],
          follows: followsOf(FOLLOW_A),
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.score).toBe(0)
        expect(result.endorsements).toBe(0)
        expect(result.untrustedEndorsements).toBe(2)
      })

      it('counts an assertion from a configured trusted publisher', async () => {
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: PUBLISHER, subject: SUBJECT })],
          follows: followsOf(),
        })
        const result = await scoringFor(pool, { trustedPublishers: [PUBLISHER] }).scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
        expect(result.untrustedEndorsements).toBe(0)
        expect(result.score).toBe(1)
      })

      it('counts the same author seen twice once', async () => {
        const first = mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })
        const again = { ...first, id: 'f'.repeat(64), tags: first.tags.map(t => [...t]) }
        const pool = mockVeilPool({ assertions: [first, again], follows: followsOf(FOLLOW_A) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
        expect(result.score).toBe(1)
      })

      it('counts the caller as trusted', async () => {
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: CALLER, subject: SUBJECT })],
          follows: followsOf(),
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
      })
    })

    describe('ring proofs', () => {
      it('counts 3 per key image for a proof from a configured trusted circle', async () => {
        const ring = members(STRANGER, OTHER_STRANGER, hex('6'))
        const proof = mockRingProofEvent({
          publisher: hex('4'), subject: SUBJECT, members: ring, keyImages: ['ki-a', 'ki-b'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf() })
        const result = await scoringFor(pool, { trustedCircles: [computeCircleId(ring)] }).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(2)
        expect(result.untrustedRingEndorsements).toBe(0)
        expect(result.score).toBe(6)
        expect(result.flags).toContain('ring proof verified')
        expect(mockVerifyProof).toHaveBeenCalledWith(proof, { expectedKind: 30382 })
      })

      it('does not trust a ring an attacker joined, because the circle ID changes', async () => {
        const trustedRing = members(FOLLOW_A, FOLLOW_B)
        const attackerRing = members(FOLLOW_A, FOLLOW_B, STRANGER)
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: attackerRing, keyImages: ['ki-a'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf() })
        const result = await scoringFor(pool, { trustedCircles: [computeCircleId(trustedRing)] }).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(0)
        expect(result.untrustedRingEndorsements).toBe(1)
        expect(result.score).toBe(0)
      })

      it('counts a ring proof published by a trusted publisher', async () => {
        const proof = mockRingProofEvent({
          publisher: PUBLISHER, subject: SUBJECT, members: members(STRANGER, OTHER_STRANGER), keyImages: ['ki-a'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf() })
        const result = await scoringFor(pool, { trustedPublishers: [PUBLISHER] }).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
        expect(result.score).toBe(3)
      })

      it('counts a ring proof whose members are all follows, whoever published it', async () => {
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(FOLLOW_A, FOLLOW_B, FOLLOW_C), keyImages: ['ki-a'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, FOLLOW_B, FOLLOW_C) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
        expect(result.score).toBe(3)
        expect(result.flags).toContain('ring proof verified')
      })

      it('counts a ring that includes the caller', async () => {
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(CALLER, FOLLOW_A), keyImages: ['ki-a'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
      })

      it('reports but does not score a ring with one non-follow member from an untrusted publisher', async () => {
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(FOLLOW_A, FOLLOW_B, STRANGER), keyImages: ['ki-a', 'ki-b'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, FOLLOW_B) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(0)
        expect(result.untrustedRingEndorsements).toBe(2)
        expect(result.score).toBe(0)
        expect(result.flags).toContain('ring proof untrusted')
        expect(result.flags).not.toContain('ring proof verified')
      })

      it('does not trust an empty ring vacuously', async () => {
        const proof = mockRingProofEvent({ publisher: STRANGER, subject: SUBJECT, members: [], keyImages: ['ki-a'] })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(0)
        expect(result.untrustedRingEndorsements).toBe(1)
      })

      it('counts a replayed key image once across events and publishers', async () => {
        const ring = members(FOLLOW_A, FOLLOW_B)
        const first = mockRingProofEvent({ publisher: FOLLOW_A, subject: SUBJECT, members: ring, keyImages: ['ki-a', 'ki-b'] })
        const again = { ...first, id: 'f'.repeat(64), tags: first.tags.map(t => [...t]) }
        const other = { ...first, id: 'e'.repeat(64), pubkey: STRANGER, tags: first.tags.map(t => [...t]) }
        const pool = mockVeilPool({ assertions: [first, again, other], follows: followsOf(FOLLOW_A, FOLLOW_B) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(2)
        expect(result.untrustedRingEndorsements).toBe(0)
        expect(result.endorsements).toBe(0)
        expect(result.score).toBe(6)
      })

      it('groups key images by the electionId, or by the raw tag when it cannot be read', async () => {
        // The subject is in the ring, so each scope loses one image. Three scopes
        // of two images give 3; with no grouping the six images would give 5.
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(SUBJECT, FOLLOW_A),
          keyImages: ['a1', 'a2'], electionId: 'scope-a',
        })
        // Unreadable JSON and a non-string electionId: the raw tag value is the scope
        proof.tags.push(
          ['veil-sig', 'not-json', 'r1'], ['veil-sig', 'not-json', 'r2'],
          ['veil-sig', '{"electionId":7}', 'n1'], ['veil-sig', '{"electionId":7}', 'n2'],
        )
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, SUBJECT) })
        const result = await scoringFor(pool, { trustedPublishers: [STRANGER] }).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(3)
      })

      it('does not report a key image as untrusted when a trusted proof already counted it', async () => {
        const trustedRing = members(STRANGER, OTHER_STRANGER)
        const trusted = mockRingProofEvent({
          publisher: hex('4'), subject: SUBJECT, members: trustedRing, keyImages: ['ki-shared'],
        })
        const untrusted = mockRingProofEvent({
          publisher: hex('4'), subject: SUBJECT, members: members(FOLLOW_A, STRANGER), keyImages: ['ki-shared', 'ki-only'],
        })
        // Order must not matter: the untrusted proof comes first
        const pool = mockVeilPool({ assertions: [untrusted, trusted], follows: followsOf(FOLLOW_A) })
        const result = await scoringFor(pool, { trustedCircles: [computeCircleId(trustedRing)] }).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
        expect(result.untrustedRingEndorsements).toBe(1)
        expect(result.score).toBe(3)
      })
    })

    describe('subject in ring', () => {
      it('scores 3 not 6 for two key images in one scope, and flags it', async () => {
        const ring = members(SUBJECT, FOLLOW_A, FOLLOW_B)
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: ring, keyImages: ['ki-a', 'ki-b'], threshold: 2,
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, FOLLOW_B, SUBJECT) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
        expect(result.score).toBe(3)
        expect(result.flags).toContain('subject is a ring member')
      })

      it('scores 0 for a threshold-1 proof whose ring contains the subject', async () => {
        const ring = members(SUBJECT, FOLLOW_A)
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: ring, keyImages: ['ki-a'], threshold: 1,
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A, SUBJECT) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(0)
        expect(result.score).toBe(0)
      })

      it('takes one off each scope for a subject-containing ring', async () => {
        const ring = members(SUBJECT, FOLLOW_A, FOLLOW_B)
        const scopeA = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: ring, keyImages: ['a1', 'a2'], electionId: 'scope-a',
        })
        const scopeB = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: ring, keyImages: ['b1', 'b2'], electionId: 'scope-b',
        })
        const pool = mockVeilPool({ assertions: [scopeA, scopeB], follows: followsOf(FOLLOW_A, FOLLOW_B, SUBJECT) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(2)
        expect(result.score).toBe(6)
      })

      it('takes the deduction on the untrusted side too', async () => {
        const proof = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(SUBJECT, STRANGER), keyImages: ['u1', 'u2'],
        })
        const pool = mockVeilPool({ assertions: [proof], follows: followsOf(FOLLOW_A) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.untrustedRingEndorsements).toBe(1)
        expect(result.ringEndorsements).toBe(0)
        expect(result.score).toBe(0)
      })

      it('does not take a deduction in a scope where no proof contains the subject', async () => {
        const withSubject = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(SUBJECT, FOLLOW_A), keyImages: ['a1'], electionId: 'scope-a',
        })
        const without = mockRingProofEvent({
          publisher: STRANGER, subject: SUBJECT, members: members(FOLLOW_A, FOLLOW_B), keyImages: ['b1'], electionId: 'scope-b',
        })
        const pool = mockVeilPool({ assertions: [withSubject, without], follows: followsOf(FOLLOW_A, FOLLOW_B, SUBJECT) })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.ringEndorsements).toBe(1)
      })
    })

    describe('follows', () => {
      it('fetches the follow list once per TTL across two scorePubkey calls', async () => {
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
          follows: followsOf(FOLLOW_A),
        })
        const scoring = scoringFor(pool)

        await scoring.scorePubkey(SUBJECT)
        await scoring.scorePubkey(hex('d'))

        const followQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(3))
        expect(followQueries).toHaveLength(1)
        expect(followQueries[0][1]).toMatchObject({ authors: [CALLER], kinds: [3], limit: 1 })
      })

      it('fetches again once the TTL has passed', async () => {
        vi.useFakeTimers()
        try {
          const pool = mockVeilPool({
            assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
            follows: followsOf(FOLLOW_A),
          })
          const scoring = scoringFor(pool, { followsTtl: 1_000 })

          await scoring.scorePubkey(SUBJECT)
          vi.advanceTimersByTime(1_500)
          await scoring.scorePubkey(hex('d'))

          const followQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(3))
          expect(followQueries).toHaveLength(2)
        } finally {
          vi.useRealTimers()
        }
      })

      it('fetches each identity its own follows after a switch', async () => {
        const OTHER_CALLER = hex('a')
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
          follows: [mockFollowEvent(CALLER, [FOLLOW_A]), mockFollowEvent(OTHER_CALLER, [FOLLOW_B])],
        })
        const ctx = { activeNpub: 'npub1test', activePublicKeyHex: CALLER }
        const scoring = new VeilScoring(pool as any, cache, ctx)

        const asFirst = await scoring.scorePubkey(SUBJECT)
        ctx.activePublicKeyHex = OTHER_CALLER
        const asSecond = await scoring.scorePubkey(SUBJECT)

        expect(asFirst.endorsements).toBe(1)
        expect(asSecond.endorsements).toBe(0)
        expect(asSecond.untrustedEndorsements).toBe(1)
        const followQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(3))
        expect(followQueries.map(([, f]) => f.authors)).toEqual([[CALLER], [OTHER_CALLER]])
      })

      it('uses the newest follow list and ignores one the caller did not author', async () => {
        const pool = mockVeilPool({
          assertions: [
            mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT }),
            mockAssertionEvent({ provider: FOLLOW_B, subject: SUBJECT }),
            mockAssertionEvent({ provider: STRANGER, subject: SUBJECT }),
          ],
          follows: [
            mockFollowEvent(CALLER, [FOLLOW_A], 1_000),
            mockFollowEvent(CALLER, [FOLLOW_B], 2_000),
          ],
        })
        // A relay answering with someone else's list must not widen the set
        const query = pool.query.getMockImplementation()!
        pool.query.mockImplementation(async (npub: string, filter: any) => {
          const events = await query(npub, filter)
          return filter.kinds?.includes(3) ? [...events, mockFollowEvent(STRANGER, [STRANGER])] : events
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
        expect(result.untrustedEndorsements).toBe(2)
      })

      it('flags a missing follow list, and trusts only the caller', async () => {
        const pool = mockVeilPool({
          assertions: [
            mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT }),
            mockAssertionEvent({ provider: CALLER, subject: SUBJECT }),
          ],
          follows: [],
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT)

        expect(result.flags).toContain('follow list not found')
        expect(result.endorsements).toBe(1)
        expect(result.untrustedEndorsements).toBe(1)
      })

      it('does not flag a missing follow list when the follow list exists, or when follows were not consulted', async () => {
        const withList = await scoringFor(mockVeilPool({
          assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
          follows: followsOf(FOLLOW_A),
        })).scorePubkey(SUBJECT)
        expect(withList.flags).not.toContain('follow list not found')

        const nothingAboutSubject = await scoringFor(mockVeilPool({ follows: [] }), {}, ctxFor(hex('a')))
          .scorePubkey(hex('d'))
        expect(nothingAboutSubject.flags).not.toContain('follow list not found')
      })

      it('treats an anonymous caller as following nobody and never reads the public key', async () => {
        const anonymous = {
          activeNpub: '',
          get activePublicKeyHex(): string { throw new Error('no pubkey in read-only mode') },
        }
        const pool = mockVeilPool({
          assertions: [
            mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT }),
            mockAssertionEvent({ provider: PUBLISHER, subject: SUBJECT }),
          ],
        })
        const scoring = new VeilScoring(pool as any, cache, anonymous, { trustedPublishers: [PUBLISHER] })

        const result = await scoring.scorePubkey(SUBJECT)
        const again = await scoring.scorePubkey(SUBJECT)

        expect(result.endorsements).toBe(1)
        expect(result.untrustedEndorsements).toBe(1)
        expect(result.flags).not.toContain('follow list not found')
        expect(again.score).toBe(result.score)
        expect([...await scoring.trustedAuthors()]).toEqual([PUBLISHER])
        const followQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(3))
        expect(followQueries).toHaveLength(0)
      })

      it('scores an upper-case subject the same as lower-case', async () => {
        const pool = mockVeilPool({
          assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })],
          follows: followsOf(FOLLOW_A),
        })
        const result = await scoringFor(pool).scorePubkey(SUBJECT.toUpperCase())

        expect(result.pubkey).toBe(SUBJECT)
        expect(result.endorsements).toBe(1)
      })

      it('does not remember a failed follow fetch', async () => {
        const pool = mockVeilPool({ assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: SUBJECT })] })
        const query = pool.query.getMockImplementation()!
        pool.query.mockImplementationOnce(async (npub: string, filter: any) => query(npub, filter)) // assertions
        pool.query.mockImplementationOnce(async () => { throw new Error('relay down') }) // follows
        const scoring = scoringFor(pool)

        await expect(scoring.scorePubkey(SUBJECT)).rejects.toThrow('relay down')
        const result = await scoring.scorePubkey(SUBJECT)
        expect(result.untrustedEndorsements).toBe(1)
      })
    })
  })

  describe('trustedAuthors', () => {
    it('is the follows, the trusted publishers and the caller', async () => {
      const pool = mockVeilPool({ follows: followsOf(FOLLOW_A, FOLLOW_B) })
      const authors = await scoringFor(pool, { trustedPublishers: [PUBLISHER] }).trustedAuthors()

      expect([...authors].sort()).toEqual([CALLER, FOLLOW_A, FOLLOW_B, PUBLISHER].sort())
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

      // Only authorA has an assertion about them, from a follow
      const pool = mockVeilPool({
        assertions: [mockAssertionEvent({ provider: FOLLOW_A, subject: authorA })],
        follows: followsOf(FOLLOW_A),
      })
      pool.query.mockImplementation(async (_npub: string, filter: any) => {
        if (filter.kinds?.includes(3)) return followsOf(FOLLOW_A)
        return filter['#d']?.[0] === authorA ? [mockAssertionEvent({ provider: FOLLOW_A, subject: authorA })] : []
      })

      const scored = await scoringFor(pool).scoreEvents(events)

      expect(scored).toHaveLength(3)

      const [evA1, evB, evA2] = scored
      expect(evA1._trustScore).toBe(1) // 1 trusted endorsement
      expect(evB._trustScore).toBe(0)
      expect(evA2._trustScore).toBe(1) // cached result

      // Assertions queried once per unique author
      const assertionQueries = pool.query.mock.calls.filter(([, f]) => f.kinds?.includes(30382))
      expect(assertionQueries).toHaveLength(2)
    })
  })
})
