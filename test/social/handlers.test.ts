import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { verifyEvent } from 'nostr-tools/pure'
import {
  handleSocialPost,
  handleSocialReply,
  handleSocialReact,
  handleSocialProfileGet,
  handleSocialProfileSet,
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
})
