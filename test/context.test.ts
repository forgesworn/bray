import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'

// Valid test key pair — generated for testing only
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const TEST_HEX = 'c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('IdentityContext', () => {
  let IdentityContext: typeof import('../src/context.js').IdentityContext

  beforeEach(async () => {
    const mod = await import('../src/context.js')
    IdentityContext = mod.IdentityContext
  })

  describe('construction', () => {
    it('creates context from nsec and sets master as active identity', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      expect(ctx.activeNpub).toMatch(/^npub1/)
      ctx.destroy()
    })

    it('creates context from hex key', () => {
      const ctx = new IdentityContext(TEST_HEX, 'hex')
      expect(ctx.activeNpub).toMatch(/^npub1/)
      ctx.destroy()
    })

    it('creates context from mnemonic', () => {
      const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
      expect(ctx.activeNpub).toMatch(/^npub1/)
      ctx.destroy()
    })

    it('produces deterministic master npub from same secret', () => {
      const ctx1 = new IdentityContext(TEST_NSEC, 'nsec')
      const ctx2 = new IdentityContext(TEST_NSEC, 'nsec')
      expect(ctx1.activeNpub).toBe(ctx2.activeNpub)
      ctx1.destroy()
      ctx2.destroy()
    })
  })

  describe('derive', () => {
    it('returns identity with correct npub for given purpose/index', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const id = ctx.derive('messaging', 0)
      expect(id.npub).toMatch(/^npub1/)
      expect(id.purpose).toBe('messaging')
      expect(id.index).toBe(0)
      expect(id.npub).not.toBe(ctx.activeNpub) // different from master
      ctx.destroy()
    })

    it('produces deterministic npub for same purpose/index', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const id1 = ctx.derive('messaging', 0)
      const id2 = ctx.derive('messaging', 0)
      expect(id1.npub).toBe(id2.npub)
      ctx.destroy()
    })

    it('produces different npubs for different purposes', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const id1 = ctx.derive('messaging', 0)
      const id2 = ctx.derive('signing', 0)
      expect(id1.npub).not.toBe(id2.npub)
      ctx.destroy()
    })
  })

  describe('derivePersona', () => {
    it('returns persona with name', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const p = ctx.derivePersona('work', 0)
      expect(p.npub).toMatch(/^npub1/)
      expect(p.personaName).toBe('work')
      ctx.destroy()
    })
  })

  describe('switch', () => {
    it('changes active identity', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const masterNpub = ctx.activeNpub
      ctx.derive('alt', 0)
      ctx.switch('alt', 0)
      expect(ctx.activeNpub).not.toBe(masterNpub)
      ctx.destroy()
    })

    it('switch("master") returns to root', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const masterNpub = ctx.activeNpub
      ctx.derive('alt', 0)
      ctx.switch('alt', 0)
      expect(ctx.activeNpub).not.toBe(masterNpub)
      ctx.switch('master')
      expect(ctx.activeNpub).toBe(masterNpub)
      ctx.destroy()
    })

    it('switch to unknown persona derives on the fly', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      ctx.switch('brand-new-purpose', 0)
      expect(ctx.activeNpub).toMatch(/^npub1/)
      ctx.destroy()
    })
  })

  describe('LRU cache', () => {
    it('evicts oldest entry when cache exceeds max size', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec', { maxCache: 3 })
      // Derive 4 identities (plus master = 5 total, but master is separate)
      const first = ctx.derive('first', 0)
      ctx.derive('second', 0)
      ctx.derive('third', 0)
      ctx.derive('fourth', 0) // should evict 'first'

      const list = ctx.listIdentities()
      const npubs = list.map(i => i.npub)
      // 'first' should have been evicted from cache
      expect(npubs).not.toContain(first.npub)
      ctx.destroy()
    })

    it('zeroises evicted identities (privateKey bytes all zero)', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec', { maxCache: 2 })
      const first = ctx.derive('first', 0)
      // Grab a reference to the underlying identity's privateKey before eviction
      const privateKeyRef = ctx._getPrivateKeyRefForTesting(first.npub)
      expect(privateKeyRef).toBeDefined()

      ctx.derive('second', 0)
      ctx.derive('third', 0) // evicts 'first'

      // The referenced bytes should now be zeroed
      expect(privateKeyRef!.every(b => b === 0)).toBe(true)
      ctx.destroy()
    })
  })

  describe('signing', () => {
    it('getSigningFunction returns function that signs events correctly', async () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const sign = ctx.getSigningFunction()
      const event = await sign({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'test note from bray',
      })
      expect(event.sig).toBeDefined()
      expect(event.pubkey).toBeDefined()
      expect(event.id).toBeDefined()
      expect(verifyEvent(event)).toBe(true)
      ctx.destroy()
    })
  })

  describe('listIdentities', () => {
    it('returns npub + purpose + persona name only (no private keys)', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      ctx.derive('messaging', 0)
      ctx.derivePersona('work', 0)
      const list = ctx.listIdentities()
      expect(list.length).toBeGreaterThanOrEqual(3) // master + messaging + work
      for (const entry of list) {
        expect(entry.npub).toMatch(/^npub1/)
        expect(entry).not.toHaveProperty('privateKey')
        expect(entry).not.toHaveProperty('nsec')
      }
      // Check specific entries exist
      expect(list.some(e => e.purpose === 'master')).toBe(true)
      expect(list.some(e => e.purpose === 'messaging')).toBe(true)
      expect(list.some(e => e.personaName === 'work')).toBe(true)
      ctx.destroy()
    })
  })

  describe('destroy', () => {
    it('zeroises all cached identities', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      ctx.derive('a', 0)
      ctx.derive('b', 0)
      const refA = ctx._getPrivateKeyRefForTesting(ctx.derive('a', 0).npub)
      const refB = ctx._getPrivateKeyRefForTesting(ctx.derive('b', 0).npub)
      ctx.destroy()
      expect(refA!.every(b => b === 0)).toBe(true)
      expect(refB!.every(b => b === 0)).toBe(true)
    })
  })

  describe('treeRootPubkey', () => {
    it('returns the nsec-tree root master pubkey', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      expect(ctx.treeRootPubkey).toBeDefined()
      // Tree root pubkey is different from the raw key's npub
      expect(ctx.treeRootPubkey).not.toBe(ctx.activeNpub)
      ctx.destroy()
    })
  })

  describe('LRU cache duplicate', () => {
    it('re-deriving the same identity updates cache without duplicating', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      const first = ctx.derive('same', 0)
      const second = ctx.derive('same', 0)
      expect(first.npub).toBe(second.npub)
      const list = ctx.listIdentities()
      const sameCount = list.filter(i => i.purpose === 'same').length
      expect(sameCount).toBe(1)
      ctx.destroy()
    })
  })

  describe('activePublicKeyHex', () => {
    it('returns 64-char hex public key', () => {
      const ctx = new IdentityContext(TEST_NSEC, 'nsec')
      expect(ctx.activePublicKeyHex).toMatch(/^[0-9a-f]{64}$/)
      ctx.destroy()
    })
  })
})
