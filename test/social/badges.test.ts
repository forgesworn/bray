import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleBadgeCreate,
  handleBadgeAward,
  handleBadgeAccept,
  handleBadgeList,
} from '../../src/social/badges.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.trotters.cc'] }),
  }
}

describe('NIP-58 badge handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // ---------------------------------------------------------------------------
  // handleBadgeCreate
  // ---------------------------------------------------------------------------
  describe('handleBadgeCreate', () => {
    it('creates correct kind 30009 with all tags', async () => {
      const pool = mockPool()
      const result = await handleBadgeCreate(ctx, pool as any, {
        slug: 'early-adopter',
        name: 'Early Adopter',
        description: 'Awarded to early community members',
        image: 'https://example.com/badge.png',
        thumb: 'https://example.com/badge-thumb.png',
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(30009)
      expect(event.content).toBe('')

      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'early-adopter'])

      const nameTag = event.tags.find((t: string[]) => t[0] === 'name')
      expect(nameTag).toEqual(['name', 'Early Adopter'])

      const descTag = event.tags.find((t: string[]) => t[0] === 'description')
      expect(descTag).toEqual(['description', 'Awarded to early community members'])

      const imageTag = event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toEqual(['image', 'https://example.com/badge.png'])

      const thumbTag = event.tags.find((t: string[]) => t[0] === 'thumb')
      expect(thumbTag).toEqual(['thumb', 'https://example.com/badge-thumb.png'])
    })

    it('omits optional image and thumb tags when not provided', async () => {
      const pool = mockPool()
      const result = await handleBadgeCreate(ctx, pool as any, {
        slug: 'minimal',
        name: 'Minimal Badge',
        description: 'A badge with no image',
      })

      const imageTag = result.event.tags.find((t: string[]) => t[0] === 'image')
      expect(imageTag).toBeUndefined()

      const thumbTag = result.event.tags.find((t: string[]) => t[0] === 'thumb')
      expect(thumbTag).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // handleBadgeAward
  // ---------------------------------------------------------------------------
  describe('handleBadgeAward', () => {
    it('creates kind 8 with a-tag and p-tags for recipients', async () => {
      const pool = mockPool()
      const recipients = [
        'aaaa'.repeat(16),
        'bbbb'.repeat(16),
      ]
      const result = await handleBadgeAward(ctx, pool as any, {
        badgeSlug: 'early-adopter',
        recipients,
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(8)
      expect(event.content).toBe('')

      const aTag = event.tags.find((t: string[]) => t[0] === 'a')
      expect(aTag).toBeDefined()
      expect(aTag![1]).toBe(`30009:${ctx.activePublicKeyHex}:early-adopter`)

      const pTags = event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags).toHaveLength(2)
      expect(pTags[0]).toEqual(['p', 'aaaa'.repeat(16)])
      expect(pTags[1]).toEqual(['p', 'bbbb'.repeat(16)])
    })

    it('works with a single recipient', async () => {
      const pool = mockPool()
      const result = await handleBadgeAward(ctx, pool as any, {
        badgeSlug: 'solo-badge',
        recipients: ['cccc'.repeat(16)],
      })

      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // handleBadgeAccept
  // ---------------------------------------------------------------------------
  describe('handleBadgeAccept', () => {
    it('creates kind 30008 with profile_badges d-tag', async () => {
      const pool = mockPool([]) // no existing profile badges
      const result = await handleBadgeAccept(ctx, pool as any, {
        badgeDefinitionCoord: '30009:abc123:early-adopter',
        awardEventId: 'eventid123',
      })

      expect(result.event).toBeDefined()
      expect(result.publish.success).toBe(true)

      const event = result.event
      expect(event.kind).toBe(30008)

      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'profile_badges'])

      const aTag = event.tags.find((t: string[]) => t[0] === 'a')
      expect(aTag).toEqual(['a', '30009:abc123:early-adopter'])

      const eTag = event.tags.find((t: string[]) => t[0] === 'e')
      expect(eTag).toEqual(['e', 'eventid123'])
    })

    it('preserves existing badges when adding a new one', async () => {
      const existingEvent = {
        id: 'existing123',
        pubkey: ctx.activePublicKeyHex,
        kind: 30008,
        created_at: 1700000000,
        content: '',
        tags: [
          ['d', 'profile_badges'],
          ['a', '30009:xyz:first-badge'],
          ['e', 'award111'],
          ['a', '30009:xyz:second-badge'],
          ['e', 'award222'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([existingEvent])
      const result = await handleBadgeAccept(ctx, pool as any, {
        badgeDefinitionCoord: '30009:abc123:new-badge',
        awardEventId: 'award333',
      })

      const event = result.event
      const aTags = event.tags.filter((t: string[]) => t[0] === 'a')
      const eTags = event.tags.filter((t: string[]) => t[0] === 'e')

      // Should have 3 badge definitions (2 existing + 1 new)
      expect(aTags).toHaveLength(3)
      expect(eTags).toHaveLength(3)

      // Existing badges preserved
      expect(aTags[0]).toEqual(['a', '30009:xyz:first-badge'])
      expect(eTags[0]).toEqual(['e', 'award111'])
      expect(aTags[1]).toEqual(['a', '30009:xyz:second-badge'])
      expect(eTags[1]).toEqual(['e', 'award222'])

      // New badge appended
      expect(aTags[2]).toEqual(['a', '30009:abc123:new-badge'])
      expect(eTags[2]).toEqual(['e', 'award333'])
    })
  })

  // ---------------------------------------------------------------------------
  // handleBadgeList
  // ---------------------------------------------------------------------------
  describe('handleBadgeList', () => {
    it('parses badge definitions in "defined" mode', async () => {
      const fakeEvents = [
        {
          id: 'badge1',
          pubkey: 'pk123',
          kind: 30009,
          created_at: 1700000000,
          content: '',
          tags: [
            ['d', 'early-adopter'],
            ['name', 'Early Adopter'],
            ['description', 'First users'],
            ['image', 'https://example.com/img.png'],
            ['thumb', 'https://example.com/thumb.png'],
          ],
          sig: 'fakesig',
        },
        {
          id: 'badge2',
          pubkey: 'pk123',
          kind: 30009,
          created_at: 1700001000,
          content: '',
          tags: [
            ['d', 'contributor'],
            ['name', 'Contributor'],
            ['description', 'Active contributor'],
          ],
          sig: 'fakesig',
        },
      ]
      const pool = mockPool(fakeEvents)
      const badges = await handleBadgeList(pool as any, 'npub1test', {
        pubkey: 'pk123',
        mode: 'defined',
      })

      expect(badges).toHaveLength(2)
      // Sorted descending by created_at
      const first = badges[0] as any
      expect(first.slug).toBe('contributor')
      expect(first.name).toBe('Contributor')

      const second = badges[1] as any
      expect(second.slug).toBe('early-adopter')
      expect(second.name).toBe('Early Adopter')
      expect(second.description).toBe('First users')
      expect(second.image).toBe('https://example.com/img.png')
      expect(second.thumb).toBe('https://example.com/thumb.png')

      // Verify correct filter was used
      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [30009],
        authors: ['pk123'],
      })
    })

    it('parses profile badge pairs in "profile" mode', async () => {
      const fakeEvent = {
        id: 'profile123',
        pubkey: 'pk123',
        kind: 30008,
        created_at: 1700000000,
        content: '',
        tags: [
          ['d', 'profile_badges'],
          ['a', '30009:issuer1:badge-a'],
          ['e', 'award1'],
          ['a', '30009:issuer2:badge-b'],
          ['e', 'award2'],
        ],
        sig: 'fakesig',
      }
      const pool = mockPool([fakeEvent])
      const pairs = await handleBadgeList(pool as any, 'npub1test', {
        pubkey: 'pk123',
        mode: 'profile',
      })

      expect(pairs).toHaveLength(2)
      const first = pairs[0] as any
      expect(first.definitionCoord).toBe('30009:issuer1:badge-a')
      expect(first.awardEventId).toBe('award1')

      const second = pairs[1] as any
      expect(second.definitionCoord).toBe('30009:issuer2:badge-b')
      expect(second.awardEventId).toBe('award2')

      // Verify correct filter was used
      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [30008],
        authors: ['pk123'],
        '#d': ['profile_badges'],
      })
    })

    it('returns empty array when no profile badges exist', async () => {
      const pool = mockPool([])
      const pairs = await handleBadgeList(pool as any, 'npub1test', {
        pubkey: 'pk123',
        mode: 'profile',
      })

      expect(pairs).toHaveLength(0)
    })
  })
})
