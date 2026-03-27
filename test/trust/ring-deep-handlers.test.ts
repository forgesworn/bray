import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleTrustRingLsagSign, handleTrustRingLsagVerify, handleTrustRingKeyImage } from '../../src/trust/ring-deep-handlers.js'
import { decode } from 'nostr-tools/nip19'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool() {
  return {
    query: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('LSAG ring signatures', () => {
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

  describe('handleTrustRingLsagSign', () => {
    it('creates valid LSAG signature with key image', async () => {
      const pool = mockPool()
      const result = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'vote-2026-q1',
        message: 'I vote yes',
      })
      expect(result.signature).toBeDefined()
      expect(result.signature.keyImage).toBeDefined()
      expect(result.signature.electionId).toBe('vote-2026-q1')
      expect(result.signature.ring.length).toBe(3)
      expect(result.event.kind).toBe(30078)
    })

    it('event has LSAG-specific d-tag', async () => {
      const pool = mockPool()
      const result = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'test-election',
        message: 'test',
      })
      const dTag = result.event.tags.find(t => t[0] === 'd')
      expect(dTag![1]).toMatch(/^lsag-proof:test-election:/)
    })

    it('event has election-id tag', async () => {
      const pool = mockPool()
      const result = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'my-election',
        message: 'test',
      })
      const electionTag = result.event.tags.find(t => t[0] === 'election-id')
      expect(electionTag![1]).toBe('my-election')
    })

    it('event has key-image tag', async () => {
      const pool = mockPool()
      const result = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'my-election',
        message: 'test',
      })
      const kiTag = result.event.tags.find(t => t[0] === 'key-image')
      expect(kiTag).toBeDefined()
      expect(kiTag![1]).toBe(result.signature.keyImage)
    })

    it('errors when active identity not in ring', async () => {
      const pool = mockPool()
      const fakeRing = [
        getPublicKey(generateSecretKey()),
        getPublicKey(generateSecretKey()),
      ]
      await expect(handleTrustRingLsagSign(ctx, pool as any, {
        ring: fakeRing,
        electionId: 'test',
        message: 'test',
      })).rejects.toThrow(/not found in ring/i)
    })

    it('same signer same election produces same key image', async () => {
      const pool = mockPool()
      const r1 = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'deterministic-test',
        message: 'message-1',
      })
      const r2 = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'deterministic-test',
        message: 'message-2',
      })
      expect(r1.signature.keyImage).toBe(r2.signature.keyImage)
    })

    it('different elections produce different key images', async () => {
      const pool = mockPool()
      const r1 = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'election-a',
        message: 'test',
      })
      const r2 = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'election-b',
        message: 'test',
      })
      expect(r1.signature.keyImage).not.toBe(r2.signature.keyImage)
    })
  })

  describe('handleTrustRingLsagVerify', () => {
    it('verifies a valid LSAG proof', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'verify-test',
        message: 'hello',
      })
      const result = handleTrustRingLsagVerify(signature)
      expect(result.valid).toBe(true)
      expect(result.keyImage).toBe(signature.keyImage)
      expect(result.duplicate).toBe(false)
    })

    it('verifies from a Nostr event (parses content)', async () => {
      const pool = mockPool()
      const { event } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'verify-event-test',
        message: 'hello',
      })
      const result = handleTrustRingLsagVerify(event)
      expect(result.valid).toBe(true)
    })

    it('detects duplicate key image', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'dup-test',
        message: 'first vote',
      })
      const { signature: sig2 } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'dup-test',
        message: 'second vote',
      })

      const result = handleTrustRingLsagVerify(sig2, [signature.keyImage])
      expect(result.valid).toBe(true)
      expect(result.duplicate).toBe(true)
    })

    it('no duplicate when key image is fresh', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'fresh-test',
        message: 'vote',
      })
      const result = handleTrustRingLsagVerify(signature, ['0300'.padEnd(66, 'a')])
      expect(result.valid).toBe(true)
      expect(result.duplicate).toBe(false)
    })

    it('rejects tampered LSAG signature', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId: 'tamper-test',
        message: 'test',
      })
      const tampered = { ...signature, message: 'tampered' }
      const result = handleTrustRingLsagVerify(tampered)
      expect(result.valid).toBe(false)
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
      const result = handleTrustRingLsagVerify(fakeEvent as any)
      expect(result.valid).toBe(false)
    })
  })

  describe('handleTrustRingKeyImage', () => {
    it('computes a key image for the active identity', () => {
      const result = handleTrustRingKeyImage(ctx, { electionId: 'test-election' })
      expect(result.keyImage).toBeDefined()
      expect(typeof result.keyImage).toBe('string')
      expect(result.keyImage.length).toBe(66) // compressed point hex
    })

    it('produces deterministic key images', () => {
      const r1 = handleTrustRingKeyImage(ctx, { electionId: 'det-test' })
      const r2 = handleTrustRingKeyImage(ctx, { electionId: 'det-test' })
      expect(r1.keyImage).toBe(r2.keyImage)
    })

    it('produces different key images for different elections', () => {
      const r1 = handleTrustRingKeyImage(ctx, { electionId: 'election-x' })
      const r2 = handleTrustRingKeyImage(ctx, { electionId: 'election-y' })
      expect(r1.keyImage).not.toBe(r2.keyImage)
    })

    it('matches key image from full LSAG signature', async () => {
      const pool = mockPool()
      const electionId = 'match-test'

      const precomputed = handleTrustRingKeyImage(ctx, { electionId })
      const { signature } = await handleTrustRingLsagSign(ctx, pool as any, {
        ring,
        electionId,
        message: 'test',
      })

      expect(precomputed.keyImage).toBe(signature.keyImage)
    })
  })
})
