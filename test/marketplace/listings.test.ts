import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleListingCreate,
  handleListingRead,
  handleListingSearch,
  handleListingClose,
  CLASSIFIED_LISTING_KIND,
} from '../../src/marketplace/listings.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.trotters.cc'] }),
  }
}

describe('listing handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // ---------------------------------------------------------------------------
  // handleListingCreate
  // ---------------------------------------------------------------------------
  describe('handleListingCreate', () => {
    it('creates correct event structure with all tags including price tuple', async () => {
      const pool = mockPool()
      const result = await handleListingCreate(ctx, pool as any, {
        title: 'Vintage Guitar',
        content: 'A beautiful 1965 Fender Stratocaster in excellent condition.',
        price: { amount: '2500', currency: 'GBP' },
        summary: 'Rare vintage guitar',
        location: 'London, UK',
        geohash: 'gcpuuz',
        hashtags: ['guitar', 'vintage', 'music'],
        image: 'https://example.com/guitar.jpg',
        slug: 'vintage-guitar',
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(CLASSIFIED_LISTING_KIND)
      expect(event.content).toBe('A beautiful 1965 Fender Stratocaster in excellent condition.')

      // Check tags
      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'vintage-guitar'])

      const titleTag = event.tags.find((t: string[]) => t[0] === 'title')
      expect(titleTag).toEqual(['title', 'Vintage Guitar'])

      const priceTag = event.tags.find((t: string[]) => t[0] === 'price')
      expect(priceTag).toEqual(['price', '2500', 'GBP', ''])

      const summaryTag = event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toEqual(['summary', 'Rare vintage guitar'])

      const locationTag = event.tags.find((t: string[]) => t[0] === 'location')
      expect(locationTag).toEqual(['location', 'London, UK'])

      const gTag = event.tags.find((t: string[]) => t[0] === 'g')
      expect(gTag).toEqual(['g', 'gcpuuz'])

      const imageTag = event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toEqual(['image', 'https://example.com/guitar.jpg'])

      const tTags = event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toEqual([['t', 'guitar'], ['t', 'vintage'], ['t', 'music']])

      const publishedAtTag = event.tags.find((t: string[]) => t[0] === 'published_at')
      expect(publishedAtTag).toBeDefined()
      expect(parseInt(publishedAtTag![1], 10)).toBeGreaterThan(0)
    })

    it('includes frequency in price tuple when provided', async () => {
      const pool = mockPool()
      const result = await handleListingCreate(ctx, pool as any, {
        title: 'Office Space',
        content: 'Shared desk in Shoreditch co-working space.',
        price: { amount: '50000', currency: 'SAT', frequency: 'per hour' },
      })

      const priceTag = result.event.tags.find((t: string[]) => t[0] === 'price')
      expect(priceTag).toEqual(['price', '50000', 'SAT', 'per hour'])
    })

    it('defaults slug to slugified title', async () => {
      const pool = mockPool()
      const result = await handleListingCreate(ctx, pool as any, {
        title: 'Hello World: A Test Listing!',
        content: 'Body text.',
        price: { amount: '100', currency: 'USD' },
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag?.[1]).toBe('hello-world-a-test-listing')
    })

    it('omits optional tags when not provided', async () => {
      const pool = mockPool()
      const result = await handleListingCreate(ctx, pool as any, {
        title: 'Minimal Listing',
        content: 'Just the basics.',
        price: { amount: '10', currency: 'USD' },
      })

      const summaryTag = result.event.tags.find((t: string[]) => t[0] === 'summary')
      expect(summaryTag).toBeUndefined()

      const locationTag = result.event.tags.find((t: string[]) => t[0] === 'location')
      expect(locationTag).toBeUndefined()

      const gTag = result.event.tags.find((t: string[]) => t[0] === 'g')
      expect(gTag).toBeUndefined()

      const imageTag = result.event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toBeUndefined()

      const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // handleListingRead
  // ---------------------------------------------------------------------------
  describe('handleListingRead', () => {
    it('parses price back to structured object', async () => {
      const fakeEvent = {
        id: 'abc123',
        pubkey: 'def456',
        kind: CLASSIFIED_LISTING_KIND,
        created_at: 1700000000,
        content: 'A lovely sofa in great condition.',
        tags: [
          ['d', 'sofa-sale'],
          ['title', 'Sofa Sale'],
          ['summary', 'Comfortable sofa'],
          ['price', '300', 'GBP', ''],
          ['location', 'Manchester'],
          ['g', 'gcw2'],
          ['image', 'https://example.com/sofa.jpg'],
          ['published_at', '1700000000'],
          ['t', 'furniture'],
          ['t', 'home'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([fakeEvent])
      const listings = await handleListingRead(pool as any, 'npub1test', { author: 'def456' })

      expect(listings).toHaveLength(1)
      const listing = listings[0]
      expect(listing.id).toBe('abc123')
      expect(listing.pubkey).toBe('def456')
      expect(listing.slug).toBe('sofa-sale')
      expect(listing.title).toBe('Sofa Sale')
      expect(listing.summary).toBe('Comfortable sofa')
      expect(listing.content).toBe('A lovely sofa in great condition.')
      expect(listing.price).toEqual({ amount: '300', currency: 'GBP', frequency: '' })
      expect(listing.location).toBe('Manchester')
      expect(listing.geohash).toBe('gcw2')
      expect(listing.image).toBe('https://example.com/sofa.jpg')
      expect(listing.publishedAt).toBe(1700000000)
      expect(listing.hashtags).toEqual(['furniture', 'home'])
    })

    it('filters by slug when provided', async () => {
      const pool = mockPool([])
      await handleListingRead(pool as any, 'npub1test', { author: 'abc', slug: 'my-listing' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [CLASSIFIED_LISTING_KIND],
        limit: 50,
        authors: ['abc'],
        '#d': ['my-listing'],
      })
    })

    it('sorts listings by created_at descending', async () => {
      const events = [
        { id: 'old', pubkey: 'pk', kind: CLASSIFIED_LISTING_KIND, created_at: 1000, content: '', tags: [['d', 'a']], sig: '' },
        { id: 'new', pubkey: 'pk', kind: CLASSIFIED_LISTING_KIND, created_at: 2000, content: '', tags: [['d', 'b']], sig: '' },
      ]
      const pool = mockPool(events)
      const listings = await handleListingRead(pool as any, 'npub1test', { author: 'pk' })

      expect(listings[0].id).toBe('new')
      expect(listings[1].id).toBe('old')
    })
  })

  // ---------------------------------------------------------------------------
  // handleListingSearch
  // ---------------------------------------------------------------------------
  describe('handleListingSearch', () => {
    it('uses correct tag filter for hashtag search', async () => {
      const pool = mockPool([])
      await handleListingSearch(pool as any, 'npub1test', { hashtag: 'furniture' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [CLASSIFIED_LISTING_KIND],
        limit: 50,
        '#t': ['furniture'],
      })
    })

    it('uses correct tag filter for geohash search', async () => {
      const pool = mockPool([])
      await handleListingSearch(pool as any, 'npub1test', { geohash: 'gcpuuz' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [CLASSIFIED_LISTING_KIND],
        limit: 50,
        '#g': ['gcpuuz'],
      })
    })

    it('combines hashtag and geohash filters', async () => {
      const pool = mockPool([])
      await handleListingSearch(pool as any, 'npub1test', { hashtag: 'guitar', geohash: 'gcpuuz' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [CLASSIFIED_LISTING_KIND],
        limit: 50,
        '#t': ['guitar'],
        '#g': ['gcpuuz'],
      })
    })

    it('throws when neither hashtag nor geohash provided', async () => {
      const pool = mockPool([])
      await expect(
        handleListingSearch(pool as any, 'npub1test', {}),
      ).rejects.toThrow('Provide at least one of hashtag or geohash')
    })
  })

  // ---------------------------------------------------------------------------
  // handleListingClose
  // ---------------------------------------------------------------------------
  describe('handleListingClose', () => {
    it('adds status tag to existing listing', async () => {
      const existingEvent = {
        id: 'existing123',
        pubkey: ctx.activePublicKeyHex,
        kind: CLASSIFIED_LISTING_KIND,
        created_at: 1700000000,
        content: 'Original listing content.',
        tags: [
          ['d', 'my-item'],
          ['title', 'My Item'],
          ['price', '100', 'USD', ''],
          ['t', 'electronics'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([existingEvent])
      const result = await handleListingClose(ctx, pool as any, { slug: 'my-item', status: 'sold' })

      expect(result.event).toBeDefined()
      expect(result.event.kind).toBe(CLASSIFIED_LISTING_KIND)
      expect(result.event.content).toBe('Original listing content.')

      // Should preserve original tags
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'my-item'])

      const titleTag = result.event.tags.find((t: string[]) => t[0] === 'title')
      expect(titleTag).toEqual(['title', 'My Item'])

      const priceTag = result.event.tags.find((t: string[]) => t[0] === 'price')
      expect(priceTag).toEqual(['price', '100', 'USD', ''])

      // Should have added status tag
      const statusTag = result.event.tags.find((t: string[]) => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'sold'])
    })

    it('supports closed status', async () => {
      const existingEvent = {
        id: 'existing456',
        pubkey: ctx.activePublicKeyHex,
        kind: CLASSIFIED_LISTING_KIND,
        created_at: 1700000000,
        content: 'Content.',
        tags: [['d', 'withdrawn'], ['title', 'Withdrawn']],
        sig: 'fakesig',
      }
      const pool = mockPool([existingEvent])
      const result = await handleListingClose(ctx, pool as any, { slug: 'withdrawn', status: 'closed' })

      const statusTag = result.event.tags.find((t: string[]) => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'closed'])
    })

    it('throws when listing not found', async () => {
      const pool = mockPool([])
      await expect(
        handleListingClose(ctx, pool as any, { slug: 'nonexistent', status: 'sold' }),
      ).rejects.toThrow('No listing found with slug "nonexistent"')
    })

    it('removes existing status tag before adding new one', async () => {
      const existingEvent = {
        id: 'existing789',
        pubkey: ctx.activePublicKeyHex,
        kind: CLASSIFIED_LISTING_KIND,
        created_at: 1700000000,
        content: 'Content.',
        tags: [
          ['d', 'reopen'],
          ['title', 'Reopened'],
          ['status', 'sold'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([existingEvent])
      const result = await handleListingClose(ctx, pool as any, { slug: 'reopen', status: 'closed' })

      const statusTags = result.event.tags.filter((t: string[]) => t[0] === 'status')
      expect(statusTags).toHaveLength(1)
      expect(statusTags[0]).toEqual(['status', 'closed'])
    })
  })
})
