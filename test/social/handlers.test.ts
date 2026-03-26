import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { verifyEvent } from 'nostr-tools/pure'
import {
  handleSocialPost,
  handleSocialReply,
  handleSocialReact,
  handleSocialProfileGet,
  handleSocialProfileSet,
  handleContactsGet,
  handleContactsSearch,
  handleContactsFollow,
  handleContactsUnfollow,
  handleSocialDelete,
  handleSocialRepost,
} from '../../src/social/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('social handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleSocialPost', () => {
    it('creates kind 1 event signed by active identity', async () => {
      const pool = mockPool()
      const result = await handleSocialPost(ctx, pool as any, { content: 'hello nostr' })
      expect(result.event.kind).toBe(1)
      expect(result.event.content).toBe('hello nostr')
      expect(result.event.sig).toBeDefined()
      expect(verifyEvent(result.event)).toBe(true)
    })
  })

  describe('handleSocialReply', () => {
    it('creates kind 1 with correct e-tag and p-tag', async () => {
      const pool = mockPool()
      const result = await handleSocialReply(ctx, pool as any, {
        content: 'great post!',
        replyTo: 'abc123event',
        replyToPubkey: 'def456pubkey',
        relay: 'wss://relay.example.com',
      })
      expect(result.event.kind).toBe(1)
      expect(result.event.content).toBe('great post!')
      // e-tag for reply
      const eTag = result.event.tags.find((t: string[]) => t[0] === 'e')
      expect(eTag).toBeDefined()
      expect(eTag![1]).toBe('abc123event')
      // p-tag for author being replied to
      const pTag = result.event.tags.find((t: string[]) => t[0] === 'p')
      expect(pTag).toBeDefined()
      expect(pTag![1]).toBe('def456pubkey')
    })
  })

  describe('handleSocialReact', () => {
    it('creates kind 7 event', async () => {
      const pool = mockPool()
      const result = await handleSocialReact(ctx, pool as any, {
        eventId: 'abc123event',
        eventPubkey: 'def456pubkey',
        reaction: '+',
      })
      expect(result.event.kind).toBe(7)
      expect(result.event.content).toBe('+')
      const eTag = result.event.tags.find((t: string[]) => t[0] === 'e')
      expect(eTag![1]).toBe('abc123event')
    })
  })

  describe('handleSocialProfileGet', () => {
    it('fetches kind 0 and returns parsed profile', async () => {
      const pool = mockPool([{
        kind: 0,
        pubkey: 'somepub',
        created_at: 1000,
        tags: [],
        content: JSON.stringify({ name: 'Test User', about: 'A test user', picture: 'https://example.com/pic.png' }),
        id: 'prof1',
        sig: 'sig1',
      }])
      const result = await handleSocialProfileGet(pool as any, 'somenpub', 'somepub')
      expect(result.name).toBe('Test User')
      expect(result.about).toBe('A test user')
    })

    it('takes highest created_at when multiple profiles returned', async () => {
      const pool = mockPool([
        { kind: 0, pubkey: 'p', created_at: 500, tags: [], content: JSON.stringify({ name: 'Old' }), id: '1', sig: 's' },
        { kind: 0, pubkey: 'p', created_at: 1000, tags: [], content: JSON.stringify({ name: 'New' }), id: '2', sig: 's' },
      ])
      const result = await handleSocialProfileGet(pool as any, 'npub', 'p')
      expect(result.name).toBe('New')
    })

    it('returns empty profile when none found', async () => {
      const pool = mockPool([])
      const result = await handleSocialProfileGet(pool as any, 'somenpub', 'somepub')
      expect(result).toEqual({})
    })
  })

  describe('handleSocialProfileSet', () => {
    it('publishes kind 0 for new identity', async () => {
      const pool = mockPool([]) // no existing profile
      const result = await handleSocialProfileSet(ctx, pool as any, {
        profile: { name: 'New Name', about: 'Hello' },
      })
      expect(result.published).toBe(true)
      expect(result.event.kind).toBe(0)
    })

    it('returns warning + diff and requires confirm when profile exists', async () => {
      const existingProfile = {
        kind: 0,
        pubkey: 'somepub',
        created_at: 1000,
        tags: [],
        content: JSON.stringify({ name: 'Old Name', about: 'Old about' }),
        id: 'prof1',
        sig: 'sig1',
      }
      const pool = mockPool([existingProfile])
      const result = await handleSocialProfileSet(ctx, pool as any, {
        profile: { name: 'New Name', about: 'New about' },
        confirm: false,
      })
      expect(result.published).toBe(false)
      expect(result.warning).toMatch(/exists/i)
      expect(result.diff).toBeDefined()
    })

    it('publishes when confirm is true even if profile exists', async () => {
      const existingProfile = {
        kind: 0,
        pubkey: 'somepub',
        created_at: 1000,
        tags: [],
        content: JSON.stringify({ name: 'Old Name' }),
        id: 'prof1',
        sig: 'sig1',
      }
      const pool = mockPool([existingProfile])
      const result = await handleSocialProfileSet(ctx, pool as any, {
        profile: { name: 'New Name' },
        confirm: true,
      })
      expect(result.published).toBe(true)
    })
  })

  describe('handleSocialDelete', () => {
    it('creates kind 5 deletion event', async () => {
      const pool = mockPool()
      const result = await handleSocialDelete(ctx, pool as any, { eventId: 'abc123' })
      expect(result.event.kind).toBe(5)
      const eTag = result.event.tags.find((t: string[]) => t[0] === 'e')
      expect(eTag![1]).toBe('abc123')
    })

    it('includes reason when provided', async () => {
      const pool = mockPool()
      const result = await handleSocialDelete(ctx, pool as any, {
        eventId: 'abc123',
        reason: 'posted by mistake',
      })
      expect(result.event.content).toBe('posted by mistake')
    })
  })

  describe('handleSocialRepost', () => {
    it('creates kind 6 repost event', async () => {
      const pool = mockPool()
      const result = await handleSocialRepost(ctx, pool as any, {
        eventId: 'note123',
        eventPubkey: 'author456',
      })
      expect(result.event.kind).toBe(6)
      const eTag = result.event.tags.find((t: string[]) => t[0] === 'e')
      expect(eTag![1]).toBe('note123')
      const pTag = result.event.tags.find((t: string[]) => t[0] === 'p')
      expect(pTag![1]).toBe('author456')
    })
  })

  describe('handleContactsGet', () => {
    it('fetches kind 3 and returns list of followed pubkeys', async () => {
      const contactEvent = {
        kind: 3,
        pubkey: 'mypub',
        created_at: 1000,
        tags: [['p', 'friend1'], ['p', 'friend2'], ['p', 'friend3', 'wss://relay.example.com', 'alice']],
        content: '',
        id: 'c1',
        sig: 's1',
      }
      const pool = mockPool([contactEvent])
      const result = await handleContactsGet(pool as any, 'somenpub', 'mypub')
      expect(result.length).toBe(3)
      expect(result[0].pubkey).toBe('friend1')
      expect(result[2].relay).toBe('wss://relay.example.com')
      expect(result[2].petname).toBe('alice')
    })

    it('takes highest created_at when multiple kind 3 events', async () => {
      const pool = mockPool([
        { kind: 3, pubkey: 'p', created_at: 500, tags: [['p', 'old']], content: '', id: '1', sig: 's' },
        { kind: 3, pubkey: 'p', created_at: 1000, tags: [['p', 'new']], content: '', id: '2', sig: 's' },
      ])
      const result = await handleContactsGet(pool as any, 'npub', 'p')
      expect(result.length).toBe(1)
      expect(result[0].pubkey).toBe('new')
    })

    it('returns empty when no kind 3 found', async () => {
      const pool = mockPool([])
      const result = await handleContactsGet(pool as any, 'somenpub', 'mypub')
      expect(result).toEqual([])
    })
  })

  describe('handleContactsSearch', () => {
    const contactEvent = {
      kind: 3,
      pubkey: 'mypub',
      created_at: 1000,
      tags: [['p', 'aaa111'], ['p', 'bbb222'], ['p', 'ccc333']],
      content: '',
      id: 'c1',
      sig: 's1',
    }

    function profileEvent(pubkey: string, name: string, displayName?: string, nip05?: string) {
      const content: Record<string, string> = { name }
      if (displayName) content.display_name = displayName
      if (nip05) content.nip05 = nip05
      return {
        kind: 0,
        pubkey,
        created_at: 1000,
        tags: [],
        content: JSON.stringify(content),
        id: `profile-${pubkey}`,
        sig: 's',
      }
    }

    it('finds contact by name (case insensitive)', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([contactEvent]) // kind 3
          .mockResolvedValueOnce([ // kind 0 batch
            profileEvent('aaa111', 'frosty', 'Frosty'),
            profileEvent('bbb222', 'Alice'),
            profileEvent('ccc333', 'Bob'),
          ]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgs')
      expect(result.length).toBe(1)
      expect(result[0].pubkey).toBe('aaa111')
      expect(result[0].name).toBe('frosty')
      expect(result[0].displayName).toBe('Frosty')
    })

    it('matches display_name', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([contactEvent])
          .mockResolvedValueOnce([
            profileEvent('aaa111', 'xyz', 'The Frosty'),
            profileEvent('bbb222', 'Alice'),
            profileEvent('ccc333', 'Bob'),
          ]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgan')
      expect(result.length).toBe(1)
      expect(result[0].pubkey).toBe('aaa111')
    })

    it('matches nip05', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([contactEvent])
          .mockResolvedValueOnce([
            profileEvent('aaa111', 'Someone', undefined, 'frosty@nostr.com'),
            profileEvent('bbb222', 'Alice'),
            profileEvent('ccc333', 'Bob'),
          ]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgs')
      expect(result.length).toBe(1)
      expect(result[0].nip05).toBe('frosty@nostr.com')
    })

    it('returns empty when no matches', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([contactEvent])
          .mockResolvedValueOnce([
            profileEvent('aaa111', 'Alice'),
            profileEvent('bbb222', 'Bob'),
            profileEvent('ccc333', 'Charlie'),
          ]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgs')
      expect(result).toEqual([])
    })

    it('returns empty when no contacts exist', async () => {
      const pool = {
        query: vi.fn().mockResolvedValueOnce([]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgs')
      expect(result).toEqual([])
    })

    it('returns multiple matches', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce([contactEvent])
          .mockResolvedValueOnce([
            profileEvent('aaa111', 'Frosty1'),
            profileEvent('bbb222', 'Frosty2'),
            profileEvent('ccc333', 'Bob'),
          ]),
        publish: vi.fn(),
      }
      const result = await handleContactsSearch(pool as any, 'npub', 'mypub', 'morgan')
      expect(result.length).toBe(2)
    })
  })

  describe('handleContactsFollow', () => {
    it('adds pubkey to contact list and publishes kind 3', async () => {
      const pool = mockPool([]) // no existing contacts
      const result = await handleContactsFollow(ctx, pool as any, {
        pubkeyHex: 'newfollow123',
      })
      expect(result.event.kind).toBe(3)
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.some((t: string[]) => t[1] === 'newfollow123')).toBe(true)
    })

    it('preserves existing contacts when adding', async () => {
      const existing = {
        kind: 3,
        pubkey: 'mypub',
        created_at: 1000,
        tags: [['p', 'existing1'], ['p', 'existing2']],
        content: '',
        id: 'c1',
        sig: 's1',
      }
      const pool = mockPool([existing])
      const result = await handleContactsFollow(ctx, pool as any, {
        pubkeyHex: 'newfollow',
      })
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.length).toBe(3) // existing 2 + new 1
    })

    it('does not duplicate if already following', async () => {
      const existing = {
        kind: 3,
        pubkey: 'mypub',
        created_at: 1000,
        tags: [['p', 'already']],
        content: '',
        id: 'c1',
        sig: 's1',
      }
      const pool = mockPool([existing])
      const result = await handleContactsFollow(ctx, pool as any, {
        pubkeyHex: 'already',
      })
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.length).toBe(1)
    })
  })

  describe('handleContactsUnfollow', () => {
    it('removes pubkey from contact list', async () => {
      const existing = {
        kind: 3,
        pubkey: 'mypub',
        created_at: 1000,
        tags: [['p', 'keep'], ['p', 'remove'], ['p', 'alsokeep']],
        content: '',
        id: 'c1',
        sig: 's1',
      }
      const pool = mockPool([existing])
      const result = await handleContactsUnfollow(ctx, pool as any, {
        pubkeyHex: 'remove',
      })
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.length).toBe(2)
      expect(pTags.every((t: string[]) => t[1] !== 'remove')).toBe(true)
    })
  })
})
