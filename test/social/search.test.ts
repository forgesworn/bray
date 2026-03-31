import { describe, it, expect, vi } from 'vitest'
import { handleSearchNotes, handleSearchProfiles, handleHashtagFeed } from '../../src/social/search.js'

const TEST_NPUB = 'npub1test'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    queryDirect: vi.fn().mockResolvedValue(events),
  }
}

describe('search handlers', () => {
  describe('handleSearchNotes', () => {
    it('constructs filter with search field', async () => {
      const pool = mockPool([])
      await handleSearchNotes(pool as any, TEST_NPUB, { query: 'bitcoin' })
      expect(pool.query).toHaveBeenCalledWith(
        TEST_NPUB,
        expect.objectContaining({ kinds: [1], search: 'bitcoin', limit: 50 }),
      )
    })

    it('uses queryDirect when explicit relays provided', async () => {
      const pool = mockPool([])
      const relays = ['wss://search.example.com']
      await handleSearchNotes(pool as any, TEST_NPUB, { query: 'nostr', relays })
      expect(pool.queryDirect).toHaveBeenCalledWith(
        relays,
        expect.objectContaining({ kinds: [1], search: 'nostr' }),
      )
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('passes since parameter in filter', async () => {
      const pool = mockPool([])
      await handleSearchNotes(pool as any, TEST_NPUB, { query: 'test', since: 1700000000 })
      expect(pool.query).toHaveBeenCalledWith(
        TEST_NPUB,
        expect.objectContaining({ since: 1700000000 }),
      )
    })

    it('respects limit parameter', async () => {
      const pool = mockPool([])
      await handleSearchNotes(pool as any, TEST_NPUB, { query: 'test', limit: 10 })
      expect(pool.query).toHaveBeenCalledWith(
        TEST_NPUB,
        expect.objectContaining({ limit: 10 }),
      )
    })

    it('returns parsed notes with hashtags', async () => {
      const events = [
        {
          id: 'note1', pubkey: 'pk1', content: 'hello #bitcoin',
          created_at: 1700000000, tags: [['t', 'bitcoin']], kind: 1, sig: 's1',
        },
      ]
      const pool = mockPool(events)
      const result = await handleSearchNotes(pool as any, TEST_NPUB, { query: 'bitcoin' })
      expect(result).toEqual([{
        id: 'note1', pubkey: 'pk1', content: 'hello #bitcoin',
        createdAt: 1700000000, hashtags: ['bitcoin'],
      }])
    })

    it('returns empty array for no results', async () => {
      const pool = mockPool([])
      const result = await handleSearchNotes(pool as any, TEST_NPUB, { query: 'nothing' })
      expect(result).toEqual([])
    })
  })

  describe('handleSearchProfiles', () => {
    it('constructs filter with search field for kind 0', async () => {
      const pool = mockPool([])
      await handleSearchProfiles(pool as any, TEST_NPUB, { query: 'alice' })
      expect(pool.query).toHaveBeenCalledWith(
        TEST_NPUB,
        expect.objectContaining({ kinds: [0], search: 'alice', limit: 20 }),
      )
    })

    it('parses kind 0 content JSON', async () => {
      const events = [
        {
          id: 'p1', pubkey: 'pk1', kind: 0, created_at: 1700000000,
          content: JSON.stringify({ name: 'alice', display_name: 'Alice', about: 'Nostr dev', nip05: 'alice@example.com', picture: 'https://example.com/pic.jpg' }),
          tags: [], sig: 's1',
        },
      ]
      const pool = mockPool(events)
      const result = await handleSearchProfiles(pool as any, TEST_NPUB, { query: 'alice' })
      expect(result).toEqual([{
        pubkey: 'pk1',
        name: 'alice',
        display_name: 'Alice',
        about: 'Nostr dev',
        nip05: 'alice@example.com',
        picture: 'https://example.com/pic.jpg',
      }])
    })

    it('keeps only newest profile per pubkey', async () => {
      const events = [
        {
          id: 'p1', pubkey: 'pk1', kind: 0, created_at: 1700000000,
          content: JSON.stringify({ name: 'old-alice' }),
          tags: [], sig: 's1',
        },
        {
          id: 'p2', pubkey: 'pk1', kind: 0, created_at: 1700001000,
          content: JSON.stringify({ name: 'new-alice' }),
          tags: [], sig: 's2',
        },
      ]
      const pool = mockPool(events)
      const result = await handleSearchProfiles(pool as any, TEST_NPUB, { query: 'alice' })
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('new-alice')
    })

    it('skips unparseable profile content', async () => {
      const events = [
        {
          id: 'p1', pubkey: 'pk1', kind: 0, created_at: 1700000000,
          content: 'not json', tags: [], sig: 's1',
        },
      ]
      const pool = mockPool(events)
      const result = await handleSearchProfiles(pool as any, TEST_NPUB, { query: 'alice' })
      expect(result).toEqual([])
    })

    it('returns empty array for no results', async () => {
      const pool = mockPool([])
      const result = await handleSearchProfiles(pool as any, TEST_NPUB, { query: 'nobody' })
      expect(result).toEqual([])
    })
  })

  describe('handleHashtagFeed', () => {
    it('uses #t tag filter, not search', async () => {
      const pool = mockPool([])
      await handleHashtagFeed(pool as any, TEST_NPUB, { hashtag: 'bitcoin' })
      const filter = pool.query.mock.calls[0][1]
      expect(filter['#t']).toEqual(['bitcoin'])
      expect(filter.search).toBeUndefined()
    })

    it('lowercases the hashtag', async () => {
      const pool = mockPool([])
      await handleHashtagFeed(pool as any, TEST_NPUB, { hashtag: 'Bitcoin' })
      const filter = pool.query.mock.calls[0][1]
      expect(filter['#t']).toEqual(['bitcoin'])
    })

    it('respects limit parameter', async () => {
      const pool = mockPool([])
      await handleHashtagFeed(pool as any, TEST_NPUB, { hashtag: 'nostr', limit: 25 })
      expect(pool.query).toHaveBeenCalledWith(
        TEST_NPUB,
        expect.objectContaining({ limit: 25 }),
      )
    })

    it('returns parsed notes with hashtags', async () => {
      const events = [
        {
          id: 'h1', pubkey: 'pk1', content: 'tagged post',
          created_at: 1700000000, tags: [['t', 'bitcoin'], ['t', 'nostr']], kind: 1, sig: 's1',
        },
      ]
      const pool = mockPool(events)
      const result = await handleHashtagFeed(pool as any, TEST_NPUB, { hashtag: 'bitcoin' })
      expect(result[0].hashtags).toEqual(['bitcoin', 'nostr'])
    })

    it('returns empty array for no results', async () => {
      const pool = mockPool([])
      const result = await handleHashtagFeed(pool as any, TEST_NPUB, { hashtag: 'empty' })
      expect(result).toEqual([])
    })
  })
})
