import { describe, it, expect } from 'vitest'
import {
  handlePrivacyCommit,
  handlePrivacyOpen,
  handlePrivacyProveRange,
  handlePrivacyVerifyRange,
  handlePrivacyProveAge,
  handlePrivacyVerifyAge,
  handlePrivacyProveThreshold,
  handlePrivacyVerifyThreshold,
} from '../../src/privacy/handlers.js'
import {
  serializeRangeProof,
  deserializeRangeProof,
} from '@forgesworn/range-proof'

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
})
