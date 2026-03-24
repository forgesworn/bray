import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleTrustRingProve, handleTrustRingVerify } from '../../src/trust/ring.js'
import { decode } from 'nostr-tools/nip19'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool() {
  return {
    query: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('ring signatures', () => {
  let ctx: IdentityContext
  let activeHex: string
  let ring: string[]

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    ctx.derive('ring-member', 0)
    ctx.switch('ring-member', 0)
    activeHex = decode(ctx.activeNpub).data as string

    const other1 = getPublicKey(generateSecretKey())
    const other2 = getPublicKey(generateSecretKey())
    ring = [other1, activeHex, other2]
  })

  describe('handleTrustRingProve', () => {
    it('creates valid ring signature with pre-built ring', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'membership',
      })
      expect(result.signature).toBeDefined()
      expect(result.signature.ring.length).toBe(3)
      expect(result.event.kind).toBe(30078)
    })

    it('event has correct d-tag prefix', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      const dTag = result.event.tags.find(t => t[0] === 'd')
      expect(dTag![1]).toMatch(/^ring-proof:/)
    })

    it('event has attestation-type tag', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'kyc-verified',
      })
      const typeTag = result.event.tags.find(t => t[0] === 'attestation-type')
      expect(typeTag![1]).toBe('kyc-verified')
    })

    it('event has p-tags for all ring members', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      const pTags = result.event.tags.filter(t => t[0] === 'p')
      expect(pTags.length).toBe(3)
    })

    it('errors when active identity not in ring', async () => {
      const pool = mockPool()
      const fakeRing = [
        getPublicKey(generateSecretKey()),
        getPublicKey(generateSecretKey()),
      ]
      await expect(handleTrustRingProve(ctx, pool as any, {
        ring: fakeRing,
        attestationType: 'test',
      })).rejects.toThrow(/not found in ring/i)
    })

    it('custom message is used when provided', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
        message: 'custom-message-for-signing',
      })
      expect(result.signature.message).toBeDefined()
    })
  })

  describe('handleTrustRingVerify', () => {
    it('verifies a valid proof', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      expect(handleTrustRingVerify(signature).valid).toBe(true)
    })

    it('verifies from a Nostr event (parses content)', async () => {
      const pool = mockPool()
      const { event } = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      expect(handleTrustRingVerify(event).valid).toBe(true)
    })

    it('rejects tampered proof — modified response', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      const tampered = { ...signature, responses: [...signature.responses] }
      tampered.responses[0] = '0'.repeat(64)
      expect(handleTrustRingVerify(tampered).valid).toBe(false)
    })

    it('rejects tampered proof — modified message', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      const tampered = { ...signature, message: '0'.repeat(64) }
      expect(handleTrustRingVerify(tampered).valid).toBe(false)
    })

    it('returns false for malformed event content', () => {
      const fakeEvent = {
        kind: 30078,
        pubkey: 'abc',
        created_at: 1000,
        tags: [],
        content: 'not-json',
        id: 'bad',
        sig: 'sig',
      }
      expect(handleTrustRingVerify(fakeEvent as any).valid).toBe(false)
    })
  })
})
