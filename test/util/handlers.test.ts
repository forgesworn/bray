import { describe, it, expect, vi } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { nsecEncode, npubEncode, noteEncode, nprofileEncode, neventEncode } from 'nostr-tools/nip19'
import {
  handleDecode,
  handleEncodeNpub,
  handleEncodeNote,
  handleEncodeNprofile,
  handleEncodeNevent,
  handleEncodeNaddr,
  handleVerify,
  handleEncrypt,
  handleDecrypt,
  handleCount,
  handleFetch,
  handleKeyPublic,
  handleEncodeNsec,
  handleFilter,
} from '../../src/util/handlers.js'

// Generate a real keypair for testing
const sk = generateSecretKey()
const skHex = Buffer.from(sk).toString('hex')
const pk = getPublicKey(sk)
const nsec = nsecEncode(sk)
const npub = npubEncode(pk)

describe('util handlers', () => {
  // --- Decode ---

  describe('handleDecode', () => {
    it('decodes npub to hex pubkey', () => {
      const result = handleDecode(npub)
      expect(result.type).toBe('npub')
      expect(result.data).toBe(pk)
    })

    it('decodes nsec — returns pubkey, not private key', () => {
      const result = handleDecode(nsec)
      expect(result.type).toBe('nsec')
      expect((result.data as any).pubkeyHex).toBe(pk)
      expect((result.data as any).warning).toMatch(/not returned/)
      // Must NOT contain the private key hex
      expect(JSON.stringify(result)).not.toContain(skHex)
    })

    it('decodes note to hex event id', () => {
      const note = noteEncode('a'.repeat(64))
      const result = handleDecode(note)
      expect(result.type).toBe('note')
      expect(result.data).toBe('a'.repeat(64))
    })

    it('decodes nprofile with relay hints', () => {
      const nprofile = nprofileEncode({ pubkey: pk, relays: ['wss://relay.example.com'] })
      const result = handleDecode(nprofile)
      expect(result.type).toBe('nprofile')
      expect((result.data as any).pubkey).toBe(pk)
      expect((result.data as any).relays).toContain('wss://relay.example.com')
    })

    it('strips nostr: prefix', () => {
      const result = handleDecode(`nostr:${npub}`)
      expect(result.type).toBe('npub')
    })
  })

  // --- Encode ---

  describe('encode', () => {
    it('encodes hex to npub', () => {
      expect(handleEncodeNpub(pk)).toMatch(/^npub1/)
    })

    it('encodes hex to note', () => {
      expect(handleEncodeNote('a'.repeat(64))).toMatch(/^note1/)
    })

    it('encodes pubkey + relays to nprofile', () => {
      const result = handleEncodeNprofile(pk, ['wss://relay.test.com'])
      expect(result).toMatch(/^nprofile1/)
      // Round-trip
      const decoded = handleDecode(result)
      expect((decoded.data as any).pubkey).toBe(pk)
    })

    it('encodes event pointer to nevent', () => {
      const result = handleEncodeNevent('b'.repeat(64), ['wss://relay.test.com'])
      expect(result).toMatch(/^nevent1/)
    })

    it('encodes addressable event to naddr', () => {
      const result = handleEncodeNaddr(pk, 30078, 'test-d-tag')
      expect(result).toMatch(/^naddr1/)
    })
  })

  // --- Verify ---

  describe('handleVerify', () => {
    it('verifies a valid signed event', () => {
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'test',
      }, sk)
      const result = handleVerify(event as any)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('rejects event with bad signature', () => {
      // Build a fresh event object (not spread from finalized, which caches verification)
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'test',
      }, sk)
      const tampered = {
        kind: event.kind,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags,
        content: event.content,
        id: event.id,
        sig: '0'.repeat(128),
      }
      const result = handleVerify(tampered as any)
      expect(result.valid).toBe(false)
    })

    it('rejects event with missing fields', () => {
      const result = handleVerify({ kind: 1 } as any)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  // --- Encrypt/Decrypt ---

  describe('NIP-44 encrypt/decrypt', () => {
    it('round-trip encrypt then decrypt', () => {
      const sk2 = generateSecretKey()
      const pk2 = getPublicKey(sk2)

      const plaintext = 'hello from nostr-bray'
      const ciphertext = handleEncrypt(skHex, pk2, plaintext)
      expect(ciphertext).not.toBe(plaintext)

      const decrypted = handleDecrypt(Buffer.from(sk2).toString('hex'), pk, ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    it('different messages produce different ciphertexts', () => {
      const sk2 = generateSecretKey()
      const pk2 = getPublicKey(sk2)

      const c1 = handleEncrypt(skHex, pk2, 'message one')
      const c2 = handleEncrypt(skHex, pk2, 'message two')
      expect(c1).not.toBe(c2)
    })
  })

  // --- Count ---

  describe('handleCount', () => {
    it('counts events matching filter', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]),
      }
      const result = await handleCount(pool as any, 'npub1test', { kinds: [1] })
      expect(result.count).toBe(3)
    })
  })

  // --- Fetch ---

  describe('handleFetch', () => {
    it('fetches by note id', async () => {
      const pool = { query: vi.fn().mockResolvedValue([{ id: 'a'.repeat(64) }]) }
      const note = noteEncode('a'.repeat(64))
      const result = await handleFetch(pool as any, 'npub1test', note)
      expect(result.length).toBe(1)
      expect(pool.query).toHaveBeenCalledWith('npub1test', { ids: ['a'.repeat(64)] })
    })

    it('fetches by npub (returns profile)', async () => {
      const pool = { query: vi.fn().mockResolvedValue([{ kind: 0 }]) }
      const result = await handleFetch(pool as any, 'npub1test', npub)
      expect(pool.query).toHaveBeenCalledWith('npub1test', { authors: [pk], kinds: [0], limit: 1 })
    })

    it('strips nostr: prefix', async () => {
      const pool = { query: vi.fn().mockResolvedValue([]) }
      await handleFetch(pool as any, 'npub1test', `nostr:${npub}`)
      expect(pool.query).toHaveBeenCalled()
    })

    it('throws on unsupported type', async () => {
      const pool = { query: vi.fn() }
      await expect(handleFetch(pool as any, 'npub1test', nsec)).rejects.toThrow(/Cannot fetch/)
    })
  })

  // --- Key Public ---

  describe('handleKeyPublic', () => {
    it('derives pubkey from nsec', () => {
      const result = handleKeyPublic(nsec)
      expect(result.pubkeyHex).toBe(pk)
      expect(result.npub).toMatch(/^npub1/)
    })

    it('derives pubkey from hex', () => {
      const result = handleKeyPublic(skHex)
      expect(result.pubkeyHex).toBe(pk)
    })

    it('round-trips with encode', () => {
      const result = handleKeyPublic(nsec)
      expect(handleEncodeNpub(result.pubkeyHex)).toBe(npub)
    })
  })

  // --- Encode nsec ---

  describe('handleEncodeNsec', () => {
    it('encodes hex to nsec', () => {
      const result = handleEncodeNsec(skHex)
      expect(result).toMatch(/^nsec1/)
    })

    it('round-trips with decode (returns pubkey, not hex)', () => {
      const encoded = handleEncodeNsec(skHex)
      const decoded = handleDecode(encoded)
      // decode now returns pubkey instead of private key
      expect((decoded.data as any).pubkeyHex).toBe(pk)
    })
  })

  // --- Filter ---

  describe('handleFilter', () => {
    it('returns true when event matches filter', () => {
      const event = { kind: 1, pubkey: pk, created_at: 1000, tags: [], content: 'hi', id: 'e1', sig: 's1' }
      expect(handleFilter(event as any, { kinds: [1] }).matches).toBe(true)
    })

    it('returns false when event does not match', () => {
      const event = { kind: 1, pubkey: pk, created_at: 1000, tags: [], content: 'hi', id: 'e1', sig: 's1' }
      expect(handleFilter(event as any, { kinds: [7] }).matches).toBe(false)
    })

    it('matches by author', () => {
      const event = { kind: 1, pubkey: pk, created_at: 1000, tags: [], content: 'hi', id: 'e1', sig: 's1' }
      expect(handleFilter(event as any, { authors: [pk] }).matches).toBe(true)
      expect(handleFilter(event as any, { authors: ['wrong'] }).matches).toBe(false)
    })

    it('matches by tag', () => {
      const event = { kind: 1, pubkey: pk, created_at: 1000, tags: [['t', 'nostr']], content: 'hi', id: 'e1', sig: 's1' }
      expect(handleFilter(event as any, { '#t': ['nostr'] } as any).matches).toBe(true)
    })
  })
})
