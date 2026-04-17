import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleRelayList,
  handleRelaySet,
  handleRelayAdd,
  handleRelayInfo,
  handleRelayQuery,
} from '../../src/relay/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    queryDirect: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    reconfigure: vi.fn(),
    checkSharedRelays: vi.fn().mockReturnValue([]),
  }
}

describe('relay handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleRelayList', () => {
    it('returns relay list for active identity', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
      const pool = mockPool()
      const result = await handleRelayList(ctx, pool as any)
      expect(result.read).toBeDefined()
      expect(result.write).toBeDefined()
      vi.unstubAllGlobals()
    })

    it('warns if two personas share relays', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
      const pool = mockPool()
      pool.checkSharedRelays = vi.fn().mockReturnValue(['wss://shared.example.com'])
      await ctx.derive('alt', 0)
      await ctx.switch('alt', 0)
      const altNpub = ctx.activeNpub
      await ctx.switch('master')
      const result = await handleRelayList(ctx, pool as any, altNpub)
      expect(result.sharedWarning).toBeDefined()
      expect(result.sharedWarning).toContain('wss://shared.example.com')
      vi.unstubAllGlobals()
    })

    it('includes health array with reachability for each relay', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', mockFetch)
      const pool = mockPool()
      const result = await handleRelayList(ctx, pool as any)
      expect(result.health).toBeDefined()
      expect(Array.isArray(result.health)).toBe(true)
      expect(result.health!.length).toBeGreaterThan(0)
      for (const entry of result.health!) {
        expect(entry.url).toBeDefined()
        expect(typeof entry.reachable).toBe('boolean')
        expect(typeof entry.responseTime).toBe('number')
      }
      vi.unstubAllGlobals()
    })

    it('marks unreachable relays when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
      const pool = mockPool()
      const result = await handleRelayList(ctx, pool as any)
      expect(result.health).toBeDefined()
      for (const entry of result.health!) {
        expect(entry.reachable).toBe(false)
        expect(entry.responseTime).toBe(-1)
      }
      vi.unstubAllGlobals()
    })

    it('deduplicates relay URLs across read and write', async () => {
      const sharedRelay = 'wss://shared.example.com'
      const pool = {
        ...mockPool(),
        getRelays: vi.fn().mockReturnValue({ read: [sharedRelay], write: [sharedRelay] }),
        checkSharedRelays: vi.fn().mockReturnValue([]),
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
      const result = await handleRelayList(ctx, pool as any)
      const urls = result.health!.map(h => h.url)
      expect(urls.filter(u => u === sharedRelay).length).toBe(1)
      vi.unstubAllGlobals()
    })
  })

  describe('handleRelaySet', () => {
    it('publishes kind 10002', async () => {
      const pool = mockPool()
      const result = await handleRelaySet(ctx, pool as any, {
        relays: [
          { url: 'wss://r1.example.com', mode: 'read' },
          { url: 'wss://w1.example.com', mode: 'write' },
          { url: 'wss://both.example.com' },
        ],
      })
      expect(result.event.kind).toBe(10002)
      const rTags = result.event.tags.filter((t: string[]) => t[0] === 'r')
      expect(rTags.length).toBe(3)
    })

    it('warns when overwriting existing relay list', async () => {
      const existing = {
        kind: 10002,
        pubkey: 'pub1',
        created_at: 1000,
        tags: [['r', 'wss://old.example.com']],
        content: '',
        id: 'rl1',
        sig: 'sig1',
      }
      const pool = mockPool([existing])
      const result = await handleRelaySet(ctx, pool as any, {
        relays: [{ url: 'wss://new.example.com' }],
        confirm: false,
      })
      expect(result.published).toBe(false)
      expect(result.warning).toMatch(/exists/i)
    })
  })

  describe('handleRelayAdd', () => {
    it('adds a relay to the active list', () => {
      const pool = mockPool()
      const result = handleRelayAdd(ctx, pool as any, {
        url: 'wss://new.example.com',
        mode: 'read',
      })
      expect(result.reconfigured).toBe(true)
    })
  })

  describe('handleRelayQuery', () => {
    it('queries with kinds filter via identity relays', async () => {
      const pool = mockPool()
      const events = await handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [30301],
        limit: 10,
      })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({ kinds: [30301], limit: 10 }),
      )
    })

    it('queries explicit relays via queryDirect', async () => {
      const pool = mockPool()
      await handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [30301],
        relays: ['wss://relay.damus.io'],
      })
      expect(pool.queryDirect).toHaveBeenCalledWith(
        ['wss://relay.damus.io'],
        expect.objectContaining({ kinds: [30301] }),
      )
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('maps tag filters with # prefix', async () => {
      const pool = mockPool()
      await handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [31000],
        tags: { '#p': ['abc123'], d: ['credential'] },
      })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({
          kinds: [31000],
          '#p': ['abc123'],
          '#d': ['credential'],
        }),
      )
    })

    it('defaults limit to 50', async () => {
      const pool = mockPool()
      await handleRelayQuery(pool as any, ctx.activeNpub, { kinds: [1] })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({ limit: 50 }),
      )
    })

    it('rejects private relay URLs', async () => {
      const pool = mockPool()
      await expect(handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [1],
        relays: ['wss://127.0.0.1'],
      })).rejects.toThrow(/private/)
    })

    it('adds NIP-50 search parameter to filter', async () => {
      const pool = mockPool()
      await handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [1],
        search: 'hello world',
      })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({ search: 'hello world' }),
      )
    })
  })

  describe('handleRelayInfo', () => {
    it('converts wss:// to https:// for NIP-11 fetch', async () => {
      const jsonBody = JSON.stringify({ name: 'Test Relay', description: 'A test relay' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/nostr+json' }),
        text: () => Promise.resolve(jsonBody),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await handleRelayInfo('wss://relay.example.com')
      expect(result.name).toBe('Test Relay')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://relay.example.com',
        expect.objectContaining({ headers: { Accept: 'application/nostr+json' } }),
      )

      vi.unstubAllGlobals()
    })

    it('throws on non-OK response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
      await expect(handleRelayInfo('wss://bad.example.com')).rejects.toThrow(/404/)
      vi.unstubAllGlobals()
    })

    it('rejects responses with wrong Content-Type before parsing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: () => Promise.resolve('<html>not json</html>'),
      })
      vi.stubGlobal('fetch', mockFetch)
      await expect(handleRelayInfo('wss://relay.example.com')).rejects.toThrow(/Content-Type/)
      vi.unstubAllGlobals()
    })

    it('accepts application/json content-type with parameters', async () => {
      const jsonBody = JSON.stringify({ name: 'Permissive Relay' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        text: () => Promise.resolve(jsonBody),
      })
      vi.stubGlobal('fetch', mockFetch)
      const result = await handleRelayInfo('wss://relay.example.com')
      expect(result.name).toBe('Permissive Relay')
      vi.unstubAllGlobals()
    })

    it('rejects non-wss URLs (SSRF protection)', async () => {
      await expect(handleRelayInfo('https://evil.com')).rejects.toThrow(/wss:\/\//)
    })

    it('rejects private network addresses', async () => {
      await expect(handleRelayInfo('wss://127.0.0.1')).rejects.toThrow(/private/)
      await expect(handleRelayInfo('wss://169.254.169.254')).rejects.toThrow(/private/)
    })
  })
})
