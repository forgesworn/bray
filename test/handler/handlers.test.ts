import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { IdentityContext } from '../../src/context.js'
import {
  handleHandlerPublish,
  handleHandlerDiscover,
} from '../../src/handler/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
  }
}

/** Build a fake kind 31990 event with mcp transport tags */
function fakeHandlerEvent(overrides: {
  pubkey?: string
  name?: string
  about?: string
  kinds?: string[]
  stdio?: string
  httpUrl?: string
  dTag?: string
  picture?: string
} = {}) {
  const pubkey = overrides.pubkey ?? getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
  const dTag = overrides.dTag ?? 'test-handler'
  const kinds = overrides.kinds ?? ['1', '31402']
  const tags: string[][] = [
    ['d', dTag],
    ...kinds.map(k => ['k', k]),
    ['alt', `MCP handler for kind ${kinds.join(', ')}`],
  ]
  if (overrides.stdio ?? 'npx test-handler') {
    tags.push(['mcp', overrides.stdio ?? 'npx test-handler', 'stdio'])
  }
  if (overrides.httpUrl) {
    tags.push(['mcp', overrides.httpUrl, 'http'])
  }

  const contentObj: Record<string, string> = {
    name: overrides.name ?? 'Test Handler',
    about: overrides.about ?? 'A test MCP handler',
  }
  if (overrides.picture) contentObj.picture = overrides.picture

  return {
    id: 'abc123',
    pubkey,
    kind: 31990,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(contentObj),
    sig: 'fakesig',
  }
}

