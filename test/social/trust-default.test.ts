import { describe, it, expect, vi } from 'vitest'
import { npubEncode } from 'nostr-tools/nip19'
import { registerSocialTools } from '../../src/social/tools.js'

const CALLER = 'c'.repeat(64)
const STRANGER = 'b'.repeat(64)

function feedEvent() {
  return {
    id: '1'.repeat(64), pubkey: STRANGER, created_at: 1000, kind: 1, tags: [], content: 'hello', sig: 'f'.repeat(128),
  }
}

function register(trust?: { mode: 'strict' | 'annotate' | 'off' }) {
  const tools = new Map<string, (args: any) => Promise<{ content: Array<{ text: string }> }>>()
  const server = {
    registerTool(name: string, _definition: unknown, handler: any) {
      tools.set(name, handler)
    },
  }
  // Answers every query with the one feed event; no assertions, so the stranger scores 0
  const pool = {
    query: vi.fn().mockImplementation(async (_npub: string, filter: { kinds?: number[] }) =>
      filter.kinds?.includes(1) ? [feedEvent()] : []),
  }
  registerSocialTools(server as any, {
    ctx: { activeNpub: npubEncode(CALLER), activePublicKeyHex: CALLER },
    pool,
    trust,
    veilCacheTtl: 60_000,
    veilCacheMax: 100,
  } as any)
  return tools
}

async function feed(tools: ReturnType<typeof register>, args: Record<string, unknown> = {}) {
  const result = await tools.get('social-feed')!({ limit: 20, output: 'json', ...args })
  return JSON.parse(result.content[0].text) as Array<{ pubkey: string; trustScore?: number }>
}

describe('social-feed trust default', () => {
  it('uses the configured trust mode when no trust argument is given', async () => {
    const entries = await feed(register({ mode: 'off' }))
    expect(entries).toHaveLength(1)
    expect(entries[0].trustScore).toBeUndefined()
  })

  it('lets an explicit strict override the configured mode', async () => {
    const entries = await feed(register({ mode: 'off' }), { trust: 'strict' })
    expect(entries).toHaveLength(0)
  })

  it('defaults to annotate when no mode is configured', async () => {
    const entries = await feed(register())
    expect(entries).toHaveLength(1)
    expect(entries[0].trustScore).toBe(0)
  })

  it('applies the configured strict mode to notifications', async () => {
    const tools = register({ mode: 'strict' })
    const result = await tools.get('social-notifications')!({ limit: 50, output: 'json' })
    expect(JSON.parse(result.content[0].text)).toEqual([])
  })
})
