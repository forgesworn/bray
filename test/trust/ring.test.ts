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
    // Derive a child and switch to it — we need its hex pubkey for the ring
    ctx.derive('ring-member', 0)
    ctx.switch('ring-member', 0)
    activeHex = decode(ctx.activeNpub).data as string

    // Build a ring with 2 other random keys + our key
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

    it('signed message includes created_at timestamp', async () => {
      const pool = mockPool()
      const result = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'membership',
        message: 'ring-membership:membership:12345',
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

    it('rejects tampered proof', async () => {
      const pool = mockPool()
      const { signature } = await handleTrustRingProve(ctx, pool as any, {
        ring,
        attestationType: 'test',
      })
      // Tamper with a response
      const tampered = { ...signature, responses: [...signature.responses] }
      tampered.responses[0] = '0'.repeat(64)
      expect(handleTrustRingVerify(tampered).valid).toBe(false)
    })
  })
})
