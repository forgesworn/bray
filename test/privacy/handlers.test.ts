import { describe, it, expect, vi } from 'vitest'
import {
  handlePrivacyCommit,
  handlePrivacyOpen,
  handlePrivacyProveRange,
  handlePrivacyVerifyRange,
  handlePrivacyProveAge,
  handlePrivacyVerifyAge,
  handlePrivacyProveThreshold,
  handlePrivacyVerifyThreshold,
  handlePrivacyPublishProof,
  handlePrivacyReadProof,
} from '../../src/privacy/handlers.js'
import {
  serializeRangeProof,
  deserializeRangeProof,
  createRangeProof,
} from '@forgesworn/range-proof'
import { IdentityContext } from '../../src/context.js'

// Range proof creation involves heavy elliptic-curve crypto.
// Wider ranges need more bits and take longer (32-bit ~85s on CI).
// We keep ranges small where possible and use generous timeouts.
const PROOF_TIMEOUT = 30_000
const THRESHOLD_TIMEOUT = 120_000  // threshold proofs use 32-bit range internally

describe('privacy handlers', () => {
  describe('Pedersen commitment round-trip', () => {
    it('commit then open with correct value succeeds', () => {
      const { commitment, blinding } = handlePrivacyCommit({ value: 42 })
      const result = handlePrivacyOpen({ commitment, value: 42, blinding })
      expect(result.valid).toBe(true)
    })

    it('opening with wrong value fails', () => {
      const { commitment, blinding } = handlePrivacyCommit({ value: 42 })
      const result = handlePrivacyOpen({ commitment, value: 99, blinding })
      expect(result.valid).toBe(false)
    })
  })

  describe('range proofs', () => {
    it('value in range succeeds', () => {
      // Use a small range [0, 3] (2 bits) to keep proof creation fast
      const { proof } = handlePrivacyProveRange({ value: 2, min: 0, max: 3 })
      const result = handlePrivacyVerifyRange({ proof, min: 0, max: 3 })
      expect(result.valid).toBe(true)
    }, PROOF_TIMEOUT)

    it('value out of range fails', () => {
      expect(() => {
        handlePrivacyProveRange({ value: 5, min: 0, max: 3 })
      }).toThrow()
    })
  })

  describe('age proofs', () => {
    it('adult (18+) succeeds for age 25', () => {
      const { proof } = handlePrivacyProveAge({ age: 25, ageRange: '18+' })
      const result = handlePrivacyVerifyAge({ proof, ageRange: '18+' })
      expect(result.valid).toBe(true)
    }, PROOF_TIMEOUT)

    it('adult (18+) fails for age 15', () => {
      expect(() => {
        handlePrivacyProveAge({ age: 15, ageRange: '18+' })
      }).toThrow()
    })
  })

  describe('threshold proofs', () => {
    it('value above threshold succeeds', () => {
      // The handler always uses THRESHOLD_CEILING (2^32 - 1),
      // so this exercises the full 32-bit range (~85s on CI).
      const { proof } = handlePrivacyProveThreshold({ value: 7, threshold: 5 })
      const result = handlePrivacyVerifyThreshold({ proof, threshold: 5 })
      expect(result.valid).toBe(true)
    }, THRESHOLD_TIMEOUT)

    it('value below threshold fails', () => {
      expect(() => {
        handlePrivacyProveThreshold({ value: 3, threshold: 500 })
      }).toThrow()
    })
  })

  describe('context binding', () => {
    it('proof with context fails when verified with different context', () => {
      const { proof } = handlePrivacyProveRange({ value: 2, min: 0, max: 3, context: 'credential-A' })
      const result = handlePrivacyVerifyRange({ proof, min: 0, max: 3, context: 'credential-B' })
      expect(result.valid).toBe(false)
    }, PROOF_TIMEOUT)

    it('proof with context succeeds when context matches', () => {
      const { proof } = handlePrivacyProveRange({ value: 2, min: 0, max: 3, context: 'credential-A' })
      const result = handlePrivacyVerifyRange({ proof, min: 0, max: 3, context: 'credential-A' })
      expect(result.valid).toBe(true)
    }, PROOF_TIMEOUT)

    it('age proof bound to subject pubkey fails for different pubkey', () => {
      const pk = 'a'.repeat(64)
      const { proof } = handlePrivacyProveAge({ age: 25, ageRange: '18+', subjectPubkey: pk })
      const result = handlePrivacyVerifyAge({ proof, ageRange: '18+', subjectPubkey: 'b'.repeat(64) })
      expect(result.valid).toBe(false)
    }, PROOF_TIMEOUT)
  })

  describe('proof serialisation round-trip', () => {
    it('serialise then deserialise preserves proof', () => {
      // Use a small range [0, 3] for speed
      const { proof: serialised, commitment } = handlePrivacyProveRange({
        value: 1,
        min: 0,
        max: 3,
      })

      // Deserialise and verify structure
      const parsed = deserializeRangeProof(serialised)
      expect(parsed.commitment).toBe(commitment)
      expect(parsed.min).toBe(0)
      expect(parsed.max).toBe(3)

      // Re-serialise should produce identical output
      const reSerialized = serializeRangeProof(parsed)
      expect(reSerialized).toBe(serialised)

      // The re-serialised proof should still verify
      const result = handlePrivacyVerifyRange({ proof: reSerialized, min: 0, max: 3 })
      expect(result.valid).toBe(true)
    }, PROOF_TIMEOUT)
  })

  // --- Nostr integration (publish/read) ---

  describe('handlePrivacyPublishProof', () => {
    const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

    function mockPool() {
      return {
        query: vi.fn().mockResolvedValue([]),
        publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
        publishDirect: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
        getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.test'] }),
      }
    }

    it('publishes a range proof as kind 30078 with correct tags', async () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const pool = mockPool()

      // Create a real proof to publish
      const { proof, commitment } = handlePrivacyProveRange({ value: 2, min: 0, max: 3 })

      const result = await handlePrivacyPublishProof(ctx, pool as any, {
        proof,
        label: 'age-adult',
      })

      expect(result.event).toBeDefined()
      expect(result.event.kind).toBe(30078)
      expect(result.event.content).toBe(proof)

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'range-proof:age-adult'])

      const typeTag = result.event.tags.find((t: string[]) => t[0] === 'range-proof-type')
      expect(typeTag).toEqual(['range-proof-type', 'age-adult'])

      const commitTag = result.event.tags.find((t: string[]) => t[0] === 'commitment')
      expect(commitTag?.[1]).toBe(commitment)

      const rangeTag = result.event.tags.find((t: string[]) => t[0] === 'range')
      expect(rangeTag).toEqual(['range', '0-3'])

      // No p-tag when subjectPubkey is absent
      const pTag = result.event.tags.find((t: string[]) => t[0] === 'p')
      expect(pTag).toBeUndefined()

      expect(pool.publish).toHaveBeenCalledOnce()
    }, PROOF_TIMEOUT)

    it('includes p-tag when subjectPubkey is provided', async () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const pool = mockPool()
      const subjectPk = 'f'.repeat(64)
      const { proof } = handlePrivacyProveRange({ value: 1, min: 0, max: 3 })

      const result = await handlePrivacyPublishProof(ctx, pool as any, {
        proof,
        label: 'credit-check',
        subjectPubkey: subjectPk,
      })

      const pTag = result.event.tags.find((t: string[]) => t[0] === 'p')
      expect(pTag).toEqual(['p', subjectPk])
    }, PROOF_TIMEOUT)

    it('rejects invalid proof data', async () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const pool = mockPool()

      await expect(
        handlePrivacyPublishProof(ctx, pool as any, {
          proof: 'not-valid-json',
          label: 'bad',
        }),
      ).rejects.toThrow()
    })
  })

  describe('handlePrivacyReadProof', () => {
    function mockPool(events: any[] = []) {
      return {
        query: vi.fn().mockResolvedValue(events),
        publish: vi.fn(),
        getRelays: vi.fn().mockReturnValue({ read: [], write: [] }),
      }
    }

    it('returns empty array when no proofs found', async () => {
      const pool = mockPool([])
      const results = await handlePrivacyReadProof(pool as any, 'npub1test', {})
      expect(results).toEqual([])
    })

    it('parses and verifies valid proof events', async () => {
      // Build a real proof so verification passes
      const rangeProof = createRangeProof(2, 0, 3)
      const serialised = serializeRangeProof(rangeProof)

      const event = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: 30078,
        created_at: 1700000000,
        content: serialised,
        tags: [
          ['d', 'range-proof:age-adult'],
          ['range-proof-type', 'age-adult'],
          ['commitment', rangeProof.commitment],
          ['range', '0-3'],
        ],
        sig: 'c'.repeat(128),
      }

      const pool = mockPool([event])
      const results = await handlePrivacyReadProof(pool as any, 'npub1test', {})

      expect(results).toHaveLength(1)
      expect(results[0].label).toBe('age-adult')
      expect(results[0].commitment).toBe(rangeProof.commitment)
      expect(results[0].range).toBe('0-3')
      expect(results[0].valid).toBe(true)
      expect(results[0].pubkey).toBe('b'.repeat(64))
    }, PROOF_TIMEOUT)

    it('marks invalid proof content as valid: false', async () => {
      const event = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: 30078,
        created_at: 1700000000,
        content: 'this-is-not-a-valid-proof',
        tags: [
          ['d', 'range-proof:broken'],
          ['commitment', 'dead'],
          ['range', '0-10'],
        ],
        sig: 'c'.repeat(128),
      }

      const pool = mockPool([event])
      const results = await handlePrivacyReadProof(pool as any, 'npub1test', {})

      expect(results).toHaveLength(1)
      expect(results[0].valid).toBe(false)
    })

    it('includes subject pubkey from p-tag', async () => {
      const rangeProof = createRangeProof(1, 0, 3)
      const serialised = serializeRangeProof(rangeProof)
      const subjectPk = 'f'.repeat(64)

      const event = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: 30078,
        created_at: 1700000000,
        content: serialised,
        tags: [
          ['d', 'range-proof:income'],
          ['commitment', rangeProof.commitment],
          ['range', '0-3'],
          ['p', subjectPk],
        ],
        sig: 'c'.repeat(128),
      }

      const pool = mockPool([event])
      const results = await handlePrivacyReadProof(pool as any, 'npub1test', {})

      expect(results[0].subjectPubkey).toBe(subjectPk)
    }, PROOF_TIMEOUT)

    it('skips events without range-proof d-tag prefix', async () => {
      const event = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: 30078,
        created_at: 1700000000,
        content: '{}',
        tags: [
          ['d', 'something-else'],
        ],
        sig: 'c'.repeat(128),
      }

      const pool = mockPool([event])
      const results = await handlePrivacyReadProof(pool as any, 'npub1test', {})
      expect(results).toHaveLength(0)
    })

    it('filters by authorPubkey when provided', async () => {
      const pool = mockPool([])
      await handlePrivacyReadProof(pool as any, 'npub1test', { authorPubkey: 'abc123' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        authors: ['abc123'],
      }))
    })

    it('filters by label when provided', async () => {
      const pool = mockPool([])
      await handlePrivacyReadProof(pool as any, 'npub1test', { label: 'age-adult' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        '#d': ['range-proof:age-adult'],
      }))
    })
  })
})
