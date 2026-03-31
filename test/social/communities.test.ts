import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleCommunityCreate,
  handleCommunityFeed,
  handleCommunityPost,
  handleCommunityApprove,
  handleCommunityList,
} from '../../src/social/communities.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay'], rejected: [], errors: [] }),
  }
}

describe('NIP-72 community handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // ---------------------------------------------------------------------------
  // handleCommunityCreate
  // ---------------------------------------------------------------------------
  describe('handleCommunityCreate', () => {
    it('creates kind 34550 with correct tags', async () => {
      const pool = mockPool()
      const result = await handleCommunityCreate(ctx, pool as any, {
        name: 'bitcoin-dev',
        description: 'Bitcoin development discussion',
        image: 'https://example.com/btc.png',
        rules: 'Be respectful. No spam.',
        moderators: ['aabbcc', 'ddeeff'],
      })

      expect(result.event.kind).toBe(34550)
      expect(result.publish.success).toBe(true)

      const dTag = result.event.tags.find(t => t[0] === 'd')
      expect(dTag).toEqual(['d', 'bitcoin-dev'])

      const descTag = result.event.tags.find(t => t[0] === 'description')
      expect(descTag).toEqual(['description', 'Bitcoin development discussion'])

      const imageTag = result.event.tags.find(t => t[0] === 'image')
      expect(imageTag).toEqual(['image', 'https://example.com/btc.png'])

      const rulesTag = result.event.tags.find(t => t[0] === 'rules')
      expect(rulesTag).toEqual(['rules', 'Be respectful. No spam.'])

      const pTags = result.event.tags.filter(t => t[0] === 'p')
      expect(pTags).toHaveLength(2)
      expect(pTags[0]).toEqual(['p', 'aabbcc', '', 'moderator'])
      expect(pTags[1]).toEqual(['p', 'ddeeff', '', 'moderator'])
    })

    it('omits optional tags when not provided', async () => {
      const pool = mockPool()
      const result = await handleCommunityCreate(ctx, pool as any, {
        name: 'minimal',
        description: 'Just the basics',
      })

      expect(result.event.kind).toBe(34550)

      const imageTag = result.event.tags.find(t => t[0] === 'image')
      expect(imageTag).toBeUndefined()

      const rulesTag = result.event.tags.find(t => t[0] === 'rules')
      expect(rulesTag).toBeUndefined()

      const pTags = result.event.tags.filter(t => t[0] === 'p')
      expect(pTags).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // handleCommunityPost
  // ---------------------------------------------------------------------------
  describe('handleCommunityPost', () => {
    it('creates kind 1 with a-tag pointing to community', async () => {
      const pool = mockPool()
      const result = await handleCommunityPost(ctx, pool as any, {
        community: '34550:abc123:bitcoin-dev',
        content: 'Hello community!',
      })

      expect(result.event.kind).toBe(1)
      expect(result.event.content).toBe('Hello community!')

      const aTag = result.event.tags.find(t => t[0] === 'a')
      expect(aTag).toEqual(['a', '34550:abc123:bitcoin-dev'])
    })
  })

  // ---------------------------------------------------------------------------
  // handleCommunityApprove
  // ---------------------------------------------------------------------------
  describe('handleCommunityApprove', () => {
    it('creates kind 4550 wrapping original event', async () => {
      const originalEvent = {
        id: 'orig123',
        pubkey: 'author456',
        kind: 1,
        created_at: 1000,
        tags: [['a', '34550:mod789:test']],
        content: 'Hello!',
        sig: 'sig123',
      }
      const pool = mockPool([originalEvent])

      const result = await handleCommunityApprove(ctx, pool as any, {
        community: '34550:mod789:test',
        eventId: 'orig123',
        eventPubkey: 'author456',
      })

      expect(result.event.kind).toBe(4550)

      const aTag = result.event.tags.find(t => t[0] === 'a')
      expect(aTag).toEqual(['a', '34550:mod789:test'])

      const eTag = result.event.tags.find(t => t[0] === 'e')
      expect(eTag).toEqual(['e', 'orig123'])

      const pTag = result.event.tags.find(t => t[0] === 'p')
      expect(pTag).toEqual(['p', 'author456'])

      // Content should be JSON-stringified original event
      const wrapped = JSON.parse(result.event.content)
      expect(wrapped.id).toBe('orig123')
      expect(wrapped.content).toBe('Hello!')
      expect(wrapped.pubkey).toBe('author456')
    })

    it('throws when original event not found', async () => {
      const pool = mockPool([])
      await expect(
        handleCommunityApprove(ctx, pool as any, {
          community: '34550:mod789:test',
          eventId: 'missing',
          eventPubkey: 'author456',
        }),
      ).rejects.toThrow('Event missing not found on relays')
    })
  })

  // ---------------------------------------------------------------------------
  // handleCommunityFeed
  // ---------------------------------------------------------------------------
  describe('handleCommunityFeed', () => {
    it('parses wrapped events from kind 4550', async () => {
      const originalEvent = {
        id: 'orig1',
        pubkey: 'author1',
        kind: 1,
        created_at: 900,
        content: 'Original post',
        tags: [],
        sig: 'sig1',
      }
      const approvalEvent = {
        id: 'approval1',
        pubkey: 'moderator1',
        kind: 4550,
        created_at: 1000,
        tags: [
          ['a', '34550:mod:test'],
          ['e', 'orig1'],
          ['p', 'author1'],
        ],
        content: JSON.stringify(originalEvent),
        sig: 'sig2',
      }

      const pool = mockPool([approvalEvent])
      const posts = await handleCommunityFeed(pool as any, 'npub1test', {
        community: '34550:mod:test',
      })

      expect(posts).toHaveLength(1)
      expect(posts[0].id).toBe('orig1')
      expect(posts[0].pubkey).toBe('author1')
      expect(posts[0].content).toBe('Original post')
      expect(posts[0].createdAt).toBe(900)
      expect(posts[0].approvedBy).toBe('moderator1')
    })

    it('handles invalid JSON content gracefully', async () => {
      const approvalEvent = {
        id: 'approval1',
        pubkey: 'moderator1',
        kind: 4550,
        created_at: 1000,
        tags: [
          ['a', '34550:mod:test'],
          ['e', 'orig1'],
          ['p', 'author1'],
        ],
        content: 'not valid json',
        sig: 'sig2',
      }

      const pool = mockPool([approvalEvent])
      const posts = await handleCommunityFeed(pool as any, 'npub1test', {
        community: '34550:mod:test',
      })

      expect(posts).toHaveLength(1)
      expect(posts[0].content).toBe('not valid json')
      expect(posts[0].pubkey).toBe('author1')
      expect(posts[0].id).toBe('orig1')
    })

    it('queries with correct filter', async () => {
      const pool = mockPool([])
      await handleCommunityFeed(pool as any, 'npub1test', {
        community: '34550:mod:test',
        limit: 10,
        since: 500,
      })

      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        kinds: [4550],
        '#a': ['34550:mod:test'],
        limit: 10,
        since: 500,
      }))
    })
  })

  // ---------------------------------------------------------------------------
  // handleCommunityList
  // ---------------------------------------------------------------------------
  describe('handleCommunityList', () => {
    it('parses community metadata from kind 34550', async () => {
      const events = [
        {
          id: 'c1',
          pubkey: 'creator1',
          kind: 34550,
          created_at: 1000,
          tags: [
            ['d', 'bitcoin-dev'],
            ['description', 'Bitcoin discussion'],
            ['image', 'https://example.com/img.png'],
            ['rules', 'Be nice'],
            ['p', 'mod1', '', 'moderator'],
            ['p', 'mod2', '', 'moderator'],
          ],
          content: '',
          sig: 's1',
        },
        {
          id: 'c2',
          pubkey: 'creator2',
          kind: 34550,
          created_at: 900,
          tags: [
            ['d', 'nostr-dev'],
            ['description', 'Nostr development'],
          ],
          content: '',
          sig: 's2',
        },
      ]

      const pool = mockPool(events)
      const communities = await handleCommunityList(pool as any, 'npub1test', {})

      expect(communities).toHaveLength(2)

      // Sorted by created_at descending
      expect(communities[0].name).toBe('bitcoin-dev')
      expect(communities[0].description).toBe('Bitcoin discussion')
      expect(communities[0].image).toBe('https://example.com/img.png')
      expect(communities[0].rules).toBe('Be nice')
      expect(communities[0].moderators).toEqual(['mod1', 'mod2'])
      expect(communities[0].pubkey).toBe('creator1')

      expect(communities[1].name).toBe('nostr-dev')
      expect(communities[1].description).toBe('Nostr development')
      expect(communities[1].image).toBeUndefined()
      expect(communities[1].moderators).toEqual([])
    })

    it('passes limit to query filter', async () => {
      const pool = mockPool([])
      await handleCommunityList(pool as any, 'npub1test', { limit: 5 })

      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        kinds: [34550],
        limit: 5,
      }))
    })

    it('defaults limit to 20', async () => {
      const pool = mockPool([])
      await handleCommunityList(pool as any, 'npub1test', {})

      expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
        limit: 20,
      }))
    })
  })
})
