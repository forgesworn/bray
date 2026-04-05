import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleNipPublish, handleNipRead } from '../../src/social/nips.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('NIP-30817 (NIPs on Nostr)', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleNipPublish', () => {
    it('creates kind 30817 event with d-tag and title', async () => {
      const pool = mockPool()
      const result = await handleNipPublish(ctx, pool as any, {
        identifier: 'sovereign-identity',
        title: 'Sovereign Identity Protocol',
        content: '# Sovereign Identity\n\nThis NIP defines...',
      })
      expect(result.event.kind).toBe(30817)
      const dTag = result.event.tags.find(t => t[0] === 'd')
      expect(dTag![1]).toBe('sovereign-identity')
      const titleTag = result.event.tags.find(t => t[0] === 'title')
      expect(titleTag![1]).toBe('Sovereign Identity Protocol')
    })

    it('includes k-tags for defined kinds', async () => {
      const pool = mockPool()
      const result = await handleNipPublish(ctx, pool as any, {
        identifier: 'multi-kind',
        title: 'Multi-Kind NIP',
        content: 'defines kinds 30100 and 30101',
        kinds: [30100, 30101],
      })
      const kTags = result.event.tags.filter(t => t[0] === 'k')
      expect(kTags.length).toBe(2)
      expect(kTags[0][1]).toBe('30100')
      expect(kTags[1][1]).toBe('30101')
    })

    it('content contains markdown spec', async () => {
      const pool = mockPool()
      const md = '# My NIP\n\n## Abstract\n\nDefines event kind 42000.'
      const result = await handleNipPublish(ctx, pool as any, {
        identifier: 'my-nip',
        title: 'My NIP',
        content: md,
      })
      expect(result.event.content).toBe(md)
    })
  })

  describe('handleNipRead', () => {
    it('fetches and parses community NIPs', async () => {
      const events = [{
        kind: 30817,
        pubkey: 'author1',
        created_at: 1000,
        tags: [
          ['d', 'gaming-events'],
          ['title', 'Gaming Events Protocol'],
          ['k', '30100'],
        ],
        content: '# Gaming Events\n\nDefines kind 30100...',
        id: 'nip1',
        sig: 'sig1',
      }]
      const pool = mockPool(events)
      const result = await handleNipRead(pool as any, 'npub1test', {})
      expect(result.length).toBe(1)
      expect(result[0].identifier).toBe('gaming-events')
      expect(result[0].title).toBe('Gaming Events Protocol')
      expect(result[0].kinds).toEqual([30100])
    })

    it('filters by author', async () => {
      const pool = mockPool([])
      await handleNipRead(pool as any, 'npub1test', { author: 'abc123' })
      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({ authors: ['abc123'] }))
    })

    it('filters by kind number', async () => {
      const pool = mockPool([])
      await handleNipRead(pool as any, 'npub1test', { kind: 30100 })
      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({ '#k': ['30100'] }))
    })
  })
})
