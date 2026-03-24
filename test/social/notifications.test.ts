import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleNotifications, handleFeed } from '../../src/social/notifications.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
  }
}

describe('notifications', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleNotifications', () => {
    it('fetches events with p-tag = active npub', async () => {
      const pool = mockPool([])
      await handleNotifications(ctx, pool as any)
      expect(pool.query).toHaveBeenCalled()
    })

    it('excludes kind 3 (follows) from notifications', async () => {
      const events = [
        { kind: 1, pubkey: 'author1', created_at: 1000, tags: [['p', ctx.activeNpub]], content: 'mention', id: 'e1', sig: 's1' },
        { kind: 3, pubkey: 'author2', created_at: 1001, tags: [['p', ctx.activeNpub]], content: '', id: 'e2', sig: 's2' },
        { kind: 7, pubkey: 'author3', created_at: 1002, tags: [['p', ctx.activeNpub], ['e', 'someevent']], content: '+', id: 'e3', sig: 's3' },
      ]
      const pool = mockPool(events)
      const result = await handleNotifications(ctx, pool as any)
      expect(result.length).toBe(2)
      expect(result.every(n => n.kind !== 3)).toBe(true)
    })

    it('returns parsed reactions, replies, mentions', async () => {
      const events = [
        { kind: 1, pubkey: 'auth1', created_at: 1000, tags: [['p', ctx.activeNpub], ['e', 'parent', '', 'reply']], content: 'nice', id: 'reply1', sig: 's1' },
        { kind: 7, pubkey: 'auth2', created_at: 1001, tags: [['p', ctx.activeNpub], ['e', 'mypost']], content: '🔥', id: 'react1', sig: 's2' },
        { kind: 1, pubkey: 'auth3', created_at: 1002, tags: [['p', ctx.activeNpub]], content: 'hey @you', id: 'mention1', sig: 's3' },
      ]
      const pool = mockPool(events)
      const result = await handleNotifications(ctx, pool as any)
      const types = result.map(n => n.type)
      expect(types).toContain('reply')
      expect(types).toContain('reaction')
      expect(types).toContain('mention')
    })

    it('parses zap receipts with amount in sats', async () => {
      const zapReceipt = {
        kind: 9735,
        pubkey: 'zapnode',
        created_at: 1000,
        tags: [
          ['p', ctx.activeNpub],
          ['bolt11', 'lnbc10000n1...'], // 10000 msats = 10 sats
          ['description', JSON.stringify({
            kind: 9734,
            pubkey: 'sender1',
            content: 'great work!',
            tags: [['amount', '10000']],
          })],
        ],
        content: '',
        id: 'zap1',
        sig: 's1',
      }
      const pool = mockPool([zapReceipt])
      const result = await handleNotifications(ctx, pool as any)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('zap')
      expect(result[0].amountMsats).toBe(10000)
    })
  })

  describe('handleFeed', () => {
    it('fetches kind 1 events', async () => {
      const events = [
        { kind: 1, pubkey: 'auth1', created_at: 1000, tags: [], content: 'post 1', id: 'f1', sig: 's1' },
        { kind: 1, pubkey: 'auth2', created_at: 1001, tags: [], content: 'post 2', id: 'f2', sig: 's2' },
      ]
      const pool = mockPool(events)
      const result = await handleFeed(ctx, pool as any, {})
      expect(result.length).toBe(2)
    })

    it('respects limit parameter', async () => {
      const events = [
        { kind: 1, pubkey: 'auth1', created_at: 1000, tags: [], content: 'post 1', id: 'f1', sig: 's1' },
      ]
      const pool = mockPool(events)
      const result = await handleFeed(ctx, pool as any, { limit: 5 })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({ limit: 5 }),
      )
    })
  })
})
