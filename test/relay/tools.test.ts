import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Filter } from 'nostr-tools'
import { registerRelayTools } from '../../src/relay/tools.js'
import { ActionCatalog, createCatalogProxy } from '../../src/catalog.js'

/**
 * Regression tests for the relay-query MCP tool.
 *
 * Root cause (fixed): the MCP SDK normalises a tool's inputSchema into a strict
 * zod object schema with default strip behaviour, so any unknown top-level keys
 * are silently removed before the handler sees them. Several MCP clients reach
 * naturally for a single nested "filter" object when calling relay-query
 * (matching how nostr REQ frames are shaped), but the tool only exposed
 * top-level parameters. The whole filter was dropped and the handler defaulted
 * to a limit-only query, returning a firehose of events regardless of the
 * author, kind, or id the caller asked for.
 *
 * The fix accepts both shapes:
 *   1. top-level arguments (canonical)
 *   2. a single "filter" object (alias, merged with top-level)
 * and adds the previously missing "ids" field to the schema.
 */
describe('relay-query filter forwarding', () => {
  let server: McpServer
  let client: Client
  let capturedFilter: Filter | undefined
  let capturedRelays: string[] | undefined
  let capturedMode: 'query' | 'queryDirect' | undefined

  // Minimal RelayPool mock that records the filter the handler actually asks
  // the pool to query with. The handler path is the thing under test; the pool
  // internals themselves are exercised elsewhere.
  const mockPool = {
    query: async (_npub: string, filter: Filter) => {
      capturedFilter = filter
      capturedRelays = undefined
      capturedMode = 'query'
      return []
    },
    queryDirect: async (relays: string[], filter: Filter) => {
      capturedFilter = filter
      capturedRelays = relays
      capturedMode = 'queryDirect'
      return []
    },
    getRelays: () => ({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    publish: async () => ({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    reconfigure: () => {},
    checkSharedRelays: () => [],
  }

  const mockCtx = {
    activeNpub: 'npub1testtesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    activePublicKeyHex: 'f'.repeat(64),
    getSigningFunction: () => async () => { throw new Error('not used in this test') },
    listIdentities: async () => [],
    nip44Encrypt: async () => '',
    nip44Decrypt: async () => '',
    destroy: () => {},
  }

  beforeAll(async () => {
    server = new McpServer({ name: 'relay-query-test', version: '0.0.0' }, {})

    registerRelayTools(server, {
      ctx: mockCtx as any,
      pool: mockPool as any,
      nip65: {} as any,
      walletsFile: '/tmp/ignore',
    } as any)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'relay-query-test-client', version: '0.0.0' })
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ])
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(() => {
    capturedFilter = undefined
    capturedRelays = undefined
    capturedMode = undefined
  })

  const AUTHOR_A = 'f9cc7a88e4da20428331068321e40855fcf510bf801c9e63b12867a467063bb6'
  const EVENT_ID_1 = '6f9947edb62afcab91c6326f92ebb8da8b318015681a7cc00d31fd57f7a8f59c'
  const EVENT_ID_2 = 'f0c902371ae547c5310bd72d010fb7e54b7c25839b13261b7d375ce0d7a10d88'

  it('forwards top-level kinds and authors to the pool query (canonical)', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        kinds: [1],
        authors: [AUTHOR_A],
        limit: 50,
      },
    })
    expect(capturedMode).toBe('query')
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
    expect(capturedFilter!.limit).toBe(50)
  })

  it('forwards a nested "filter" object alias (the shape that used to be silently stripped)', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        filter: {
          kinds: [1],
          authors: [AUTHOR_A],
          limit: 50,
        },
      },
    })
    expect(capturedMode).toBe('query')
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
    expect(capturedFilter!.limit).toBe(50)
  })

  it('forwards kind 31402 + author via nested filter (regression for marketplace case)', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        filter: {
          kinds: [31402],
          authors: [AUTHOR_A],
        },
      },
    })
    expect(capturedFilter!.kinds).toEqual([31402])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })

  it('forwards "ids" via nested filter (previously missing from the schema entirely)', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        filter: {
          ids: [EVENT_ID_1, EVENT_ID_2],
        },
      },
    })
    expect(capturedFilter!.ids).toEqual([EVENT_ID_1, EVENT_ID_2])
  })

  it('forwards "ids" as a top-level argument', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        ids: [EVENT_ID_1, EVENT_ID_2],
      },
    })
    expect(capturedFilter!.ids).toEqual([EVENT_ID_1, EVENT_ID_2])
  })

  it('prefers top-level fields over the nested filter on conflict', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        kinds: [7],
        filter: {
          kinds: [1],
          authors: [AUTHOR_A],
        },
      },
    })
    // Top-level wins on the conflicting field, and non-conflicting fields from
    // the nested object still come through.
    expect(capturedFilter!.kinds).toEqual([7])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })

  it('forwards tag filters via nested filter', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        filter: {
          kinds: [31000],
          tags: { '#p': [AUTHOR_A] },
        },
      },
    })
    expect(capturedFilter!.kinds).toEqual([31000])
    expect((capturedFilter as any)['#p']).toEqual([AUTHOR_A])
  })

  it('defaults limit to 50 when neither shape supplies one', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: { filter: { kinds: [1] } },
    })
    expect(capturedFilter!.limit).toBe(50)
  })

  it('routes to queryDirect when explicit relays are provided', async () => {
    await client.callTool({
      name: 'relay-query',
      arguments: {
        filter: { kinds: [1], authors: [AUTHOR_A] },
        relays: ['wss://relay.damus.io'],
      },
    })
    expect(capturedMode).toBe('queryDirect')
    expect(capturedRelays).toEqual(['wss://relay.damus.io'])
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })
})

