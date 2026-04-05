import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleGroupInfo, handleGroupChat, handleGroupSend, handleGroupMembers } from '../../src/social/groups.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay'], rejected: [], errors: [] }),
  }
}

describe('NIP-29 group handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleGroupInfo', () => {
    it('returns group metadata from kind 39000', async () => {
      const events = [{
        kind: 39000,
        pubkey: 'relay',
        created_at: 1000,
        tags: [['d', 'test-group'], ['name', 'Test Group'], ['about', 'A test group'], ['open']],
        content: '',
        id: 'g1',
        sig: 's1',
      }]
      const pool = mockPool(events)
      const result = await handleGroupInfo(pool as any, 'npub1test', { relay: 'wss://test', groupId: 'test-group' })
      expect(result.name).toBe('Test Group')
      expect(result.about).toBe('A test group')
      expect(result.isOpen).toBe(true)
    })

    it('takes highest created_at from multiple metadata events', async () => {
      const events = [
        { kind: 39000, pubkey: 'r', created_at: 500, tags: [['d', 'g'], ['name', 'Old']], content: '', id: '1', sig: 's' },
        { kind: 39000, pubkey: 'r', created_at: 1000, tags: [['d', 'g'], ['name', 'New']], content: '', id: '2', sig: 's' },
      ]
      const pool = mockPool(events)
      const result = await handleGroupInfo(pool as any, 'npub1test', { relay: 'wss://test', groupId: 'g' })
      expect(result.name).toBe('New')
    })

    it('returns minimal info when no metadata found', async () => {
      const pool = mockPool([])
      const result = await handleGroupInfo(pool as any, 'npub1test', { relay: 'wss://test', groupId: 'unknown' })
      expect(result.id).toBe('unknown')
      expect(result.name).toBeUndefined()
    })
  })

  describe('handleGroupChat', () => {
    it('fetches and sorts kind 9 messages', async () => {
      const events = [
        { kind: 9, pubkey: 'user1', created_at: 200, tags: [['h', 'g1']], content: 'second', id: 'm2', sig: 's2' },
        { kind: 9, pubkey: 'user2', created_at: 100, tags: [['h', 'g1']], content: 'first', id: 'm1', sig: 's1' },
      ]
      const pool = mockPool(events)
      const result = await handleGroupChat(pool as any, 'npub1test', { groupId: 'g1' })
      expect(result.length).toBe(2)
      expect(result[0].content).toBe('first') // sorted by created_at
      expect(result[1].content).toBe('second')
    })

    it('queries with h-tag filter', async () => {
      const pool = mockPool([])
      await handleGroupChat(pool as any, 'npub1test', { groupId: 'my-group', limit: 10 })
      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        kinds: [9],
        '#h': ['my-group'],
        limit: 10,
      }))
    })
  })

  describe('handleGroupSend', () => {
    it('creates kind 9 event with h-tag', async () => {
      const pool = mockPool()
      const result = await handleGroupSend(ctx, pool as any, {
        groupId: 'test-group',
        content: 'hello group!',
      })
      expect(result.event.kind).toBe(9)
      const hTag = result.event.tags.find(t => t[0] === 'h')
      expect(hTag![1]).toBe('test-group')
      expect(result.event.content).toBe('hello group!')
    })
  })

  describe('handleGroupMembers', () => {
    it('parses member list from kind 39002', async () => {
      const events = [{
        kind: 39002,
        pubkey: 'relay',
        created_at: 1000,
        tags: [['d', 'test-group'], ['p', 'member1'], ['p', 'member2', '', 'admin']],
        content: '',
        id: 'ml1',
        sig: 's1',
      }]
      const pool = mockPool(events)
      const result = await handleGroupMembers(pool as any, 'npub1test', { groupId: 'test-group' })
      expect(result.length).toBe(2)
      expect(result[0].pubkey).toBe('member1')
      expect(result[1].role).toBe('admin')
    })

    it('takes highest created_at from multiple member events', async () => {
      const events = [
        { kind: 39002, pubkey: 'r', created_at: 500, tags: [['d', 'g'], ['p', 'old']], content: '', id: '1', sig: 's' },
        { kind: 39002, pubkey: 'r', created_at: 1000, tags: [['d', 'g'], ['p', 'new']], content: '', id: '2', sig: 's' },
      ]
      const pool = mockPool(events)
      const result = await handleGroupMembers(pool as any, 'npub1test', { groupId: 'g' })
      expect(result.length).toBe(1)
      expect(result[0].pubkey).toBe('new')
    })

    it('returns empty when no member list found', async () => {
      const pool = mockPool([])
      const result = await handleGroupMembers(pool as any, 'npub1test', { groupId: 'empty' })
      expect(result).toEqual([])
    })
  })
})
