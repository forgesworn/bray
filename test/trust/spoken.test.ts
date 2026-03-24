import { describe, it, expect } from 'vitest'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from '../../src/trust/spoken.js'

const TEST_SECRET = 'a'.repeat(32) // 32 hex chars = 16 bytes minimum

describe('spoken token verification', () => {
  describe('handleTrustSpokenChallenge', () => {
    it('generates a challenge token', () => {
      const result = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'test-challenge',
        counter: 100,
      })
      expect(result.token).toBeDefined()
      expect(typeof result.token).toBe('string')
      expect(result.token.length).toBeGreaterThan(0)
    })
  })

  describe('handleTrustSpokenVerify', () => {
    it('verifies correctly with matching response', () => {
      const challenge = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'verify-test',
        counter: 42,
      })
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'verify-test',
        counter: 42,
        input: challenge.token,
        tolerance: 0,
      })
      expect(result.valid).toBe(true)
    })

    it('rejects wrong token', () => {
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'verify-test',
        counter: 42,
        input: 'completely-wrong-token',
        tolerance: 0,
      })
      expect(result.valid).toBe(false)
    })

    it('accepts token within tolerance window', () => {
      const challenge = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'tolerance-test',
        counter: 100,
      })
      // Verify at counter 101 with tolerance 1
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'tolerance-test',
        counter: 101,
        input: challenge.token,
        tolerance: 1,
      })
      expect(result.valid).toBe(true)
    })
  })
})
