import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleArticlePublish,
  handleArticleRead,
  handleArticleList,
} from '../../src/social/articles.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.trotters.cc'] }),
  }
}

describe('article handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // -------------------------------------------------------------------------
  // handleArticlePublish
  // -------------------------------------------------------------------------
  describe('handleArticlePublish', () => {
    it('creates correct event structure with all tags', async () => {
      const pool = mockPool()
      const result = await handleArticlePublish(ctx, pool as any, {
        title: 'My First Article',
        content: '# Hello\n\nThis is my article.',
        summary: 'A short summary',
        image: 'https://example.com/image.jpg',
        published_at: '2026-01-15T12:00:00Z',
        hashtags: ['nostr', 'bitcoin'],
        slug: 'my-first-article',
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(30023)
      expect(event.content).toBe('# Hello\n\nThis is my article.')

      // Check tags
      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'my-first-article'])

      const titleTag = event.tags.find((t: string[]) => t[0] === 'title')
      expect(titleTag).toEqual(['title', 'My First Article'])

      const summaryTag = event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toEqual(['summary', 'A short summary'])

      const imageTag = event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toEqual(['image', 'https://example.com/image.jpg'])

      const publishedAtTag = event.tags.find((t: string[]) => t[0] === 'published_at')
      expect(publishedAtTag).toEqual(['published_at', String(Math.floor(new Date('2026-01-15T12:00:00Z').getTime() / 1000))])

      const tTags = event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toEqual([['t', 'nostr'], ['t', 'bitcoin']])
    })

    it('defaults slug to slugified title', async () => {
      const pool = mockPool()
      const result = await handleArticlePublish(ctx, pool as any, {
        title: 'Hello World: A Test Article!',
        content: 'Body text.',
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag?.[1]).toBe('hello-world-a-test-article')
    })

    it('defaults published_at to now', async () => {
      const pool = mockPool()
      const before = Math.floor(Date.now() / 1000)
      const result = await handleArticlePublish(ctx, pool as any, {
        title: 'Test',
        content: 'Body.',
      })
      const after = Math.floor(Date.now() / 1000)

      const publishedAtTag = result.event.tags.find((t: string[]) => t[0] === 'published_at')
      const ts = parseInt(publishedAtTag![1], 10)
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })

    it('omits optional tags when not provided', async () => {
      const pool = mockPool()
      const result = await handleArticlePublish(ctx, pool as any, {
        title: 'Minimal',
        content: 'Just the basics.',
      })

      const summaryTag = result.event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toBeUndefined()

      const imageTag = result.event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toBeUndefined()

      const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // handleArticleRead
  // -------------------------------------------------------------------------
  describe('handleArticleRead', () => {
    it('parses tags back to structured fields', async () => {
      const fakeEvent = {
        id: 'abc123',
        pubkey: 'def456',
        kind: 30023,
        created_at: 1700000000,
        content: '# Article body',
        tags: [
          ['d', 'test-slug'],
          ['title', 'Test Title'],
          ['summary', 'A summary'],
          ['image', 'https://example.com/img.png'],
          ['published_at', '1700000000'],
          ['t', 'nostr'],
          ['t', 'test'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([fakeEvent])
      const articles = await handleArticleRead(pool as any, 'npub1test', { author: 'def456' })

      expect(articles).toHaveLength(1)
      const article = articles[0]
      expect(article.id).toBe('abc123')
      expect(article.pubkey).toBe('def456')
      expect(article.slug).toBe('test-slug')
      expect(article.title).toBe('Test Title')
      expect(article.summary).toBe('A summary')
      expect(article.image).toBe('https://example.com/img.png')
      expect(article.publishedAt).toBe(1700000000)
      expect(article.createdAt).toBe(1700000000)
      expect(article.hashtags).toEqual(['nostr', 'test'])
      expect(article.content).toBe('# Article body')
    })

    it('filters by slug when provided', async () => {
      const pool = mockPool([])
      await handleArticleRead(pool as any, 'npub1test', { author: 'abc', slug: 'my-slug' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [30023],
        authors: ['abc'],
        '#d': ['my-slug'],
      })
    })

    it('fetches all articles when no slug provided', async () => {
      const pool = mockPool([])
      await handleArticleRead(pool as any, 'npub1test', { author: 'abc' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [30023],
        authors: ['abc'],
      })
    })

    it('sorts articles by created_at descending', async () => {
      const events = [
        { id: 'old', pubkey: 'pk', kind: 30023, created_at: 1000, content: '', tags: [['d', 'a']], sig: '' },
        { id: 'new', pubkey: 'pk', kind: 30023, created_at: 2000, content: '', tags: [['d', 'b']], sig: '' },
      ]
      const pool = mockPool(events)
      const articles = await handleArticleRead(pool as any, 'npub1test', { author: 'pk' })

      expect(articles[0].id).toBe('new')
      expect(articles[1].id).toBe('old')
    })
  })

  // -------------------------------------------------------------------------
  // handleArticleList
  // -------------------------------------------------------------------------
  describe('handleArticleList', () => {
    it('returns metadata without content', async () => {
      const fakeEvent = {
        id: 'abc123',
        pubkey: 'def456',
        kind: 30023,
        created_at: 1700000000,
        content: '# Full article body here',
        tags: [
          ['d', 'test-slug'],
          ['title', 'Test Title'],
          ['summary', 'A summary'],
          ['published_at', '1700000000'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([fakeEvent])
      const list = await handleArticleList(pool as any, 'npub1test', { author: 'def456' })

      expect(list).toHaveLength(1)
      const item = list[0]
      expect(item.slug).toBe('test-slug')
      expect(item.title).toBe('Test Title')
      expect(item.summary).toBe('A summary')
      expect(item.publishedAt).toBe(1700000000)
      expect(item.createdAt).toBe(1700000000)
      // Should NOT have content field
      expect((item as any).content).toBeUndefined()
    })

    it('passes limit to filter', async () => {
      const pool = mockPool([])
      await handleArticleList(pool as any, 'npub1test', { author: 'abc', limit: 5 })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [30023],
        authors: ['abc'],
        limit: 5,
      })
    })
  })
})
