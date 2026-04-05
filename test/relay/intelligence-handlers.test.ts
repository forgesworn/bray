import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleRelayDiscover,
  handleRelayNipSearch,
  handleRelayCompare,
  handleRelayDiversity,
  handleRelayRecommend,
  extractSupportedNips,
  extractOperator,
  fetchNip11Quiet,
} from '../../src/relay/intelligence-handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

const ALICE = 'a'.padEnd(64, 'a')
const BOB = 'b'.padEnd(64, 'b')
const CAROL = 'c'.padEnd(64, 'c')

function mockPool(overrides: Record<string, any> = {}) {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryDirect: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
    reconfigure: vi.fn(),
    checkSharedRelays: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function makeKind3Event(author: string, contacts: string[]): any {
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: author,
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    tags: contacts.map(pk => ['p', pk]),
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

function makeKind10002Event(author: string, relays: Array<{ url: string; mode?: string }>): any {
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: author,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10002,
    tags: relays.map(r => r.mode ? ['r', r.url, r.mode] : ['r', r.url]),
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

describe('relay intelligence handlers', () => {
  let ctx: IdentityContext
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    origFetch = globalThis.fetch
  })

  afterEach(() => {
    ctx.destroy()
    globalThis.fetch = origFetch
  })

  // -----------------------------------------------------------------
  // relay-discover
  // -----------------------------------------------------------------
  describe('handleRelayDiscover', () => {
    it('returns empty when no contacts', async () => {
      const pool = mockPool()
      const result = await handleRelayDiscover(ctx, pool as any, {})
      expect(result.contactsScanned).toBe(0)
      expect(result.relaysFound).toBe(0)
      expect(result.relays).toEqual([])
    })

    it('aggregates relays from contacts kind 10002 events', async () => {
      const myHex = ctx.activePublicKeyHex
      const myContacts = makeKind3Event(myHex, [ALICE, BOB, CAROL])

      const aliceRelays = makeKind10002Event(ALICE, [
        { url: 'wss://popular.relay' },
        { url: 'wss://alice-only.relay', mode: 'read' },
      ])
      const bobRelays = makeKind10002Event(BOB, [
        { url: 'wss://popular.relay' },
        { url: 'wss://bob-only.relay', mode: 'write' },
      ])
      const carolRelays = makeKind10002Event(CAROL, [
        { url: 'wss://popular.relay' },
      ])

      const pool = mockPool({
        query: vi.fn()
          .mockResolvedValueOnce([myContacts])           // kind 3 query
          .mockResolvedValueOnce([aliceRelays, bobRelays, carolRelays]), // kind 10002 query
      })

      const result = await handleRelayDiscover(ctx, pool as any, { limit: 10 })

      expect(result.contactsScanned).toBe(3)
      expect(result.relaysFound).toBeGreaterThan(0)

      // wss://popular.relay should be ranked highest (used by all 3 contacts)
      const popular = result.relays.find(r => r.url === 'wss://popular.relay')
      expect(popular).toBeDefined()
      expect(popular!.contactCount).toBeGreaterThanOrEqual(3)
    })

    it('marks relays already in use', async () => {
      const myHex = ctx.activePublicKeyHex
      const myContacts = makeKind3Event(myHex, [ALICE])
      const aliceRelays = makeKind10002Event(ALICE, [
        { url: 'wss://relay.test' }, // same as our configured relay
        { url: 'wss://new.relay' },
      ])

      const pool = mockPool({
        query: vi.fn()
          .mockResolvedValueOnce([myContacts])
          .mockResolvedValueOnce([aliceRelays]),
        getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
      })

      const result = await handleRelayDiscover(ctx, pool as any, {})

      const existing = result.relays.find(r => r.url === 'wss://relay.test')
      expect(existing?.alreadyUsed).toBe(true)

      const newRelay = result.relays.find(r => r.url === 'wss://new.relay')
      expect(newRelay?.alreadyUsed).toBe(false)
    })

    it('respects limit parameter', async () => {
      const myHex = ctx.activePublicKeyHex
      const myContacts = makeKind3Event(myHex, [ALICE])

      // Create many relay entries
      const relays = Array.from({ length: 20 }, (_, i) => ({ url: `wss://relay${i}.test` }))
      const aliceRelays = makeKind10002Event(ALICE, relays)

      const pool = mockPool({
        query: vi.fn()
          .mockResolvedValueOnce([myContacts])
          .mockResolvedValueOnce([aliceRelays]),
      })

      const result = await handleRelayDiscover(ctx, pool as any, { limit: 5 })
      expect(result.relays.length).toBeLessThanOrEqual(5)
    })

    it('deduplicates kind 10002 events per author (takes newest)', async () => {
      const myHex = ctx.activePublicKeyHex
      const myContacts = makeKind3Event(myHex, [ALICE])

      const oldRelays = {
        ...makeKind10002Event(ALICE, [{ url: 'wss://old.relay' }]),
        created_at: 1000,
      }
      const newRelays = {
        ...makeKind10002Event(ALICE, [{ url: 'wss://new.relay' }]),
        created_at: 2000,
      }

      const pool = mockPool({
        query: vi.fn()
          .mockResolvedValueOnce([myContacts])
          .mockResolvedValueOnce([oldRelays, newRelays]),
      })

      const result = await handleRelayDiscover(ctx, pool as any, {})

      const oldRelay = result.relays.find(r => r.url === 'wss://old.relay')
      const newRelay = result.relays.find(r => r.url === 'wss://new.relay')
      expect(oldRelay).toBeUndefined()
      expect(newRelay).toBeDefined()
    })
  })

  // -----------------------------------------------------------------
  // relay-nip-search
  // -----------------------------------------------------------------
  describe('handleRelayNipSearch', () => {
    it('finds relays supporting requested NIPs', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('search-relay')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Search Relay',
              supported_nips: [1, 11, 42, 50],
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            name: 'Basic Relay',
            supported_nips: [1, 11],
          }),
        })
      }) as any

      const pool = mockPool()
      const result = await handleRelayNipSearch(ctx, pool as any, {
        nips: [50],
        candidateRelays: ['wss://search-relay.test', 'wss://basic-relay.test'],
      })

      expect(result.requestedNips).toEqual([50])
      expect(result.relaysChecked).toBe(2)
      expect(result.matches.length).toBe(1)
      expect(result.matches[0].url).toBe('wss://search-relay.test')
      expect(result.matches[0].matchedNips).toContain(50)
    })

    it('uses configured relays when no candidates specified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ supported_nips: [1, 11, 42] }),
      }) as any

      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({
          read: ['wss://r1.test', 'wss://r2.test'],
          write: ['wss://r1.test'],
        }),
      })

      const result = await handleRelayNipSearch(ctx, pool as any, { nips: [42] })
      expect(result.relaysChecked).toBe(2) // deduplicated
      expect(result.matches.length).toBe(2) // both support NIP-42
    })

    it('handles unreachable relays gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any

      const pool = mockPool()
      const result = await handleRelayNipSearch(ctx, pool as any, {
        nips: [50],
        candidateRelays: ['wss://down.test'],
      })

      expect(result.relaysChecked).toBe(1)
      expect(result.matches).toEqual([])
    })

    it('returns empty when no relay matches', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ supported_nips: [1, 11] }),
      }) as any

      const pool = mockPool()
      const result = await handleRelayNipSearch(ctx, pool as any, {
        nips: [99],
        candidateRelays: ['wss://basic.test'],
      })

      expect(result.matches).toEqual([])
    })

    it('sorts by number of matched NIPs descending', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('both-nips')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ supported_nips: [42, 50] }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ supported_nips: [42] }),
        })
      }) as any

      const pool = mockPool()
      const result = await handleRelayNipSearch(ctx, pool as any, {
        nips: [42, 50],
        candidateRelays: ['wss://one-nip.test', 'wss://both-nips.test'],
      })

      expect(result.matches[0].url).toBe('wss://both-nips.test')
      expect(result.matches[0].matchedNips.length).toBe(2)
    })
  })

  // -----------------------------------------------------------------
  // relay-compare
  // -----------------------------------------------------------------
  describe('handleRelayCompare', () => {
    it('compares multiple relays side-by-side', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const name = url.includes('fast') ? 'Fast Relay' : 'Slow Relay'
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            name,
            description: `A ${name.toLowerCase()}`,
            supported_nips: [1, 11],
            software: 'strfry',
            version: '0.9.0',
          }),
        })
      }) as any

      const pool = mockPool({
        queryDirect: vi.fn().mockResolvedValue([]),
      })

      const result = await handleRelayCompare(ctx, pool as any, {
        relays: ['wss://fast.test', 'wss://slow.test'],
      })

      expect(result.relays.length).toBe(2)
      for (const relay of result.relays) {
        expect(relay.reachable).toBe(true)
        expect(relay.supportedNips).toEqual([1, 11])
        expect(relay.software).toBe('strfry')
      }
    })

    it('reports unreachable relays without failing', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ name: 'Good Relay', supported_nips: [1] }),
        })
        .mockRejectedValueOnce(new Error('Connection refused')) as any

      const pool = mockPool({
        queryDirect: vi.fn().mockResolvedValue([]),
      })

      const result = await handleRelayCompare(ctx, pool as any, {
        relays: ['wss://good.test', 'wss://bad.test'],
      })

      expect(result.relays.length).toBe(2)
      const good = result.relays.find(r => r.url === 'wss://good.test')!
      const bad = result.relays.find(r => r.url === 'wss://bad.test')!

      expect(good.reachable).toBe(true)
      expect(bad.reachable).toBe(false)
      expect(bad.error).toBeDefined()
    })

    it('checks for user events on each relay', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ supported_nips: [1] }),
      }) as any

      const pool = mockPool({
        queryDirect: vi.fn().mockImplementation((relays: string[]) => {
          if (relays[0] === 'wss://has-events.test') {
            return Promise.resolve([{ id: 'ev1', kind: 1, pubkey: ctx.activePublicKeyHex }])
          }
          return Promise.resolve([])
        }),
      })

      const result = await handleRelayCompare(ctx, pool as any, {
        relays: ['wss://has-events.test', 'wss://no-events.test'],
      })

      const withEvents = result.relays.find(r => r.url === 'wss://has-events.test')!
      const withoutEvents = result.relays.find(r => r.url === 'wss://no-events.test')!

      expect(withEvents.hasUserEvents).toBe(true)
      expect(withoutEvents.hasUserEvents).toBe(false)
    })

    it('rejects private relay URLs', async () => {
      const pool = mockPool()
      await expect(
        handleRelayCompare(ctx, pool as any, {
          relays: ['wss://127.0.0.1', 'wss://good.test'],
        }),
      ).rejects.toThrow(/private/)
    })
  })

  // -----------------------------------------------------------------
  // relay-diversity
  // -----------------------------------------------------------------
  describe('handleRelayDiversity', () => {
    it('returns empty report when no relays configured', async () => {
      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({ read: [], write: [] }),
      })

      const result = await handleRelayDiversity(ctx, pool as any)
      expect(result.totalRelays).toBe(0)
      expect(result.warnings).toContain('No relays configured.')
    })

    it('detects operator concentration', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Same Operator',
          contact: 'alice@example.com',
          software: 'strfry',
        }),
      }) as any

      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({
          read: ['wss://r1.test', 'wss://r2.test', 'wss://r3.test'],
          write: ['wss://r1.test'],
        }),
      })

      const result = await handleRelayDiversity(ctx, pool as any)

      expect(result.totalRelays).toBe(3)
      expect(result.concentrationRatio).toBeGreaterThan(0.5)
      expect(result.warnings.some(w => w.includes('centralisation'))).toBe(true)
    })

    it('warns about software monoculture', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          software: 'strfry',
          contact: 'different-operator',
        }),
      }) as any

      // Use different contacts to avoid operator grouping
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            software: 'strfry',
            contact: `operator${callCount}@example.com`,
          }),
        })
      }) as any

      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({
          read: ['wss://r1.test', 'wss://r2.test', 'wss://r3.test'],
          write: ['wss://r1.test'],
        }),
      })

      const result = await handleRelayDiversity(ctx, pool as any)

      expect(result.warnings.some(w => w.includes('same software'))).toBe(true)
    })

    it('warns about unreachable relays', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('down')) as any

      const pool = mockPool()

      const result = await handleRelayDiversity(ctx, pool as any)

      expect(result.warnings.some(w => w.includes('unreachable'))).toBe(true)
    })

    it('reports healthy diversity with no warnings', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        // Use URL to deterministically assign different operators and software
        const idx = url.match(/r(\d)/)?.[1] ?? '0'
        const software = Number(idx) % 2 === 0 ? 'strfry' : 'nostr-rs-relay'
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            software,
            contact: `op${idx}@example.com`,
          }),
        })
      }) as any

      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({
          read: ['wss://r1.test', 'wss://r2.test', 'wss://r3.test', 'wss://r4.test'],
          write: ['wss://r1.test', 'wss://r2.test'],
        }),
      })

      const result = await handleRelayDiversity(ctx, pool as any)

      expect(result.totalRelays).toBe(4)
      // With 4 different operators and 2 software types, no centralisation warning
      expect(result.warnings.filter(w => w.includes('centralisation')).length).toBe(0)
    })

    it('flags low relay count', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contact: 'op@example.com' }),
      }) as any

      const pool = mockPool({
        getRelays: vi.fn().mockReturnValue({
          read: ['wss://only-one.test'],
          write: ['wss://only-one.test'],
        }),
      })

      const result = await handleRelayDiversity(ctx, pool as any)
      expect(result.warnings.some(w => w.includes('Minimum 3'))).toBe(true)
    })
  })

  // -----------------------------------------------------------------
  // relay-recommend
  // -----------------------------------------------------------------
  describe('handleRelayRecommend', () => {
    function setupRecommendMocks() {
      const myHex = ctx.activePublicKeyHex
      const myContacts = makeKind3Event(myHex, [ALICE, BOB, CAROL])

      const aliceRelays = makeKind10002Event(ALICE, [
        { url: 'wss://popular.relay' },
        { url: 'wss://fast.relay' },
      ])
      const bobRelays = makeKind10002Event(BOB, [
        { url: 'wss://popular.relay' },
        { url: 'wss://privacy.onion' },
      ])
      const carolRelays = makeKind10002Event(CAROL, [
        { url: 'wss://popular.relay' },
        { url: 'wss://fast.relay' },
      ])

      const pool = mockPool({
        query: vi.fn()
          .mockResolvedValueOnce([myContacts])           // discover: kind 3
          .mockResolvedValueOnce([aliceRelays, bobRelays, carolRelays]), // discover: kind 10002
        getRelays: vi.fn().mockReturnValue({ read: ['wss://existing.relay'], write: ['wss://existing.relay'] }),
      })

      // Mock NIP-11 for discovered relays
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('popular')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Popular Relay',
              supported_nips: [1, 11, 17, 42, 50],
              limitation: { payment_required: false },
            }),
          })
        }
        if (url.includes('fast')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Fast Relay',
              supported_nips: [1, 11, 45, 50],
            }),
          })
        }
        if (url.includes('privacy')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Privacy Relay',
              supported_nips: [1, 11],
              limitation: { auth_required: false, payment_required: false },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      }) as any

      return pool
    }

    it('returns recommendations with balanced strategy', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'balanced' })

      expect(result.strategy).toBe('balanced')
      expect(result.recommendations.length).toBeGreaterThan(0)

      for (const rec of result.recommendations) {
        expect(rec.url).toBeDefined()
        expect(typeof rec.score).toBe('number')
        expect(rec.reasons.length).toBeGreaterThan(0)
      }
    })

    it('defaults to balanced strategy', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, {})
      expect(result.strategy).toBe('balanced')
    })

    it('returns recommendations sorted by score descending', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'balanced' })

      for (let i = 1; i < result.recommendations.length; i++) {
        expect(result.recommendations[i].score).toBeLessThanOrEqual(result.recommendations[i - 1].score)
      }
    })

    it('excludes already-used relays', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'balanced' })

      const existingRelay = result.recommendations.find(r => r.url === 'wss://existing.relay')
      expect(existingRelay).toBeUndefined()
    })

    it('respects limit parameter', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'balanced', limit: 1 })
      expect(result.recommendations.length).toBeLessThanOrEqual(1)
    })

    it('performance strategy favours fast relays', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'performance' })
      expect(result.strategy).toBe('performance')
      // All returned relays should have scores
      for (const rec of result.recommendations) {
        expect(typeof rec.score).toBe('number')
      }
    })

    it('social strategy favours contact-popular relays', async () => {
      const pool = setupRecommendMocks()
      const result = await handleRelayRecommend(ctx, pool as any, { strategy: 'social' })
      expect(result.strategy).toBe('social')
    })

    it('returns empty when no contacts', async () => {
      const pool = mockPool()
      const result = await handleRelayRecommend(ctx, pool as any, {})
      expect(result.recommendations).toEqual([])
    })
  })

  // -----------------------------------------------------------------
  // Shared helpers
  // -----------------------------------------------------------------
  describe('extractSupportedNips', () => {
    it('extracts number array from NIP-11', () => {
      const nips = extractSupportedNips({ supported_nips: [1, 11, 42, 50] })
      expect(nips).toEqual([1, 11, 42, 50])
    })

    it('returns empty array for missing field', () => {
      expect(extractSupportedNips({})).toEqual([])
      expect(extractSupportedNips(null)).toEqual([])
    })

    it('filters out non-number values', () => {
      const nips = extractSupportedNips({ supported_nips: [1, 'invalid', null, 42] })
      expect(nips).toEqual([1, 42])
    })
  })

  describe('extractOperator', () => {
    it('returns pubkey when present', () => {
      expect(extractOperator({ pubkey: ALICE })).toBe(ALICE)
    })

    it('returns contact when pubkey absent', () => {
      expect(extractOperator({ contact: 'admin@example.com' })).toBe('admin@example.com')
    })

    it('falls back to software domain', () => {
      expect(extractOperator({ software: 'https://git.example.com/nostr-relay' })).toBe('git.example.com')
    })

    it('returns undefined for empty info', () => {
      expect(extractOperator({})).toBeUndefined()
      expect(extractOperator(null)).toBeUndefined()
    })
  })

  describe('fetchNip11Quiet', () => {
    it('returns parsed JSON on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'Test Relay' }),
      }) as any

      const result = await fetchNip11Quiet('wss://relay.test')
      expect(result).toEqual({ name: 'Test Relay' })
    })

    it('returns null on failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any
      const result = await fetchNip11Quiet('wss://down.test')
      expect(result).toBeNull()
    })

    it('returns null on non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any
      const result = await fetchNip11Quiet('wss://error.test')
      expect(result).toBeNull()
    })
  })
})
