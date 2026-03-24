import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleDmSend, handleDmRead } from '../../src/social/dm.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const VALID_PUBKEY = '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('DM module', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleDmSend — NIP-17', () => {
    it('creates NIP-17 gift-wrapped DM by default', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'hello via NIP-17',
      })
      expect(result.protocol).toBe('nip17')
      expect(result.event.kind).toBe(1059) // gift wrap kind
    })

    it('publishes the event to relays', async () => {
      const pool = mockPool()
      await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'publish check',
      })
      expect(pool.publish).toHaveBeenCalled()
    })

    it('gift wrap does not expose sender pubkey directly', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'secret message',
      })
      // Gift wrap uses a random ephemeral key, not the sender's identity
      const { decode } = await import('nostr-tools/nip19')
      const senderHex = decode(ctx.activeNpub).data as string
      expect(result.event.pubkey).not.toBe(senderHex)
    })

    it('returns publish result', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'test',
      })
      expect(result.publish.success).toBe(true)
    })
  })

  describe('handleDmSend — NIP-04', () => {
    it('errors when nip04 requested but not enabled', async () => {
      const pool = mockPool()
      await expect(handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'hello via NIP-04',
        nip04: true,
        nip04Enabled: false,
      })).rejects.toThrow(/nip.?04.*not enabled/i)
    })

    it('creates kind 4 event when nip04 requested and enabled', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'hello via NIP-04',
        nip04: true,
        nip04Enabled: true,
      })
      expect(result.protocol).toBe('nip04-deprecated')
      expect(result.event.kind).toBe(4)
    })

    it('NIP-04 event has p-tag for recipient', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'tagged',
        nip04: true,
        nip04Enabled: true,
      })
      const pTag = result.event.tags.find(t => t[0] === 'p')
      expect(pTag![1]).toBe(VALID_PUBKEY)
    })

    it('NIP-04 content is encrypted (not plaintext)', async () => {
      const pool = mockPool()
      const result = await handleDmSend(ctx, pool as any, {
        recipientPubkeyHex: VALID_PUBKEY,
        message: 'should be encrypted',
        nip04: true,
        nip04Enabled: true,
      })
      expect(result.event.content).not.toBe('should be encrypted')
      expect(result.event.content).toContain('?iv=') // NIP-04 format
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

    it('does not throw on decrypt failure — returns error metadata instead', async () => {
      const badEvents = [
        { kind: 1059, pubkey: 'a', created_at: 1, tags: [], content: 'bad', id: '1', sig: 's' },
        { kind: 4, pubkey: 'b', created_at: 2, tags: [], content: 'bad', id: '2', sig: 's' },
      ]
      const pool = mockPool(badEvents)
      const result = await handleDmRead(ctx, pool as any)
      expect(result.length).toBe(2)
      expect(result.every(r => r.decrypted === false)).toBe(true)
    })

    it('labels NIP-04 messages as deprecated', async () => {
      const kind4Event = {
        kind: 4,
        pubkey: 'somepub',
        created_at: 1000,
        tags: [],
        content: 'encrypted-nip04',
        id: 'dm2',
        sig: 'sig2',
      }
      const pool = mockPool([kind4Event])
      const result = await handleDmRead(ctx, pool as any)
      expect(result[0].protocol).toBe('nip04-deprecated')
    })
  })
})
