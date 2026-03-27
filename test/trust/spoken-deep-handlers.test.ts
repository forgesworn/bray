import { describe, it, expect } from 'vitest'
import { handleTrustSpokenDirectional, handleTrustSpokenEncode } from '../../src/trust/spoken-deep-handlers.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from '../../src/trust/spoken.js'

const TEST_SECRET = 'a'.repeat(32) // 32 hex chars = 16 bytes minimum

describe('spoken token deep handlers', () => {
  describe('handleTrustSpokenDirectional', () => {
    it('generates a pair with two distinct tokens', () => {
      const result = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        counter: 100,
      })
      expect(result.caller).toBeDefined()
      expect(result.agent).toBeDefined()
      expect(result.caller).not.toBe(result.agent)
    })

    it('produces deterministic pairs', () => {
      const r1 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        counter: 42,
      })
      const r2 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        counter: 42,
      })
      expect(r1.caller).toBe(r2.caller)
      expect(r1.agent).toBe(r2.agent)
    })

    it('different counters produce different pairs', () => {
      const r1 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        counter: 1,
      })
      const r2 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        counter: 2,
      })
      expect(r1.caller).not.toBe(r2.caller)
    })

    it('different namespaces produce different pairs', () => {
      const r1 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'dispatch',
        roles: ['buyer', 'seller'],
        counter: 1,
      })
      const r2 = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'trade',
        roles: ['buyer', 'seller'],
        counter: 1,
      })
      expect(r1.buyer).not.toBe(r2.buyer)
    })

    it('supports PIN encoding', () => {
      const result = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'pin-test',
        roles: ['alice', 'bob'],
        counter: 1,
        format: 'pin',
        pinDigits: 6,
      })
      expect(result.alice).toMatch(/^\d{6}$/)
      expect(result.bob).toMatch(/^\d{6}$/)
    })

    it('supports hex encoding', () => {
      const result = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'hex-test',
        roles: ['alice', 'bob'],
        counter: 1,
        format: 'hex',
        hexLength: 8,
      })
      expect(result.alice).toMatch(/^[0-9a-f]{8}$/)
      expect(result.bob).toMatch(/^[0-9a-f]{8}$/)
    })

    it('supports multi-word encoding', () => {
      const result = handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'words-test',
        roles: ['alice', 'bob'],
        counter: 1,
        format: 'words',
        wordCount: 3,
      })
      // Multi-word tokens should have spaces
      expect(result.alice.split(' ').length).toBe(3)
      expect(result.bob.split(' ').length).toBe(3)
    })

    it('rejects identical roles', () => {
      expect(() => handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: 'test',
        roles: ['same', 'same'],
        counter: 1,
      })).toThrow(/distinct/i)
    })

    it('rejects empty namespace', () => {
      expect(() => handleTrustSpokenDirectional({
        secret: TEST_SECRET,
        namespace: '',
        roles: ['a', 'b'],
        counter: 1,
      })).toThrow(/namespace/)
    })
  })

  describe('handleTrustSpokenEncode', () => {
    it('generates PIN-encoded token', () => {
      const result = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'pin-context',
        counter: 42,
        format: 'pin',
        pinDigits: 4,
      })
      expect(result.token).toMatch(/^\d{4}$/)
      expect(result.encoding).toBe('4-digit PIN')
    })

    it('generates hex-encoded token', () => {
      const result = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'hex-context',
        counter: 42,
        format: 'hex',
        hexLength: 8,
      })
      expect(result.token).toMatch(/^[0-9a-f]{8}$/)
      expect(result.encoding).toBe('8-char hex')
    })

    it('generates multi-word token', () => {
      const result = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'words-context',
        counter: 42,
        format: 'words',
        wordCount: 3,
      })
      expect(result.token.split(' ').length).toBe(3)
      expect(result.encoding).toBe('3-word')
    })

    it('single-word encoding matches trust-spoken-challenge output', () => {
      const encoded = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'compat-test',
        counter: 99,
        format: 'words',
        wordCount: 1,
      })
      const challenge = handleTrustSpokenChallenge({
        secret: TEST_SECRET,
        context: 'compat-test',
        counter: 99,
      })
      expect(encoded.token).toBe(challenge.token)
    })

    it('produces deterministic tokens', () => {
      const r1 = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'det',
        counter: 1,
        format: 'pin',
        pinDigits: 6,
      })
      const r2 = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'det',
        counter: 1,
        format: 'pin',
        pinDigits: 6,
      })
      expect(r1.token).toBe(r2.token)
    })

    it('6-digit PIN produces 6 digits', () => {
      const result = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'six-digits',
        counter: 1,
        format: 'pin',
        pinDigits: 6,
      })
      expect(result.token).toMatch(/^\d{6}$/)
    })

    it('uses default digits/length when not specified', () => {
      const pinResult = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'defaults',
        counter: 1,
        format: 'pin',
      })
      expect(pinResult.token).toMatch(/^\d{4}$/) // default 4 digits

      const hexResult = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'defaults',
        counter: 1,
        format: 'hex',
      })
      expect(hexResult.token).toMatch(/^[0-9a-f]{8}$/) // default 8 chars
    })

    it('PIN-encoded token can be verified with spoken-verify', () => {
      const encoded = handleTrustSpokenEncode({
        secret: TEST_SECRET,
        context: 'verify-pin',
        counter: 50,
        format: 'pin',
        pinDigits: 4,
      })
      const verified = handleTrustSpokenVerify({
        secret: TEST_SECRET,
        context: 'verify-pin',
        counter: 50,
        input: encoded.token,
        tolerance: 0,
        encoding: { format: 'pin', digits: 4 },
      })
      expect(verified.valid).toBe(true)
    })
  })
})
