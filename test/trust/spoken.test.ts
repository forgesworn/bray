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

    it('produces deterministic tokens for same inputs', () => {
      const r1 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'det', counter: 1 })
      const r2 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'det', counter: 1 })
      expect(r1.token).toBe(r2.token)
    })

    it('produces different tokens for different counters', () => {
      const r1 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'ctx', counter: 1 })
      const r2 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'ctx', counter: 2 })
      expect(r1.token).not.toBe(r2.token)
    })

    it('produces different tokens for different contexts', () => {
      const r1 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'alpha', counter: 1 })
      const r2 = handleTrustSpokenChallenge({ secret: TEST_SECRET, context: 'beta', counter: 1 })
      expect(r1.token).not.toBe(r2.token)
    })

    it('produces different tokens for different secrets', () => {
      const r1 = handleTrustSpokenChallenge({ secret: 'a'.repeat(32), context: 'ctx', counter: 1 })
      const r2 = handleTrustSpokenChallenge({ secret: 'b'.repeat(32), context: 'ctx', counter: 1 })
      expect(r1.token).not.toBe(r2.token)
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
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'tolerance-test',
        counter: 101,
        input: challenge.token,
        tolerance: 1,
      })
      expect(result.valid).toBe(true)
    })

    it('rejects token outside tolerance window', () => {
      const challenge = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'out-of-window',
        counter: 100,
      })
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'out-of-window',
        counter: 105,
        input: challenge.token,
        tolerance: 1,
      })
      expect(result.valid).toBe(false)
    })

    it('rejects token with wrong context', () => {
      const challenge = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'context-a',
        counter: 1,
      })
      const result = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'context-b',
        counter: 1,
        input: challenge.token,
        tolerance: 0,
      })
      expect(result.valid).toBe(false)
    })

    it('rejects token with wrong secret', () => {
      const challenge = handleTrustSpokenChallenge({
        secret: 'a'.repeat(32),
        context: 'ctx',
        counter: 1,
      })
      const result = handleTrustSpokenVerify({
        secret: 'b'.repeat(32),
        context: 'ctx',
        counter: 1,
        input: challenge.token,
        tolerance: 0,
      })
      expect(result.valid).toBe(false)
    })
  })
})
