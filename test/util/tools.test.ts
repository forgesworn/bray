import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Filter } from 'nostr-tools'
import { registerUtilTools } from '../../src/util/tools.js'
import { ActionCatalog, createCatalogProxy } from '../../src/catalog.js'

/**
 * Regression tests for the util `count` MCP tool.
 *
 * Root cause (fixed): same class of bug as relay-query and relay-count. The
 * schema declared three flat filter fields (`kinds`, `authors`, `since`) with
 * no `filter` wrapper alias and no `ids`/`tags`/`until`/`limit`/`search`. MCP
 * clients that wrapped the filter in a single object, as they would for any
 * other NIP-01 filter-shaped tool, had the wrapper silently stripped and the
 * handler ran against an empty filter.
 *
 * `count` is catalog-routed, so the fix has to survive both the SDK's
 * execute-action strip and the ActionCatalog's inner
 * `z.object(inputSchema).safeParse()` strip. These tests exercise the full
 * `execute-action` path to pin that contract.
 */
describe('util count filter forwarding (catalog-routed)', () => {
  let server: McpServer
  let client: Client
  let capturedFilter: Filter | undefined

  const mockPool = {
    query: async (_npub: string, filter: Filter) => {
      capturedFilter = filter
      return []
    },
    queryDirect: async () => [],
    getRelays: () => ({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    publish: async () => ({ success: true, accepted: [], rejected: [], errors: [] }),
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
    server = new McpServer({ name: 'util-count-test', version: '0.0.0' }, {})
    const catalog = new ActionCatalog()
    const proxy = createCatalogProxy(server, catalog, new Set())
    registerUtilTools(proxy, {
      ctx: mockCtx as any,
      pool: mockPool as any,
      nip65: {} as any,
      walletsFile: '/tmp/ignore',
    } as any)
    catalog.registerMetaTools(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'util-count-test-client', version: '0.0.0' })
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
  })

  const AUTHOR_A = 'f9cc7a88e4da20428331068321e40855fcf510bf801c9e63b12867a467063bb6'
  const EVENT_ID_1 = '6f9947edb62afcab91c6326f92ebb8da8b318015681a7cc00d31fd57f7a8f59c'

  it('forwards top-level kinds and authors to the underlying pool query (canonical)', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'count',
        params: {
          kinds: [1],
          authors: [AUTHOR_A],
        },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedFilter).toBeDefined()
    expect(capturedFilter!.kinds).toEqual([1])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })

  it('forwards a nested "filter" object alias (the shape that used to be silently stripped)', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'count',
        params: {
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

  it('forwards "ids" via nested filter (previously missing from the schema)', async () => {
    await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'count',
        params: {
          filter: { ids: [EVENT_ID_1] },
        },
      },
    })
    expect(capturedFilter!.ids).toEqual([EVENT_ID_1])
  })

  it('forwards tag filters via nested filter', async () => {
    await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'count',
        params: {
          filter: {
            kinds: [31000],
            tags: { '#p': [AUTHOR_A] },
          },
        },
      },
    })
    expect(capturedFilter!.kinds).toEqual([31000])
    expect((capturedFilter as Record<string, unknown>)['#p']).toEqual([AUTHOR_A])
  })

  it('top-level fields win over nested filter on conflict', async () => {
    await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'count',
        params: {
          kinds: [7],
          filter: { kinds: [1], authors: [AUTHOR_A] },
        },
      },
    })
    expect(capturedFilter!.kinds).toEqual([7])
    expect(capturedFilter!.authors).toEqual([AUTHOR_A])
  })
})
