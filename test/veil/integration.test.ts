import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event as NostrEvent } from 'nostr-tools'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'
import { handleFeed, handleNotifications } from '../../src/social/notifications.js'
import { mockAssertionEvent } from '../helpers/mock-veil.js'

// Must be a string literal -- vi.mock factories are hoisted before variable declarations
const ACTIVE_HEX = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

vi.mock('nostr-veil/nip85', () => ({
  parseAssertion: vi.fn((event: any) => {
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')
    return { kind: event.kind, subject: dTag?.[1] ?? '', metrics: {} }
  }),
}))

vi.mock('nostr-veil/proof', () => ({
  verifyProof: vi.fn(),
}))

vi.mock('nostr-tools/nip19', () => ({
  decode: vi.fn(() => ({ data: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', type: 'npub' })),
}))

const TEST_NPUB = 'npub1test'
const TRUSTED_PUBKEY = 'a'.padEnd(64, 'a')
const UNTRUSTED_PUBKEY = 'b'.padEnd(64, 'b')

function makeEvent(id: string, pubkey: string, kind = 1): NostrEvent {
  return {
    id: id.padEnd(64, id),
    pubkey,
    created_at: 1_000_000,
    kind,
    tags: [],
    content: `content from ${pubkey.slice(0, 4)}`,
    sig: 'f'.padEnd(128, 'f'),
  }
}

function mockPool(feedEvents: NostrEvent[], assertionEvents: NostrEvent[] = []) {
  return {
    query: vi.fn().mockImplementation((_npub: string, filter: { kinds: number[] }) => {
      // Return assertion events for NIP-85 queries (kind 30382)
      if (filter.kinds?.includes(30382)) {
        return Promise.resolve(assertionEvents)
      }
      return Promise.resolve(feedEvents)
    }),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

function mockCtx(npub = TEST_NPUB) {
  return {
    activeNpub: npub,
    activePublicKeyHex: 'c'.padEnd(64, 'c'),
  }
}

describe('handleFeed trust scoring integration', () => {
  let cache: TrustCache

  beforeEach(() => {
    cache = new TrustCache({ ttl: 60_000, maxEntries: 100 })
    vi.clearAllMocks()
  })

  it('filters out untrusted events in strict mode', async () => {
    const feedEvents = [
      makeEvent('1', TRUSTED_PUBKEY),
      makeEvent('2', UNTRUSTED_PUBKEY),
    ]

    const assertionForTrusted = mockAssertionEvent({ subject: TRUSTED_PUBKEY })
    const pool = mockPool(feedEvents, [assertionForTrusted])

    const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
    const ctx = mockCtx()

    const feed = await handleFeed(ctx as any, pool as any, {
      trust: 'strict',
      _scoring: scoring,
    })

    expect(feed).toHaveLength(1)
    expect(feed[0].pubkey).toBe(TRUSTED_PUBKEY)
    expect(feed[0].trustScore).toBe(1) // 1 endorsement
  })

  it('returns all events with scores in annotate mode', async () => {
    const feedEvents = [
      makeEvent('1', TRUSTED_PUBKEY),
      makeEvent('2', UNTRUSTED_PUBKEY),
    ]

    const assertionForTrusted = mockAssertionEvent({ subject: TRUSTED_PUBKEY })
    const pool = mockPool(feedEvents, [assertionForTrusted])

    const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
    const ctx = mockCtx()

    const feed = await handleFeed(ctx as any, pool as any, {
      trust: 'annotate',
      _scoring: scoring,
    })

    expect(feed).toHaveLength(2)
    const trusted = feed.find(f => f.pubkey === TRUSTED_PUBKEY)!
    const untrusted = feed.find(f => f.pubkey === UNTRUSTED_PUBKEY)!
    expect(trusted.trustScore).toBe(1) // 1 endorsement
    expect(untrusted.trustScore).toBe(0)
  })

  it('returns all events without scoring when trust is off', async () => {
    const feedEvents = [
      makeEvent('1', TRUSTED_PUBKEY),
      makeEvent('2', UNTRUSTED_PUBKEY),
    ]

    const pool = mockPool(feedEvents)
    const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
    const ctx = mockCtx()

    const feed = await handleFeed(ctx as any, pool as any, {
      trust: 'off',
      _scoring: scoring,
    })

    expect(feed).toHaveLength(2)
    // trustScore should be absent
    feed.forEach(f => expect(f.trustScore).toBeUndefined())
  })

  it('returns all events without scores when no _scoring injected', async () => {
    const feedEvents = [
      makeEvent('1', TRUSTED_PUBKEY),
      makeEvent('2', UNTRUSTED_PUBKEY),
    ]

    const pool = mockPool(feedEvents)
    const ctx = mockCtx()

    const feed = await handleFeed(ctx as any, pool as any, {
      trust: 'strict',
      // no _scoring
    })

    expect(feed).toHaveLength(2)
    feed.forEach(f => expect(f.trustScore).toBeUndefined())
  })
})

describe('handleNotifications trust scoring integration', () => {
  let cache: TrustCache

  beforeEach(() => {
    cache = new TrustCache({ ttl: 60_000, maxEntries: 100 })
    vi.clearAllMocks()
  })

  it('filters untrusted notifications in strict mode', async () => {
    const notifEvents: NostrEvent[] = [
      { ...makeEvent('3', TRUSTED_PUBKEY), tags: [['p', ACTIVE_HEX]] },
      { ...makeEvent('4', UNTRUSTED_PUBKEY), tags: [['p', ACTIVE_HEX]] },
    ]

    const assertionForTrusted = mockAssertionEvent({ subject: TRUSTED_PUBKEY })
    const pool = mockPool(notifEvents, [assertionForTrusted])

    const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
    const ctx = {
      activeNpub: TEST_NPUB,
      activePublicKeyHex: ACTIVE_HEX,
    }

    const notifications = await handleNotifications(ctx as any, pool as any, {
      trust: 'strict',
      _scoring: scoring,
    })

    expect(notifications).toHaveLength(1)
    expect(notifications[0].from).toBe(TRUSTED_PUBKEY)
    expect(notifications[0].trustScore).toBe(1)
  })

  it('annotates notifications with trust scores in annotate mode', async () => {
    const notifEvents: NostrEvent[] = [
      { ...makeEvent('5', TRUSTED_PUBKEY), tags: [['p', ACTIVE_HEX]] },
      { ...makeEvent('6', UNTRUSTED_PUBKEY), tags: [['p', ACTIVE_HEX]] },
    ]

    const assertionForTrusted = mockAssertionEvent({ subject: TRUSTED_PUBKEY })
    const pool = mockPool(notifEvents, [assertionForTrusted])

    const scoring = new VeilScoring(pool as any, cache, TEST_NPUB)
    const ctx = {
      activeNpub: TEST_NPUB,
      activePublicKeyHex: ACTIVE_HEX,
    }

    const notifications = await handleNotifications(ctx as any, pool as any, {
      trust: 'annotate',
      _scoring: scoring,
    })

    expect(notifications).toHaveLength(2)
    const trusted = notifications.find(n => n.from === TRUSTED_PUBKEY)!
    const untrusted = notifications.find(n => n.from === UNTRUSTED_PUBKEY)!
    expect(trusted.trustScore).toBe(1)
    expect(untrusted.trustScore).toBe(0)
  })
})
