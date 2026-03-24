import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleDmSend, handleDmRead } from '../../src/social/dm.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('DM module', () => {
  let ctx: IdentityContext
  let ctx2: IdentityContext // second identity for round-trip tests

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    // Derive a second identity to test DMs between two parties
    ctx.derive('recipient', 0)
  })

  describe('handleDmSend', () => {
    it('creates NIP-17 gift-wrapped DM by default', async () => {
      const pool = mockPool()
      // Get recipient's hex pubkey from a derived identity
      const recipientId = ctx.derive('recipient', 0)
      // We need the hex pubkey, not npub — let's use a known hex
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4',
        message: 'hello via NIP-17',
      })
      expect(result.protocol).toBe('nip17')
      expect(result.event).toBeDefined()
      expect(result.event.kind).toBe(1059) // gift wrap kind
    })

    it('errors when nip04 requested but not enabled', async () => {
      const pool = mockPool()
      await expect(handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4',
        message: 'hello via NIP-04',
        nip04: true,
        nip04Enabled: false,
      })).rejects.toThrow(/nip.?04.*not enabled/i)
    })

    it('creates kind 4 event when nip04 requested and enabled', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4',
        message: 'hello via NIP-04',
        nip04: true,
        nip04Enabled: true,
      })
      expect(result.protocol).toBe('nip04-deprecated')
      expect(result.event.kind).toBe(4)
    })
  })

  describe('handleDmRead', () => {
    it('returns empty array when no DMs found', async () => {
      const pool = mockPool([])
      const result = await handleDmRead(ctx, pool as any)
      expect(result).toEqual([])
    })

    it('returns metadata with "could not decrypt" flag on decryption failure', async () => {
      const fakeGiftWrap = {
        kind: 1059,
        pubkey: 'somepub',
        created_at: 1000,
        tags: [['p', 'mypub']],
        content: 'garbled-encrypted-content',
        id: 'dm1',
        sig: 'sig1',
      }
      const pool = mockPool([fakeGiftWrap])
      const result = await handleDmRead(ctx, pool as any)
      expect(result.length).toBe(1)
      expect(result[0].decrypted).toBe(false)
      expect(result[0].error).toMatch(/could not decrypt/i)
    })
  })
})