/**
 * Regression tests for the relay-count MCP tool.
 *
 * Same root cause as relay-query: the tool declared NIP-01 filter fields at the
 * top level but real clients wrap them in a single `filter` object. The MCP SDK
 * silently stripped the wrapper, leaving the handler to assemble an empty
 * filter and send COUNT with no selector (returning relay-wide totals).
 *
 * relay-count is catalog-routed, so it is stripped twice: once by the SDK at
 * the `execute-action` boundary, and a second time by the ActionCatalog's
 * inner `z.object(entry.inputSchema).safeParse()`. The regression tests below
 * exercise both paths: a direct-register path (outer SDK strip only) and a
 * catalog-routed path via execute-action (both strips).
 *
 * The WebSocket layer is stubbed to error immediately so count.ts falls through
 * to the poolQuery fallback, which lets us capture the filter that ends up on
 * the wire.
 */
describe('relay-count filter forwarding', () => {
  let server: McpServer
  let client: Client
  let capturedFilter: Record<string, unknown> | undefined

  const mockPool = {
    query: async () => [],
    queryDirect: async (_relays: string[], filter: Filter) => {
      // count.ts wraps the filter with { ...filter, limit: 1000 } for the
      // fallback path. Strip `limit` before asserting so the tests focus on
      // the filter fields under test.
      const { limit: _ignored, ...rest } = filter as Record<string, unknown>
      capturedFilter = rest
      return []
    },
    getRelays: () => ({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    publish: async () => ({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    reconfigure: () => {},
    checkSharedRelays: () => [],
  }

  const mockCtx = {
    activeNpub: 'npub1testtesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    activePublicKeyHex: 'f'.repeat(64),
    getSigningFunction: () => async () => { throw new Error('not used') },
    listIdentities: async () => [],
    nip44Encrypt: async () => '',
    nip44Decrypt: async () => '',
    destroy: () => {},
  }

  beforeAll(async () => {
    // Stub WebSocket to error fast so count.ts falls through to the fallback.
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 5)
      }
    })

    server = new McpServer({ name: 'relay-count-test', version: '0.0.0' }, {})
    registerRelayTools(server, {
      ctx: mockCtx as any,
      pool: mockPool as any,
      nip65: {} as any,
      walletsFile: '/tmp/ignore',
    } as any)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'relay-count-test-client', version: '0.0.0' })
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ])
  })

  afterAll(async () => {
    await client.close()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    capturedFilter = undefined
  })

  const AUTHOR_A = 'f9cc7a88e4da20428331068321e40855fcf510bf801c9e63b12867a467063bb6'
  const EVENT_ID_1 = '6f9947edb62afcab91c6326f92ebb8da8b318015681a7cc00d31fd57f7a8f59c'

  it('forwards top-level kinds and authors to the underlying count (canonical)', async () => {
    await client.callTool({
      name: 'relay-count',
      arguments: {
        relays: ['wss://relay.example.com'],
        kinds: [1],
        authors: [AUTHOR_A],
      },
    })
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })

  it('forwards a nested "filter" object alias (the shape that used to be silently stripped)', async () => {
    await client.callTool({
      name: 'relay-count',
      arguments: {
        relays: ['wss://relay.example.com'],
        filter: { kinds: [1], authors: [AUTHOR_A] },
      },
    })
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })

  it('forwards "ids" via nested filter (previously missing from the schema)', async () => {
    await client.callTool({
      name: 'relay-count',
      arguments: {
        relays: ['wss://relay.example.com'],
        filter: { ids: [EVENT_ID_1] },
      },
    })
    expect(capturedFilter!.ids).toEqual([EVENT_ID_1])
  })

  it('forwards tag filters via nested filter', async () => {
    await client.callTool({
      name: 'relay-count',
      arguments: {
        relays: ['wss://relay.example.com'],
        filter: {
          kinds: [31000],
          tags: { '#p': [AUTHOR_A] },
        },
      },
    })
    expect(capturedFilter!.kinds).toEqual([31000])
    expect(capturedFilter!['#p']).toEqual([AUTHOR_A])
  })

  it('top-level fields win over nested filter on conflict', async () => {
    await client.callTool({
      name: 'relay-count',
      arguments: {
        relays: ['wss://relay.example.com'],
        kinds: [7],
        filter: { kinds: [1], authors: [AUTHOR_A] },
      },
    })
    expect(capturedFilter!.kinds).toEqual([7])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })
})

