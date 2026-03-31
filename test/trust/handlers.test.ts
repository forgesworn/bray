import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleTrustAttest,
  handleTrustRead,
  handleTrustVerify,
  handleTrustRevoke,
  handleTrustRequest,
  handleTrustProofPublish,
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
        identifier: 'ab'.repeat(32),
        subject: 'ab'.repeat(32),
        summary: 'Verified identity in person',
      })
      expect(result.event.kind).toBe(31000)
      expect(result.event.sig).toBeDefined()
    })

    it('warns when attesting as derived persona', async () => {
      const pool = mockPool()
      await ctx.derive('alt', 0)
      await ctx.switch('alt', 0)
      const result = await handleTrustAttest(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'cd'.repeat(32),
      })
      expect(result.warning).toMatch(/derived|persona/i)
    })

    it('creates assertion-first attestation with e-tag', async () => {
      const pool = mockPool()
      const result = await handleTrustAttest(ctx, pool as any, {
        subject: 'def456'.padEnd(64, '0'),
        assertionId: 'e'.repeat(64),
        assertionRelay: 'wss://relay.example.com',
        summary: 'Verified in person',
      })
      const eTags = result.event.tags.filter((t: string[]) => t[0] === 'e' && t[3] === 'assertion')
      expect(eTags.length).toBe(1)
      expect(eTags[0][1]).toBe('e'.repeat(64))
      // d-tag should use assertion: prefix
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toMatch(/^assertion:/)
      // no type tag when assertion-only
      const typeTag = result.event.tags.find((t: string[]) => t[0] === 'type')
      expect(typeTag).toBeUndefined()
    })

    it('creates hybrid attestation (assertion ref + explicit type)', async () => {
      const pool = mockPool()
      const result = await handleTrustAttest(ctx, pool as any, {
        type: 'credential',
        subject: 'def456'.padEnd(64, '0'),
        assertionId: 'e'.repeat(64),
        summary: 'Hybrid attestation',
      })
      // d-tag still uses assertion: prefix (assertion wins)
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toMatch(/^assertion:/)
      // type tag present for filtering
      const typeTag = result.event.tags.find((t: string[]) => t[0] === 'type')
      expect(typeTag![1]).toBe('credential')
    })

    it('rejects when neither type nor assertionId provided', async () => {
      const pool = mockPool()
      await expect(handleTrustAttest(ctx, pool as any, {
        subject: 'def456'.padEnd(64, '0'),
        summary: 'Missing both',
      })).rejects.toThrow(/type or assertionId/)
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
        identifier: 'cd'.repeat(32),
        subject: 'cd'.repeat(32),
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
        identifier: 'cd'.repeat(32),
      })
      expect(result.event.kind).toBe(31000)
      // Revocation replaces the original via same d-tag
    })

    it('errors if active identity does not match original attestor', async () => {
      const pool = mockPool()
      await expect(handleTrustRevoke(ctx, pool as any, {
        type: 'identity-verification',
        identifier: 'cd'.repeat(32),
        originalAttestorPubkey: 'someone-elses-pubkey',
      })).rejects.toThrow(/attestor/i)
    })
  })

  describe('handleTrustRequest', () => {
    it('sends NIP-17 DM with correct JSON payload', async () => {
      const pool = mockPool()
      const result = await handleTrustRequest(ctx, pool as any, {
        recipientPubkeyHex: '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4',
        subject: 'cd'.repeat(32),
        attestationType: 'identity-verification',
        message: 'Please verify my identity',
      })
      expect(result.event.kind).toBe(1059) // gift wrap
    })
  })

  describe('handleTrustProofPublish', () => {
    it('requires confirm: true (returns warning when false)', async () => {
      const pool = mockPool()
      await ctx.derive('child', 0)
      await ctx.switch('child', 0)
      const result = await handleTrustProofPublish(ctx, pool as any, { confirm: false })
      expect(result.published).toBe(false)
      expect(result.warning).toMatch(/confirm/i)
    })

    it('publishes kind 30078 when confirmed', async () => {
      const pool = mockPool()
      await ctx.derive('child', 0)
      await ctx.switch('child', 0)
      const result = await handleTrustProofPublish(ctx, pool as any, { confirm: true })
      expect(result.published).toBe(true)
      expect(result.event!.kind).toBe(30078)
    })

    it('returns warning about what the proof reveals', async () => {
      const pool = mockPool()
      await ctx.derive('child', 0)
      await ctx.switch('child', 0)
      const blind = await handleTrustProofPublish(ctx, pool as any, { mode: 'blind', confirm: false })
      expect(blind.warning).toMatch(/blind/i)
      const full = await handleTrustProofPublish(ctx, pool as any, { mode: 'full', confirm: false })
      expect(full.warning).toMatch(/full/i)
    })
  })

  describe('handleTrustRequestList', () => {
    it('returns empty when no DMs match', async () => {
      // Mock DM read to return non-matching DMs
      vi.doMock('../../src/social/dm.js', () => ({
        handleDmRead: vi.fn().mockResolvedValue([
          { decrypted: true, content: '{"type":"random","v":1}', from: 'someone' },
          { decrypted: false, content: null, from: 'other' },
        ]),
      }))
      const { handleTrustRequestList: listFn } = await import('../../src/trust/handlers.js')
      const pool = mockPool()
      const result = await listFn(ctx, pool as any)
      expect(result).toEqual([])
      vi.doUnmock('../../src/social/dm.js')
    })
  })

  describe('edge cases', () => {
    it('trust_attest warns when attesting as derived persona', async () => {
      const pool = mockPool()
      await ctx.derive('persona-x', 0)
      await ctx.switch('persona-x', 0)
      const result = await handleTrustAttest(ctx, pool as any, {
        type: 'test',
        identifier: 'test-id',
      })
      expect(result.warning).toMatch(/derived|persona/i)
    })

    it('trust_revoke throws when active identity mismatches attestor', async () => {
      const pool = mockPool()
      await expect(handleTrustRevoke(ctx, pool as any, {
        type: 'test',
        identifier: 'test',
        originalAttestorPubkey: 'completely-different-hex-pubkey-that-does-not-match-active',
      })).rejects.toThrow(/attestor/i)
    })
  })
})