describe('handler tool handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // -------------------------------------------------------------------------
  // handleHandlerPublish
  // -------------------------------------------------------------------------
  describe('handleHandlerPublish', () => {
    it('creates a kind 31990 event with correct structure', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'nostr-bray',
        about: 'Sovereign Nostr identity MCP server',
        kinds: ['1', '6', '31990'],
        stdioCommand: 'npx nostr-bray',
      })

      expect(result.event.kind).toBe(31990)
      expect(result.publish.success).toBe(true)
    })

    it('sets d-tag from slugified name by default', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'My Cool Handler',
        about: 'Does things',
        kinds: ['1'],
        stdioCommand: 'npx my-cool-handler',
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toBe('my-cool-handler')
    })

    it('uses custom d_tag when provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'nostr-bray',
        about: 'MCP server',
        kinds: ['1'],
        stdioCommand: 'npx nostr-bray',
        dTag: 'custom-bray',
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toBe('custom-bray')
    })

    it('adds k-tags for each supported kind', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Multi-kind handler',
        kinds: ['1', '6', '31402'],
        stdioCommand: 'npx handler',
      })

      const kTags = result.event.tags.filter((t: string[]) => t[0] === 'k')
      const kValues = kTags.map((t: string[]) => t[1])
      expect(kValues).toContain('1')
      expect(kValues).toContain('6')
      expect(kValues).toContain('31402')
    })

    it('adds alt tag summarising supported kinds', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1', '31402'],
        stdioCommand: 'npx handler',
      })

      const altTag = result.event.tags.find((t: string[]) => t[0] === 'alt')
      expect(altTag).toBeDefined()
      expect(altTag![1]).toContain('1')
      expect(altTag![1]).toContain('31402')
    })

    it('adds stdio mcp tag when stdioCommand provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1'],
        stdioCommand: 'npx my-handler',
      })

      const mcpTags = result.event.tags.filter((t: string[]) => t[0] === 'mcp')
      const stdioTag = mcpTags.find((t: string[]) => t[2] === 'stdio')
      expect(stdioTag).toBeDefined()
      expect(stdioTag![1]).toBe('npx my-handler')
    })

    it('adds http mcp tag when httpUrl provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1'],
        httpUrl: 'https://mcp.example.com/sse',
      })

      const mcpTags = result.event.tags.filter((t: string[]) => t[0] === 'mcp')
      const httpTag = mcpTags.find((t: string[]) => t[2] === 'http')
      expect(httpTag).toBeDefined()
      expect(httpTag![1]).toBe('https://mcp.example.com/sse')
    })

    it('adds both stdio and http mcp tags when both provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1'],
        stdioCommand: 'npx handler',
        httpUrl: 'https://mcp.example.com/sse',
      })

      const mcpTags = result.event.tags.filter((t: string[]) => t[0] === 'mcp')
      expect(mcpTags).toHaveLength(2)
      const transports = mcpTags.map((t: string[]) => t[2])
      expect(transports).toContain('stdio')
      expect(transports).toContain('http')
    })

    it('throws when neither stdioCommand nor httpUrl provided', async () => {
      const pool = mockPool()
      await expect(
        handleHandlerPublish(ctx, pool as any, {
          name: 'handler',
          about: 'Handler',
          kinds: ['1'],
        }),
      ).rejects.toThrow('At least one of stdioCommand or httpUrl must be provided.')
    })

    it('includes name and about in content JSON', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: '402-mcp',
        about: 'L402 payment handler',
        kinds: ['31402'],
        stdioCommand: 'npx 402-mcp',
      })

      const content = JSON.parse(result.event.content)
      expect(content.name).toBe('402-mcp')
      expect(content.about).toBe('L402 payment handler')
    })

    it('includes picture in content JSON when provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1'],
        stdioCommand: 'npx handler',
        picture: 'https://example.com/icon.png',
      })

      const content = JSON.parse(result.event.content)
      expect(content.picture).toBe('https://example.com/icon.png')
    })

    it('omits picture from content when not provided', async () => {
      const pool = mockPool()
      const result = await handleHandlerPublish(ctx, pool as any, {
        name: 'handler',
        about: 'Handler',
        kinds: ['1'],
        stdioCommand: 'npx handler',
      })

      const content = JSON.parse(result.event.content)
      expect(content.picture).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // handleHandlerDiscover
  // -------------------------------------------------------------------------
  describe('handleHandlerDiscover', () => {
    it('queries for kind 31990 events without kind filter', async () => {
      const events = [fakeHandlerEvent()]
      const pool = mockPool(events)

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        limit: 20,
      })
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Test Handler')
    })

    it('adds #k filter when kind provided', async () => {
      const pool = mockPool([])

      await handleHandlerDiscover(pool as any, 'npub1test', { kind: '31402' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        '#k': ['31402'],
        limit: 20,
      })
    })

    it('respects custom limit', async () => {
      const pool = mockPool([])

      await handleHandlerDiscover(pool as any, 'npub1test', { limit: 5 })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        limit: 5,
      })
    })

    it('filters out events with no mcp tags', async () => {
      const noMcpEvent = {
        id: 'no-mcp',
        pubkey: getPublicKey(Buffer.from('02'.repeat(32), 'hex')),
        kind: 31990,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', 'dispatch-agent'], ['k', '14'], ['t', 'dispatch']],
        content: JSON.stringify({ name: 'Dispatch Agent', about: 'No MCP', protocol: 'dispatch-v1' }),
        sig: 'fakesig',
      }
      const pool = mockPool([noMcpEvent])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result).toHaveLength(0)
    })

    it('skips events with invalid JSON content', async () => {
      const badEvent = {
        ...fakeHandlerEvent(),
        content: 'not valid json',
      }
      const pool = mockPool([badEvent])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result).toHaveLength(0)
    })

    it('parses kinds from k-tags', async () => {
      const event = fakeHandlerEvent({ kinds: ['1', '6', '31402'] })
      const pool = mockPool([event])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result[0].kinds).toEqual(['1', '6', '31402'])
    })

    it('parses transports from mcp tags', async () => {
      const event = fakeHandlerEvent({
        stdio: 'npx test-handler',
        httpUrl: 'https://mcp.example.com/sse',
      })
      // Add http tag to event
      event.tags.push(['mcp', 'https://mcp.example.com/sse', 'http'])
      const pool = mockPool([event])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      const transports = result[0].transports
      expect(transports.some(t => t.transport === 'stdio')).toBe(true)
      expect(transports.some(t => t.transport === 'http')).toBe(true)
      expect(transports.find(t => t.transport === 'http')?.endpoint).toBe('https://mcp.example.com/sse')
    })

    it('returns pubkey on parsed card', async () => {
      const pubkey = getPublicKey(Buffer.from('04'.repeat(32), 'hex'))
      const event = fakeHandlerEvent({ pubkey })
      const pool = mockPool([event])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result[0].pubkey).toBe(pubkey)
    })

    it('returns dTag on parsed card', async () => {
      const event = fakeHandlerEvent({ dTag: 'my-handler' })
      const pool = mockPool([event])

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result[0].dTag).toBe('my-handler')
    })

    it('returns multiple handlers', async () => {
      const events = [
        fakeHandlerEvent({ name: 'Handler A', dTag: 'handler-a' }),
        fakeHandlerEvent({ name: 'Handler B', dTag: 'handler-b' }),
      ]
      const pool = mockPool(events)

      const result = await handleHandlerDiscover(pool as any, 'npub1test', {})
      expect(result).toHaveLength(2)
      const names = result.map(r => r.name)
      expect(names).toContain('Handler A')
      expect(names).toContain('Handler B')
    })
  })
})
