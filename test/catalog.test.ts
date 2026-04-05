import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ActionCatalog, createCatalogProxy } from '../src/catalog.js'
import { hexId } from '../src/validation.js'

/**
 * Regression tests for the execute-action meta-tool.
 *
 * Root cause (fixed): the MCP SDK normalises a tool's inputSchema into a strict
 * zod object schema, which silently strips any unknown top-level keys from the
 * caller's arguments. When a client sent `parameters` instead of `params` --
 * a natural alias that many LLM clients reach for -- the inner params object
 * was dropped, leaving the catalog dispatch with an empty `{}` and producing
 * spurious "expected string, received undefined" errors for any action with at
 * least one required field (contacts-follow, contacts-get, encode-npub,
 * nip05-lookup, and many more). Actions where every field was optional, such
 * as marketplace-discover, silently fell back to defaults, masking the bug.
 *
 * The fix declares `parameters` as an alias on the execute-action inputSchema
 * so both names survive MCP SDK validation and the handler forwards whichever
 * is present to the action's registered handler.
 */
describe('execute-action parameter forwarding', () => {
  let server: McpServer
  let client: Client
  let capturedArgs: Record<string, Record<string, unknown>>

  beforeAll(async () => {
    capturedArgs = {}

    server = new McpServer({ name: 'catalog-test', version: '0.0.0' }, {})
    const catalog = new ActionCatalog()
    const proxy = createCatalogProxy(server, catalog, new Set())

    // Register a handful of actions covering the failure modes:
    // 1. required hex field (contacts-follow)
    // 2. required plain string (nip05-lookup)
    // 3. single required hex field (encode-npub)
    // 4. all-optional fields (marketplace-discover) -- previously masked the bug
    proxy.registerTool('contacts-follow', {
      description: 'Follow a Nostr pubkey',
      inputSchema: {
        pubkeyHex: hexId.describe('Hex pubkey to follow'),
        relay: z.string().optional(),
        petname: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    }, async (args) => {
      capturedArgs['contacts-follow'] = args
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })

    proxy.registerTool('nip05-lookup', {
      description: 'Resolve a NIP-05 identifier',
      inputSchema: {
        identifier: z.string().describe('NIP-05 identifier'),
      },
    }, async (args) => {
      capturedArgs['nip05-lookup'] = args
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })

    proxy.registerTool('encode-npub', {
      description: 'Encode a hex pubkey as npub',
      inputSchema: {
        hex: hexId.describe('Hex public key'),
      },
    }, async (args) => {
      capturedArgs['encode-npub'] = args
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })

    proxy.registerTool('marketplace-discover', {
      description: 'Discover services',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
      },
    }, async (args) => {
      capturedArgs['marketplace-discover'] = args
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })

    catalog.registerMetaTools(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'catalog-test-client', version: '0.0.0' })
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ])
  })

  afterAll(async () => {
    await client.close()
  })

  const validHex = 'f9cc7a88e4da20428331068321e40855fcf510bf801c9e63b12867a467063bb6'

  it('forwards params to contacts-follow (canonical field name)', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'contacts-follow',
        params: { pubkeyHex: validHex },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['contacts-follow']).toEqual({
      pubkeyHex: validHex,
      relay: undefined,
      petname: undefined,
      confirm: undefined,
    })
  })

  it('forwards parameters to contacts-follow (alias field name)', async () => {
    capturedArgs['contacts-follow'] = {}
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'contacts-follow',
        parameters: { pubkeyHex: validHex },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['contacts-follow'].pubkeyHex).toEqual(validHex)
  })

  it('forwards params to nip05-lookup', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'nip05-lookup',
        params: { identifier: 'alice@example.com' },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['nip05-lookup']).toEqual({ identifier: 'alice@example.com' })
  })

  it('forwards parameters to nip05-lookup (alias)', async () => {
    capturedArgs['nip05-lookup'] = {}
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'nip05-lookup',
        parameters: { identifier: 'bob@example.com' },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['nip05-lookup']).toEqual({ identifier: 'bob@example.com' })
  })

  it('forwards params to encode-npub', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'encode-npub',
        params: { hex: validHex },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['encode-npub']).toEqual({ hex: validHex })
  })

  it('forwards params to marketplace-discover (all-optional fields)', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'marketplace-discover',
        params: { limit: 20 },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['marketplace-discover']).toEqual({ limit: 20 })
  })

  it('forwards parameters to marketplace-discover (alias)', async () => {
    capturedArgs['marketplace-discover'] = {}
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'marketplace-discover',
        parameters: { limit: 42 },
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['marketplace-discover']).toEqual({ limit: 42 })
  })

  it('prefers params over parameters when both are supplied', async () => {
    capturedArgs['nip05-lookup'] = {}
    await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'nip05-lookup',
        params: { identifier: 'from-params@example.com' },
        parameters: { identifier: 'from-parameters@example.com' },
      },
    })
    expect(capturedArgs['nip05-lookup']).toEqual({ identifier: 'from-params@example.com' })
  })

  it('defaults to empty params when neither field is supplied', async () => {
    // marketplace-discover has all-optional fields, so empty params must succeed
    capturedArgs['marketplace-discover'] = {}
    const result = await client.callTool({
      name: 'execute-action',
      arguments: { action: 'marketplace-discover' },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).not.toContain('Invalid parameters')
    expect(capturedArgs['marketplace-discover']).toEqual({ limit: undefined })
  })

  it('returns a helpful error for unknown actions', async () => {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: {
        action: 'does-not-exist',
        params: {},
      },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toContain('Unknown action')
  })
})