/**
 * Catalog-path regression: relay-count is not in the PROMOTED set, so it is
 * served via `execute-action`. That path strips args twice -- once at the
 * SDK's execute-action schema boundary, and again at
 * `ActionCatalog.execute -> z.object(entry.inputSchema).safeParse(params)`.
 * The helper-produced schema must survive both strips, and the `filter`
 * wrapper must still reach the handler.
 */
describe('relay-count via execute-action (catalog inner strip)', () => {
  let server: McpServer
  let client: Client
  let capturedFilter: Record<string, unknown> | undefined

  const mockPool = {
    query: async () => [],
    queryDirect: async (_relays: string[], filter: Filter) => {
      const { limit: _ignored, ...rest } = filter as Record<string, unknown>
      capturedFilter = rest
      return []
    },
    getRelays: () => ({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    publish: async () => ({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    reconfigure: () => {},
    checkSharedRelays: () => [],
  }

  const mockCtx = {
    activeNpub: 'npub1testtesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    activePublicKeyHex: 'f'.repeat(64),
    getSigningFunction: () => async () => { throw new Error('not used') },
    listIdentities: async () => [],
    nip44Encrypt: async () => '',
    nip44Decrypt: async () => '',
    destroy: () => {},
  }

  beforeAll(async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 5)
      }
    })

    server = new McpServer({ name: 'relay-count-cat-test', version: '0.0.0' }, {})
    const catalog = new ActionCatalog()
    const proxy = createCatalogProxy(server, catalog, new Set()) // nothing promoted
    registerRelayTools(proxy, {
      ctx: mockCtx as any,
      pool: mockPool as any,
      nip65: {} as any,
      walletsFile: '/tmp/ignore',
    } as any)
    catalog.registerMetaTools(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'relay-count-cat-test-client', version: '0.0.0' })
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ])
  })

  afterAll(async () => {
    await client.close()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    capturedFilter = undefined
  })

  const AUTHOR_A = 'f9cc7a88e4da20428331068321e40855fcf510bf801c9e63b12867a467063bb6'

  it('survives both strips with a nested filter wrapper', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'relay-count',
        params: {
          relays: ['wss://relay.example.com'],
          filter: { kinds: [1], authors: [AUTHOR_A] },
        },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })
})
