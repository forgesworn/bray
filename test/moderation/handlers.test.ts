import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleLabelCreate,
  handleLabelSelf,
  handleLabelRead,
  handleLabelSearch,
  handleLabelRemove,
  handleListMute,
  handleListMuteRead,
  handleListCheckMuted,
  handleListPin,
  handleListPinRead,
  handleListFollowSetCreate,
  handleListFollowSetManage,
  handleListFollowSetRead,
  handleListBookmark,
  handleListBookmarkRead,
  handleModerationFilter,
} from '../../src/moderation/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('moderation handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // -------------------------------------------------------------------------
  // NIP-32 Label tools
  // -------------------------------------------------------------------------

  describe('handleLabelCreate', () => {
    it('creates kind 1985 event with L and l tags', async () => {
      const pool = mockPool()
      const result = await handleLabelCreate(ctx, pool as any, {
        namespace: 'ugc',
        label: 'spam',
        targetEventId: 'a'.repeat(64),
      })
      expect(result.event.kind).toBe(1985)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['L', 'ugc'],
          ['l', 'spam', 'ugc'],
          ['e', 'a'.repeat(64)],
        ]),
      )
      expect(result.event.sig).toBeDefined()
    })

    it('supports labelling a pubkey via p-tag', async () => {
      const pool = mockPool()
      const pk = 'b'.repeat(64)
      const result = await handleLabelCreate(ctx, pool as any, {
        namespace: 'social.example.com',
        label: 'trusted',
        targetPubkey: pk,
      })
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['p', pk],
        ]),
      )
    })

    it('supports labelling an addressable event via a-tag', async () => {
      const pool = mockPool()
      const result = await handleLabelCreate(ctx, pool as any, {
        namespace: 'org.ontology',
        label: 'article',
        targetAddress: `30023:${'c'.repeat(64)}:my-slug`,
      })
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['a', `30023:${'c'.repeat(64)}:my-slug`],
        ]),
      )
    })

    it('rejects when no target is provided', async () => {
      const pool = mockPool()
      await expect(
        handleLabelCreate(ctx, pool as any, {
          namespace: 'ugc',
          label: 'spam',
        }),
      ).rejects.toThrow(/target/)
    })

    it('supports multiple targets in a single label', async () => {
      const pool = mockPool()
      const result = await handleLabelCreate(ctx, pool as any, {
        namespace: 'review',
        label: 'positive',
        targetEventId: 'd'.repeat(64),
        targetPubkey: 'e'.repeat(64),
      })
      const eTags = result.event.tags.filter((t: string[]) => t[0] === 'e')
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(eTags.length).toBe(1)
      expect(pTags.length).toBe(1)
    })
  })

  describe('handleLabelSelf', () => {
    it('creates self-label with e-tag referencing own event', async () => {
      const pool = mockPool()
      const eventId = 'f'.repeat(64)
      const result = await handleLabelSelf(ctx, pool as any, {
        namespace: 'content-warning',
        label: 'spoiler',
        eventId,
        content: 'Contains spoilers for Season 3',
      })
      expect(result.event.kind).toBe(1985)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['L', 'content-warning'],
          ['l', 'spoiler', 'content-warning'],
          ['e', eventId],
        ]),
      )
      expect(result.event.content).toBe('Contains spoilers for Season 3')
    })
  })

  describe('handleLabelRead', () => {
    it('queries labels filtered by target event', async () => {
      const targetId = 'a'.repeat(64)
      const mockLabel = {
        id: '1'.repeat(64),
        pubkey: '2'.repeat(64),
        kind: 1985,
        tags: [['L', 'ugc'], ['l', 'spam', 'ugc'], ['e', targetId]],
        content: '',
        created_at: 1700000000,
        sig: 'sig',
      }
      const pool = mockPool([mockLabel])
      const labels = await handleLabelRead(pool as any, ctx.activeNpub, {
        targetEventId: targetId,
      })
      expect(labels.length).toBe(1)
      expect(labels[0].namespace).toBe('ugc')
      expect(labels[0].label).toBe('spam')
      expect(labels[0].targets[0]).toEqual({ type: 'event', value: targetId })
    })

    it('returns empty array when no labels found', async () => {
      const pool = mockPool([])
      const labels = await handleLabelRead(pool as any, ctx.activeNpub, {
        targetPubkey: 'z'.repeat(64),
      })
      expect(labels).toEqual([])
    })

    it('passes namespace filter to relay query', async () => {
      const pool = mockPool([])
      await handleLabelRead(pool as any, ctx.activeNpub, {
        targetEventId: 'a'.repeat(64),
        namespace: 'ugc',
      })
      const filter = pool.query.mock.calls[0][1]
      expect(filter['#L']).toEqual(['ugc'])
    })

    it('passes labeller filter as authors', async () => {
      const labeller = 'b'.repeat(64)
      const pool = mockPool([])
      await handleLabelRead(pool as any, ctx.activeNpub, {
        targetPubkey: 'a'.repeat(64),
        labeller,
      })
      const filter = pool.query.mock.calls[0][1]
      expect(filter.authors).toEqual([labeller])
    })
  })

  describe('handleLabelSearch', () => {
    it('queries by namespace and label value', async () => {
      const pool = mockPool([])
      await handleLabelSearch(pool as any, ctx.activeNpub, {
        namespace: 'ugc',
        label: 'spam',
      })
      const filter = pool.query.mock.calls[0][1]
      expect(filter.kinds).toEqual([1985])
      expect(filter['#L']).toEqual(['ugc'])
      expect(filter['#l']).toEqual(['spam'])
    })
  })

  describe('handleLabelRemove', () => {
    it('creates kind 5 deletion event', async () => {
      const pool = mockPool()
      const labelId = 'a'.repeat(64)
      const result = await handleLabelRemove(ctx, pool as any, { labelEventId: labelId })
      expect(result.event.kind).toBe(5)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['e', labelId],
          ['k', '1985'],
        ]),
      )
    })
  })

  // -------------------------------------------------------------------------
  // NIP-51 Mute list (kind 10000)
  // -------------------------------------------------------------------------

  describe('handleListMute', () => {
    it('adds entries to empty mute list', async () => {
      const pool = mockPool([]) // no existing mute list
      const result = await handleListMute(ctx, pool as any, {
        action: 'add',
        entries: [
          { type: 'pubkey', value: 'a'.repeat(64) },
          { type: 'keyword', value: 'crypto scam' },
        ],
      })
      expect(result.event.kind).toBe(10000)
      expect(result.entries.length).toBe(2)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['p', 'a'.repeat(64)],
          ['word', 'crypto scam'],
        ]),
      )
    })

    it('adds entries to existing mute list without duplicates', async () => {
      const existing = {
        id: '1'.repeat(64),
        kind: 10000,
        pubkey: ctx.activePublicKeyHex,
        tags: [['p', 'a'.repeat(64)]],
        content: '',
        created_at: 1700000000,
        sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListMute(ctx, pool as any, {
        action: 'add',
        entries: [
          { type: 'pubkey', value: 'a'.repeat(64) }, // duplicate
          { type: 'pubkey', value: 'b'.repeat(64) }, // new
        ],
      })
      // Should have 2 p-tags (original + new), not 3
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.length).toBe(2)
    })

    it('removes entries from mute list', async () => {
      const existing = {
        id: '1'.repeat(64),
        kind: 10000,
        pubkey: ctx.activePublicKeyHex,
        tags: [
          ['p', 'a'.repeat(64)],
          ['p', 'b'.repeat(64)],
          ['word', 'spam'],
        ],
        content: '',
        created_at: 1700000000,
        sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListMute(ctx, pool as any, {
        action: 'remove',
        entries: [{ type: 'pubkey', value: 'a'.repeat(64) }],
      })
      const pTags = result.event.tags.filter((t: string[]) => t[0] === 'p')
      expect(pTags.length).toBe(1)
      expect(pTags[0][1]).toBe('b'.repeat(64))
    })
  })

  describe('handleListMuteRead', () => {
    it('returns empty when no mute list exists', async () => {
      const pool = mockPool([])
      const result = await handleListMuteRead(pool as any, ctx.activeNpub)
      expect(result.entries).toEqual([])
    })

    it('parses all entry types', async () => {
      const existing = {
        id: '1'.repeat(64),
        kind: 10000,
        pubkey: ctx.activePublicKeyHex,
        tags: [
          ['p', 'a'.repeat(64)],
          ['e', 'b'.repeat(64)],
          ['word', 'spam'],
          ['t', 'crypto'],
        ],
        content: '',
        created_at: 1700000000,
        sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListMuteRead(pool as any, ctx.activeNpub)
      expect(result.entries).toEqual([
        { type: 'pubkey', value: 'a'.repeat(64) },
        { type: 'event', value: 'b'.repeat(64) },
        { type: 'keyword', value: 'spam' },
        { type: 'hashtag', value: 'crypto' },
      ])
    })
  })

  describe('handleListCheckMuted', () => {
    it('detects muted pubkey', async () => {
      const pk = 'a'.repeat(64)
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['p', pk]], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListCheckMuted(pool as any, ctx.activeNpub, { pubkey: pk })
      expect(result.muted).toBe(true)
      expect(result.matchType).toBe('pubkey')
    })

    it('returns not muted for unknown pubkey', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['p', 'a'.repeat(64)]], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListCheckMuted(pool as any, ctx.activeNpub, { pubkey: 'b'.repeat(64) })
      expect(result.muted).toBe(false)
    })

    it('detects muted keyword case-insensitively', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['word', 'Spam']], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListCheckMuted(pool as any, ctx.activeNpub, { keyword: 'spam' })
      expect(result.muted).toBe(true)
      expect(result.matchType).toBe('keyword')
    })

    it('detects muted hashtag case-insensitively', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['t', 'Bitcoin']], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListCheckMuted(pool as any, ctx.activeNpub, { hashtag: 'bitcoin' })
      expect(result.muted).toBe(true)
      expect(result.matchType).toBe('hashtag')
    })
  })

  // -------------------------------------------------------------------------
  // NIP-51 Pin list (kind 10001)
  // -------------------------------------------------------------------------

  describe('handleListPin', () => {
    it('adds pinned events', async () => {
      const pool = mockPool([])
      const eventId = 'a'.repeat(64)
      const result = await handleListPin(ctx, pool as any, {
        action: 'add',
        eventIds: [eventId],
      })
      expect(result.event.kind).toBe(10001)
      expect(result.pinned).toContain(eventId)
    })

    it('removes pinned events', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10001, pubkey: ctx.activePublicKeyHex,
        tags: [['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListPin(ctx, pool as any, {
        action: 'remove',
        eventIds: ['a'.repeat(64)],
      })
      expect(result.pinned).toEqual(['b'.repeat(64)])
    })

    it('does not duplicate existing pins on add', async () => {
      const eventId = 'a'.repeat(64)
      const existing = {
        id: '1'.repeat(64), kind: 10001, pubkey: ctx.activePublicKeyHex,
        tags: [['e', eventId]], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListPin(ctx, pool as any, {
        action: 'add',
        eventIds: [eventId],
      })
      expect(result.pinned.length).toBe(1)
    })
  })

  describe('handleListPinRead', () => {
    it('returns empty when no pin list exists', async () => {
      const pool = mockPool([])
      const result = await handleListPinRead(pool as any, ctx.activeNpub)
      expect(result.pinned).toEqual([])
    })

    it('reads pinned event IDs', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10001, pubkey: ctx.activePublicKeyHex,
        tags: [['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListPinRead(pool as any, ctx.activeNpub)
      expect(result.pinned).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    })
  })

  // -------------------------------------------------------------------------
  // NIP-51 Follow sets (kind 30000)
  // -------------------------------------------------------------------------

  describe('handleListFollowSetCreate', () => {
    it('creates kind 30000 with d-tag and p-tags', async () => {
      const pool = mockPool()
      const result = await handleListFollowSetCreate(ctx, pool as any, {
        name: 'developers',
        description: 'My dev friends',
        pubkeys: ['a'.repeat(64), 'b'.repeat(64)],
      })
      expect(result.event.kind).toBe(30000)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['d', 'developers'],
          ['description', 'My dev friends'],
          ['p', 'a'.repeat(64)],
          ['p', 'b'.repeat(64)],
        ]),
      )
    })
  })

  describe('handleListFollowSetManage', () => {
    it('adds pubkeys to existing set', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 30000, pubkey: ctx.activePublicKeyHex,
        tags: [['d', 'devs'], ['p', 'a'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListFollowSetManage(ctx, pool as any, {
        name: 'devs',
        action: 'add',
        pubkeys: ['b'.repeat(64)],
      })
      expect(result.members).toContain('a'.repeat(64))
      expect(result.members).toContain('b'.repeat(64))
    })

    it('removes pubkeys from existing set', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 30000, pubkey: ctx.activePublicKeyHex,
        tags: [['d', 'devs'], ['p', 'a'.repeat(64)], ['p', 'b'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListFollowSetManage(ctx, pool as any, {
        name: 'devs',
        action: 'remove',
        pubkeys: ['a'.repeat(64)],
      })
      expect(result.members).toEqual(['b'.repeat(64)])
    })

    it('creates new set if none exists', async () => {
      const pool = mockPool([])
      const result = await handleListFollowSetManage(ctx, pool as any, {
        name: 'new-set',
        action: 'add',
        pubkeys: ['a'.repeat(64)],
      })
      expect(result.members).toEqual(['a'.repeat(64)])
      // Should have d-tag
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toEqual(['d', 'new-set'])
    })
  })

  describe('handleListFollowSetRead', () => {
    it('returns empty when set does not exist', async () => {
      const pool = mockPool([])
      const result = await handleListFollowSetRead(pool as any, ctx.activeNpub, { name: 'nonexistent' })
      expect(result.members).toEqual([])
    })

    it('reads members and description', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 30000, pubkey: ctx.activePublicKeyHex,
        tags: [['d', 'devs'], ['description', 'Dev friends'], ['p', 'a'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListFollowSetRead(pool as any, ctx.activeNpub, { name: 'devs' })
      expect(result.members).toEqual(['a'.repeat(64)])
      expect(result.description).toBe('Dev friends')
    })
  })

  // -------------------------------------------------------------------------
  // NIP-51 Bookmarks (kind 10003 / 30001)
  // -------------------------------------------------------------------------

  describe('handleListBookmark', () => {
    it('creates general bookmark (kind 10003) with event IDs', async () => {
      const pool = mockPool([])
      const result = await handleListBookmark(ctx, pool as any, {
        action: 'add',
        eventIds: ['a'.repeat(64)],
      })
      expect(result.event.kind).toBe(10003)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([['e', 'a'.repeat(64)]]),
      )
    })

    it('creates named bookmark set (kind 30001) with d-tag', async () => {
      const pool = mockPool([])
      const result = await handleListBookmark(ctx, pool as any, {
        name: 'reading-list',
        action: 'add',
        urls: ['https://example.com/article'],
      })
      expect(result.event.kind).toBe(30001)
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['d', 'reading-list'],
          ['r', 'https://example.com/article'],
        ]),
      )
    })

    it('supports all bookmark entry types', async () => {
      const pool = mockPool([])
      const result = await handleListBookmark(ctx, pool as any, {
        action: 'add',
        eventIds: ['a'.repeat(64)],
        addresses: [`30023:${'b'.repeat(64)}:slug`],
        urls: ['https://example.com'],
        hashtags: ['nostr'],
      })
      expect(result.event.tags).toEqual(
        expect.arrayContaining([
          ['e', 'a'.repeat(64)],
          ['a', `30023:${'b'.repeat(64)}:slug`],
          ['r', 'https://example.com'],
          ['t', 'nostr'],
        ]),
      )
    })

    it('removes bookmarks', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10003, pubkey: ctx.activePublicKeyHex,
        tags: [['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)]],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListBookmark(ctx, pool as any, {
        action: 'remove',
        eventIds: ['a'.repeat(64)],
      })
      const eTags = result.event.tags.filter((t: string[]) => t[0] === 'e')
      expect(eTags.length).toBe(1)
      expect(eTags[0][1]).toBe('b'.repeat(64))
    })
  })

  describe('handleListBookmarkRead', () => {
    it('returns empty when no bookmarks exist', async () => {
      const pool = mockPool([])
      const result = await handleListBookmarkRead(pool as any, ctx.activeNpub, {})
      expect(result.eventIds).toEqual([])
      expect(result.urls).toEqual([])
    })

    it('reads all bookmark entry types', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10003, pubkey: ctx.activePublicKeyHex,
        tags: [
          ['e', 'a'.repeat(64)],
          ['a', `30023:${'b'.repeat(64)}:slug`],
          ['r', 'https://example.com'],
          ['t', 'nostr'],
        ],
        content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const result = await handleListBookmarkRead(pool as any, ctx.activeNpub, {})
      expect(result.eventIds).toEqual(['a'.repeat(64)])
      expect(result.addresses).toEqual([`30023:${'b'.repeat(64)}:slug`])
      expect(result.urls).toEqual(['https://example.com'])
      expect(result.hashtags).toEqual(['nostr'])
    })
  })

  // -------------------------------------------------------------------------
  // Moderation filter
  // -------------------------------------------------------------------------

  describe('handleModerationFilter', () => {
    it('blocks events from muted pubkeys', async () => {
      const mutedPk = 'a'.repeat(64)
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['p', mutedPk]], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const events = [
        { id: 'e1'.padEnd(64, '0'), pubkey: mutedPk, content: 'hello', tags: [] },
        { id: 'e2'.padEnd(64, '0'), pubkey: 'b'.repeat(64), content: 'world', tags: [] },
      ]
      const result = await handleModerationFilter(pool as any, ctx.activeNpub, { events })
      expect(result.allowed.length).toBe(1)
      expect(result.allowed[0].id).toBe('e2'.padEnd(64, '0'))
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].reason).toContain('muted pubkey')
    })

    it('blocks events by muted event ID', async () => {
      const mutedEventId = 'e1'.padEnd(64, '0')
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['e', mutedEventId]], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const events = [
        { id: mutedEventId, pubkey: 'b'.repeat(64), content: 'hello', tags: [] },
      ]
      const result = await handleModerationFilter(pool as any, ctx.activeNpub, { events })
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].reason).toContain('muted event')
    })

    it('blocks events containing muted keywords', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['word', 'crypto scam']], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const events = [
        { id: 'e1'.padEnd(64, '0'), pubkey: 'b'.repeat(64), content: 'This is a CRYPTO SCAM alert', tags: [] },
        { id: 'e2'.padEnd(64, '0'), pubkey: 'c'.repeat(64), content: 'Nice weather today', tags: [] },
      ]
      const result = await handleModerationFilter(pool as any, ctx.activeNpub, { events })
      expect(result.allowed.length).toBe(1)
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].reason).toContain('muted keyword')
    })

    it('blocks events with muted hashtags', async () => {
      const existing = {
        id: '1'.repeat(64), kind: 10000, pubkey: ctx.activePublicKeyHex,
        tags: [['t', 'spam']], content: '', created_at: 1700000000, sig: 'sig',
      }
      const pool = mockPool([existing])
      const events = [
        { id: 'e1'.padEnd(64, '0'), pubkey: 'b'.repeat(64), content: 'Buy now!', tags: [['t', 'Spam']] },
        { id: 'e2'.padEnd(64, '0'), pubkey: 'c'.repeat(64), content: 'Hello world', tags: [['t', 'nostr']] },
      ]
      const result = await handleModerationFilter(pool as any, ctx.activeNpub, { events })
      expect(result.allowed.length).toBe(1)
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].reason).toContain('muted hashtag')
    })

    it('allows all events when mute list is empty', async () => {
      const pool = mockPool([])
      const events = [
        { id: 'e1'.padEnd(64, '0'), pubkey: 'a'.repeat(64), content: 'hello', tags: [] },
        { id: 'e2'.padEnd(64, '0'), pubkey: 'b'.repeat(64), content: 'world', tags: [] },
      ]
      const result = await handleModerationFilter(pool as any, ctx.activeNpub, { events })
      expect(result.allowed.length).toBe(2)
      expect(result.blocked.length).toBe(0)
    })
  })
})
