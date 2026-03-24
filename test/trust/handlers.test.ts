import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleTrustAttest,
  handleTrustRead,
  handleTrustVerify,
  handleTrustRevoke,
} from '../../src/trust/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('trust handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleTrustAttest', () => {
    it('creates kind 31000 event', async () => {
      const pool = mockPool()
      const result = await handleTrustAttest(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'subject-pubkey-hex',
        subject: 'subject-pubkey-hex',
        summary: 'Verified identity in person',
      })
      expect(result.event.kind).toBe(31000)
      expect(result.event.sig).toBeDefined()
    })

    it('warns when attesting as derived persona', async () => {
      const pool = mockPool()
      ctx.derive('alt', 0)
      ctx.switch('alt', 0)
      const result = await handleTrustAttest(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'subject-hex',
      })
      expect(result.warning).toMatch(/derived|persona/i)
    })
  })

  describe('handleTrustRead', () => {
    it('filters attestations by pubkey and type', async () => {
      const events = [
        {
          kind: 31000,
          pubkey: 'attestor1',
          created_at: 1000,
          tags: [['d', 'identity-verification:subject1'], ['p', 'subject1']],
          content: 'verified',
          id: 'att1',
          sig: 'sig1',
        },
      ]
      const pool = mockPool(events)
      const result = await handleTrustRead(pool as any, 'somenpub', {
        subject: 'subject1',
        type: 'identity-verification',
      })
      expect(result.length).toBe(1)
    })
  })

  describe('handleTrustVerify', () => {
    it('validates attestation event structure', async () => {
      const pool = mockPool()
      const attestResult = await handleTrustAttest(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'subject-hex',
        subject: 'subject-hex',
      })
      const result = handleTrustVerify(attestResult.event)
      expect(result.valid).toBe(true)
    })

    it('rejects invalid attestation', () => {
      const badEvent = {
        kind: 31000,
        pubkey: 'abc',
        created_at: 1000,
        tags: [], // missing required d-tag
        content: '',
        id: 'bad1',
        sig: 'sig1',
      }
      const result = handleTrustVerify(badEvent as any)
      expect(result.valid).toBe(false)
    })
  })

  describe('handleTrustRevoke', () => {
    it('creates revocation event', async () => {
      const pool = mockPool()
      const result = await handleTrustRevoke(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'subject-hex',
      })
      expect(result.event.kind).toBe(31000)
      // Revocation replaces the original via same d-tag
    })

    it('errors if active identity does not match original attestor', async () => {
      const pool = mockPool()
      await expect(handleTrustRevoke(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'subject-hex',
        originalAttestorPubkey: 'someone-elses-pubkey',
      })).rejects.toThrow(/attestor/i)
    })
  })
})
