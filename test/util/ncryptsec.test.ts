import { describe, it, expect } from 'vitest'
import { handleKeyEncrypt, handleKeyDecrypt } from '../../src/util/ncryptsec.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'

const sk = generateSecretKey()
const skHex = Buffer.from(sk).toString('hex')
const nsec = nsecEncode(sk)
const pk = getPublicKey(sk)

describe('NIP-49 ncryptsec', { timeout: 30_000 }, () => {
  describe('handleKeyEncrypt', () => {
    it('encrypts nsec and returns ncryptsec + pubkey', () => {
      const result = handleKeyEncrypt(nsec, 'testpassword')
      expect(result.ncryptsec).toMatch(/^ncryptsec1/)
      expect(result.pubkeyHex).toBe(pk)
      expect(result.npub).toMatch(/^npub1/)
    })

    it('encrypts hex key', () => {
      const result = handleKeyEncrypt(skHex, 'testpassword')
      expect(result.ncryptsec).toMatch(/^ncryptsec1/)
      expect(result.pubkeyHex).toBe(pk)
    })

    it('different passwords produce different ncryptsec', () => {
      const r1 = handleKeyEncrypt(nsec, 'password1')
      const r2 = handleKeyEncrypt(nsec, 'password2')
      expect(r1.ncryptsec).not.toBe(r2.ncryptsec)
    })
  })

  describe('handleKeyDecrypt', () => {
    it('round-trip: encrypt then decrypt returns same pubkey', () => {
      const encrypted = handleKeyEncrypt(nsec, 'roundtrip')
      const decrypted = handleKeyDecrypt(encrypted.ncryptsec, 'roundtrip')
      expect(decrypted.pubkeyHex).toBe(pk)
      expect(decrypted.npub).toBe(encrypted.npub)
    })

    it('wrong password throws', () => {
      const encrypted = handleKeyEncrypt(nsec, 'correct')
      expect(() => handleKeyDecrypt(encrypted.ncryptsec, 'wrong')).toThrow()
    })

    it('never returns the raw private key', () => {
      const encrypted = handleKeyEncrypt(nsec, 'safe')
      const decrypted = handleKeyDecrypt(encrypted.ncryptsec, 'safe')
      const serialised = JSON.stringify(decrypted)
      expect(serialised).not.toContain(skHex)
      expect(serialised).not.toContain('nsec1')
      expect(serialised).not.toContain('privateKey')
    })
  })
})
