import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { verifyEvent } from 'nostr-tools/pure'
import {
  handleWikiPublish,
  handleWikiRead,
  handleWikiList,
  WIKI_KIND,
} from '../../src/social/wiki.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

function makeWikiEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: WIKI_KIND,
    created_at: 1700000000,
    tags: [
      ['d', 'nostr-protocol'],
      ['title', 'Nostr Protocol'],
      ['summary', 'An overview of the Nostr protocol'],
      ['published_at', '1700000000'],
      ['t', 'nostr'],
      ['t', 'protocol'],
    ],
    content: '= Nostr Protocol\n\nNostr is a simple, open protocol.',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('wiki handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleWikiPublish', () => {
    it('creates kind 30818 event with correct tags', async () => {
      const pool = mockPool()
      const result = await handleWikiPublish(ctx, pool as any, {
        topic: 'nostr-protocol',
        title: 'Nostr Protocol',
        content: '= Nostr Protocol\n\nNostr is a simple, open protocol.',
        summary: 'An overview of Nostr',
        hashtags: ['nostr', 'protocol'],
      })

      expect(result.event.kind).toBe(WIKI_KIND)
      expect(result.event.content).toBe('= Nostr Protocol\n\nNostr is a simple, open protocol.')
      expect(result.event.sig).toBeDefined()
      expect(verifyEvent(result.event)).toBe(true)

      // d-tag for topic
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'nostr-protocol'])

      // title tag
      const titleTag = result.event.tags.find((t: string[]) => t[0] === 'title')
      expect(titleTag).toEqual(['title', 'Nostr Protocol'])

      // summary tag
      const summaryTag = result.event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toEqual(['summary', 'An overview of Nostr'])

      // published_at tag
      const publishedAt = result.event.tags.find((t: string[]) => t[0] === 'published_at')
      expect(publishedAt).toBeDefined()
      expect(Number(publishedAt![1])).toBeGreaterThan(0)

      // t-tags for hashtags
      const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toEqual([['t', 'nostr'], ['t', 'protocol']])
    })

    it('publishes to relays', async () => {
      const pool = mockPool()
      const result = await handleWikiPublish(ctx, pool as any, {
        topic: 'bitcoin',
        title: 'Bitcoin',
        content: 'Digital money.',
      })

      expect(pool.publish).toHaveBeenCalledWith(ctx.activeNpub, result.event)
      expect(result.publish.success).toBe(true)
    })

    it('omits summary tag when not provided', async () => {
      const pool = mockPool()
      const result = await handleWikiPublish(ctx, pool as any, {
        topic: 'test',
        title: 'Test',
        content: 'Test content.',
      })

      const summaryTag = result.event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toBeUndefined()
    })
  })

  describe('handleWikiRead', () => {
    it('parses tags back to structured fields', async () => {
      const pool = mockPool([makeWikiEvent()])
      const articles = await handleWikiRead(pool as any, 'npub1test', {
        topic: 'nostr-protocol',
        author: 'b'.repeat(64),
      })

      expect(articles).toHaveLength(1)
      expect(articles[0].topic).toBe('nostr-protocol')
      expect(articles[0].title).toBe('Nostr Protocol')
      expect(articles[0].summary).toBe('An overview of the Nostr protocol')
      expect(articles[0].content).toBe('= Nostr Protocol\n\nNostr is a simple, open protocol.')
      expect(articles[0].pubkey).toBe('b'.repeat(64))
      expect(articles[0].created_at).toBe(1700000000)
      expect(articles[0].hashtags).toEqual(['nostr', 'protocol'])
    })

    it('filters by author when provided', async () => {
      const pool = mockPool([])
      await handleWikiRead(pool as any, 'npub1test', {
        topic: 'nostr-protocol',
        author: 'b'.repeat(64),
      })

      const filter = pool.query.mock.calls[0][1]
      expect(filter.kinds).toEqual([WIKI_KIND])
      expect(filter.authors).toEqual(['b'.repeat(64)])
      expect(filter['#d']).toEqual(['nostr-protocol'])
      expect(filter.limit).toBeUndefined()
    })

    it('returns multiple versions without author', async () => {
      const events = [
        makeWikiEvent({ pubkey: 'a'.repeat(64), created_at: 1700000001 }),
        makeWikiEvent({ pubkey: 'b'.repeat(64), created_at: 1700000000 }),
      ]
      const pool = mockPool(events)
      const articles = await handleWikiRead(pool as any, 'npub1test', {
        topic: 'nostr-protocol',
      })

      expect(articles).toHaveLength(2)
      // Sorted newest first
      expect(articles[0].pubkey).toBe('a'.repeat(64))
      expect(articles[1].pubkey).toBe('b'.repeat(64))

      const filter = pool.query.mock.calls[0][1]
      expect(filter.authors).toBeUndefined()
      expect(filter.limit).toBe(10)
    })
  })

  describe('handleWikiList', () => {
    it('extracts unique topics from events', async () => {
      const events = [
        makeWikiEvent({ created_at: 1700000002, tags: [['d', 'nostr-protocol'], ['title', 'Nostr v2'], ['summary', 'Updated']] }),
        makeWikiEvent({ created_at: 1700000001, tags: [['d', 'nostr-protocol'], ['title', 'Nostr v1'], ['summary', 'Original']] }),
        makeWikiEvent({ created_at: 1700000000, tags: [['d', 'bitcoin'], ['title', 'Bitcoin'], ['summary', 'Digital money']] }),
      ]
      const pool = mockPool(events)
      const topics = await handleWikiList(pool as any, 'npub1test', {})

      expect(topics).toHaveLength(2)
      // nostr-protocol appears first (newest), bitcoin second
      expect(topics[0].topic).toBe('nostr-protocol')
      expect(topics[0].title).toBe('Nostr v2')
      expect(topics[1].topic).toBe('bitcoin')
      expect(topics[1].title).toBe('Bitcoin')
    })

    it('filters by author when provided', async () => {
      const pool = mockPool([])
      await handleWikiList(pool as any, 'npub1test', {
        author: 'b'.repeat(64),
        limit: 25,
      })

      const filter = pool.query.mock.calls[0][1]
      expect(filter.kinds).toEqual([WIKI_KIND])
      expect(filter.authors).toEqual(['b'.repeat(64)])
      expect(filter.limit).toBe(25)
    })

    it('uses default limit of 50', async () => {
      const pool = mockPool([])
      await handleWikiList(pool as any, 'npub1test', {})

      const filter = pool.query.mock.calls[0][1]
      expect(filter.limit).toBe(50)
    })
  })
})
