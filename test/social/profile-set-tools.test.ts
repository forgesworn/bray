import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { IdentityContext } from '../../src/context.js'
import { registerSocialTools } from '../../src/social/tools.js'
import { ActionCatalog, createCatalogProxy } from '../../src/catalog.js'

/**
 * Regression tests for the social-profile-set MCP tool.
 *
 * Root cause (fixed): the tool schema declared flat kind 0 fields (`name`,
 * `about`, `picture`, `nip05`, `banner`, `lud16`) while the underlying
 * `handleSocialProfileSet` handler takes `{ profile: {...}, confirm? }`. A
 * client reading the handler contract -- or reasoning from the kind 0 event
 * shape, which is itself a single JSON object -- naturally sends
 * `{ profile: { name: '...' }, confirm: true }`. The MCP SDK stripped the
 * unknown `profile` key, the tool wrapper assembled an empty profile object,
 * and with `confirm: true` this would have wiped the user's kind 0 content.
 *
 * The fix accepts both shapes via the flatOrWrapped helper and adds a
 * data-loss guard that refuses to publish a kind 0 with no content even when
 * `confirm: true` is supplied, so the next regression of this bug family
 * cannot silently destroy profiles.
 *
 * social-profile-set is catalog-routed, so these tests go through
 * execute-action to cover both strips.
 */

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('social-profile-set wrapper forwarding and data-loss guard', () => {
  let server: McpServer
  let client: Client
  let ctx: IdentityContext
  let publishedEvents: NostrEvent[]
  let existingProfiles: NostrEvent[]

  const mockPool = {
    query: async (_npub: string, _filter: Filter) => existingProfiles,
    queryDirect: async () => [],
    getRelays: () => ({ read: ['wss://read.example.com'], write: ['wss://write.example.com'] }),
    publish: async (_npub: string, event: NostrEvent) => {
      publishedEvents.push(event)
      return { success: true, allAccepted: true, accepted: ['wss://write.example.com'], rejected: [], errors: [] }
    },
    reconfigure: () => {},
    checkSharedRelays: () => [],
  }

  beforeAll(async () => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    publishedEvents = []
    existingProfiles = []

    server = new McpServer({ name: 'profile-set-test', version: '0.0.0' }, {})
    const catalog = new ActionCatalog()
    const proxy = createCatalogProxy(server, catalog, new Set())
    registerSocialTools(proxy, {
      ctx: ctx as any,
      pool: mockPool as any,
      nip65: {} as any,
      walletsFile: '/tmp/ignore',
    } as any)
    catalog.registerMetaTools(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'profile-set-test-client', version: '0.0.0' })
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ])
  })

  afterAll(async () => {
    await client.close()
    ctx.destroy()
  })

  beforeEach(() => {
    publishedEvents = []
    existingProfiles = []
  })

  async function callProfileSet(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await client.callTool({
      name: 'execute-action',
      arguments: { action: 'social-profile-set', params },
    })
    const text = (result.content as Array<{ text: string }>)[0].text
    return JSON.parse(text)
  }

  it('publishes a profile supplied via canonical flat fields', async () => {
    const body = await callProfileSet({ name: 'Alice', about: 'Test bio', confirm: true })
    expect(body.error).toBeUndefined()
    expect(body.published).toBe(true)
    expect(publishedEvents).toHaveLength(1)
    expect(publishedEvents[0].kind).toBe(0)
    const content = JSON.parse(publishedEvents[0].content)
    expect(content.name).toBe('Alice')
    expect(content.about).toBe('Test bio')
  })

  it('publishes a profile supplied via the "profile" wrapper object (the shape that used to be silently stripped)', async () => {
    const body = await callProfileSet({
      profile: { name: 'Bob', about: 'Wrapped bio', picture: 'https://example.com/bob.png' },
      confirm: true,
    })
    expect(body.error).toBeUndefined()
    expect(body.published).toBe(true)
    expect(publishedEvents).toHaveLength(1)
    const content = JSON.parse(publishedEvents[0].content)
    expect(content.name).toBe('Bob')
    expect(content.about).toBe('Wrapped bio')
    expect(content.picture).toBe('https://example.com/bob.png')
  })

  it('accepts mixed flat and wrapper fields, with flat winning on conflict', async () => {
    const body = await callProfileSet({
      name: 'Canonical',
      profile: { name: 'Wrapper', about: 'From wrapper' },
      confirm: true,
    })
    expect(body.published).toBe(true)
    const content = JSON.parse(publishedEvents[0].content)
    expect(content.name).toBe('Canonical')
    expect(content.about).toBe('From wrapper')
  })

  it('REFUSES to publish an empty profile even with confirm: true (data-loss guard)', async () => {
    // This is the critical regression: before the fix, `{ profile: {...} }`
    // would be stripped and the tool would sign and publish a kind 0 with
    // empty content, wiping the user's real profile on confirm. The guard
    // now stops the publish if no profile fields are present at all.
    const body = await callProfileSet({ confirm: true })
    expect(body.error).toBeDefined()
    expect(body.error).toContain('empty profile')
    expect(publishedEvents).toHaveLength(0)
  })

  it('REFUSES to publish when every field would have been stripped (simulated regression)', async () => {
    // Simulate the exact shape that the pre-fix bug would have produced: all
    // the legitimate fields wrapped in `profile`, with `confirm: true`. With
    // the schema wrapper in place this publishes normally; with the guard in
    // place and an empty object, nothing is published even with confirm.
    const body = await callProfileSet({ profile: {}, confirm: true })
    expect(body.error).toBeDefined()
    expect(body.error).toContain('empty profile')
    expect(publishedEvents).toHaveLength(0)
  })

  it('warns on overwrite when an existing profile is present and confirm is false', async () => {
    // Seed an existing profile so the handler's overwrite warning path fires.
    existingProfiles = [{
      id: 'existing',
      pubkey: ctx.activePublicKeyHex,
      kind: 0,
      created_at: 1000,
      tags: [],
      content: JSON.stringify({ name: 'Old' }),
      sig: '',
    }]
    const body = await callProfileSet({ profile: { name: 'New' } })
    expect(body.warning).toBeDefined()
    expect(publishedEvents).toHaveLength(0)
  })
})
