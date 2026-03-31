import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleCalendarCreate,
  handleCalendarRead,
  handleCalendarRsvp,
} from '../../src/social/calendar.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.trotters.cc'] }),
  }
}

describe('calendar handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // ---------------------------------------------------------------------------
  // handleCalendarCreate
  // ---------------------------------------------------------------------------
  describe('handleCalendarCreate', () => {
    it('creates a time-based event (kind 31923) from ISO dates', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Nostr Meetup',
        content: 'Monthly meetup for Nostr developers.',
        start: '2026-04-15T18:00:00Z',
        end: '2026-04-15T20:00:00Z',
        location: 'The Hacker Space, London',
        geohash: 'gcpvj0',
        participants: ['abcd'.repeat(16)],
        hashtags: ['nostr', 'meetup'],
        image: 'https://example.com/meetup.jpg',
        slug: 'nostr-meetup-april',
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(31923)

      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'nostr-meetup-april'])

      const titleTag = event.tags.find((t: string[]) => t[0] === 'title')
      expect(titleTag).toEqual(['title', 'Nostr Meetup'])

      const startTag = event.tags.find((t: string[]) => t[0] === 'start')
      const expectedStart = String(Math.floor(new Date('2026-04-15T18:00:00Z').getTime() / 1000))
      expect(startTag).toEqual(['start', expectedStart])

      const endTag = event.tags.find((t: string[]) => t[0] === 'end')
      const expectedEnd = String(Math.floor(new Date('2026-04-15T20:00:00Z').getTime() / 1000))
      expect(endTag).toEqual(['end', expectedEnd])

      const locationTag = event.tags.find((t: string[]) => t[0] === 'location')
      expect(locationTag).toEqual(['location', 'The Hacker Space, London'])

      const gTag = event.tags.find((t: string[]) => t[0] === 'g')
      expect(gTag).toEqual(['g', 'gcpvj0'])

      const imageTag = event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toEqual(['image', 'https://example.com/meetup.jpg'])

      const tTags = event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toEqual([['t', 'nostr'], ['t', 'meetup']])
    })

    it('creates a date-based event (kind 31922) from YYYY-MM-DD', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Bitcoin Conference',
        content: 'Annual Bitcoin conference.',
        start: '2026-06-01',
        end: '2026-06-03',
      })

      const event = result.event
      expect(event.kind).toBe(31922)

      const startTag = event.tags.find((t: string[]) => t[0] === 'start')
      expect(startTag).toEqual(['start', '2026-06-01'])

      const endTag = event.tags.find((t: string[]) => t[0] === 'end')
      expect(endTag).toEqual(['end', '2026-06-03'])
    })

    it('auto-detects time-based when start contains T', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Quick Call',
        content: 'Sync call.',
        start: '2026-04-10T14:30:00Z',
      })

      expect(result.event.kind).toBe(31923)
    })

    it('auto-detects date-based when start is YYYY-MM-DD', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'All Day Event',
        content: 'An all-day event.',
        start: '2026-05-20',
      })

      expect(result.event.kind).toBe(31922)
    })

    it('defaults slug to slugified title', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Nostr Hack Day: London Edition!',
        content: 'Hacking all day.',
        start: '2026-07-01',
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag?.[1]).toBe('nostr-hack-day-london-edition')
    })

    it('includes participants as p-tags', async () => {
      const pool = mockPool()
      const pubkey1 = 'a'.repeat(64)
      const pubkey2 = 'b'.repeat(64)

      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Private Meetup',
        content: 'Invite only.',
        start: '2026-08-01',
        participants: [pubkey1, pubkey2],
      })

      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags).toHaveLength(2)
      expect(pTags[0]).toEqual(['p', pubkey1, '', ''])
      expect(pTags[1]).toEqual(['p', pubkey2, '', ''])
    })

    it('omits optional tags when not provided', async () => {
      const pool = mockPool()
      const result = await handleCalendarCreate(ctx, pool as any, {
        title: 'Minimal Event',
        content: 'Just the basics.',
        start: '2026-09-01',
      })

      const endTag = result.event.tags.find((t: string[]) => t[0] === 'end')
      expect(endTag).toBeUndefined()

      const locationTag = result.event.tags.find((t: string[]) => t[0] === 'location')
      expect(locationTag).toBeUndefined()

      const gTag = result.event.tags.find((t: string[]) => t[0] === 'g')
      expect(gTag).toBeUndefined()

      const imageTag = result.event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toBeUndefined()

      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags).toHaveLength(0)

      const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
      expect(tTags).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // handleCalendarRsvp
  // ---------------------------------------------------------------------------
  describe('handleCalendarRsvp', () => {
    it('creates correct kind 31925 with accepted status', async () => {
      const pool = mockPool()
      const coord = '31923:abc123:nostr-meetup'
      const result = await handleCalendarRsvp(ctx, pool as any, {
        eventCoordinate: coord,
        status: 'accepted',
      })

      expect(result.event).toBeDefined()
      expect(result.event.kind).toBe(31925)
      expect(result.event.content).toBe('')

      const aTag = result.event.tags.find((t: string[]) => t[0] === 'a')
      expect(aTag).toEqual(['a', coord])

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', coord])

      const statusTag = result.event.tags.find((t: string[]) => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'accepted'])

      const lTag = result.event.tags.find((t: string[]) => t[0] === 'L')
      expect(lTag).toEqual(['L', 'status'])

      const llTag = result.event.tags.find((t: string[]) => t[0] === 'l')
      expect(llTag).toEqual(['l', 'accepted', 'status'])
    })

    it('creates RSVP with declined status', async () => {
      const pool = mockPool()
      const result = await handleCalendarRsvp(ctx, pool as any, {
        eventCoordinate: '31922:def456:bitcoin-conf',
        status: 'declined',
      })

      const statusTag = result.event.tags.find((t: string[]) => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'declined'])

      const llTag = result.event.tags.find((t: string[]) => t[0] === 'l')
      expect(llTag).toEqual(['l', 'declined', 'status'])
    })

    it('creates RSVP with tentative status', async () => {
      const pool = mockPool()
      const result = await handleCalendarRsvp(ctx, pool as any, {
        eventCoordinate: '31923:ghi789:hack-day',
        status: 'tentative',
      })

      const statusTag = result.event.tags.find((t: string[]) => t[0] === 'status')
      expect(statusTag).toEqual(['status', 'tentative'])
    })
  })

  // ---------------------------------------------------------------------------
  // handleCalendarRead
  // ---------------------------------------------------------------------------
  describe('handleCalendarRead', () => {
    it('parses tags back to structured fields', async () => {
      const fakeEvent = {
        id: 'evt123',
        pubkey: 'pk456',
        kind: 31923,
        created_at: 1700000000,
        content: 'Monthly meetup description',
        tags: [
          ['d', 'nostr-meetup'],
          ['title', 'Nostr Meetup'],
          ['start', '1713200400'],
          ['end', '1713207600'],
          ['location', 'London'],
          ['g', 'gcpvj0'],
          ['image', 'https://example.com/img.jpg'],
          ['p', 'aaa'.padEnd(64, 'a')],
          ['p', 'bbb'.padEnd(64, 'b')],
          ['t', 'nostr'],
          ['t', 'meetup'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([fakeEvent])
      const events = await handleCalendarRead(pool as any, 'npub1test', { author: 'pk456' })

      expect(events).toHaveLength(1)
      const ev = events[0]
      expect(ev.id).toBe('evt123')
      expect(ev.pubkey).toBe('pk456')
      expect(ev.kind).toBe(31923)
      expect(ev.slug).toBe('nostr-meetup')
      expect(ev.title).toBe('Nostr Meetup')
      expect(ev.start).toBe('1713200400')
      expect(ev.end).toBe('1713207600')
      expect(ev.location).toBe('London')
      expect(ev.geohash).toBe('gcpvj0')
      expect(ev.image).toBe('https://example.com/img.jpg')
      expect(ev.participants).toHaveLength(2)
      expect(ev.hashtags).toEqual(['nostr', 'meetup'])
      expect(ev.content).toBe('Monthly meetup description')
    })

    it('sorts events by start date ascending', async () => {
      const events = [
        { id: 'later', pubkey: 'pk', kind: 31923, created_at: 1000, content: '', tags: [['d', 'b'], ['start', '2000']], sig: '' },
        { id: 'earlier', pubkey: 'pk', kind: 31923, created_at: 2000, content: '', tags: [['d', 'a'], ['start', '1000']], sig: '' },
      ]
      const pool = mockPool(events)
      const result = await handleCalendarRead(pool as any, 'npub1test', { author: 'pk' })

      expect(result[0].id).toBe('earlier')
      expect(result[1].id).toBe('later')
    })

    it('queries both kinds 31922 and 31923', async () => {
      const pool = mockPool([])
      await handleCalendarRead(pool as any, 'npub1test', { author: 'abc' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31922, 31923],
        authors: ['abc'],
        limit: 50,
      })
    })

    it('filters by since and until', async () => {
      const events = [
        { id: 'early', pubkey: 'pk', kind: 31922, created_at: 1000, content: '', tags: [['d', 'a'], ['start', '2026-01-01']], sig: '' },
        { id: 'mid', pubkey: 'pk', kind: 31922, created_at: 2000, content: '', tags: [['d', 'b'], ['start', '2026-06-15']], sig: '' },
        { id: 'late', pubkey: 'pk', kind: 31922, created_at: 3000, content: '', tags: [['d', 'c'], ['start', '2026-12-01']], sig: '' },
      ]
      const pool = mockPool(events)
      const result = await handleCalendarRead(pool as any, 'npub1test', {
        author: 'pk',
        since: '2026-03-01',
        until: '2026-09-01',
      })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('mid')
    })

    it('defaults limit to 50', async () => {
      const pool = mockPool([])
      await handleCalendarRead(pool as any, 'npub1test', {})

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31922, 31923],
        limit: 50,
      })
    })
  })
})
