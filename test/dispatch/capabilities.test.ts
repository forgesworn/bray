import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { IdentityContext } from '../../src/context.js'
import {
  handleCapabilityPublish,
  handleCapabilityDiscover,
  handleCapabilityRead,
} from '../../src/dispatch/capabilities.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
  }
}

/** Build a fake kind 31990 event with dispatch capability content */
function fakeCapabilityEvent(overrides: {
  pubkey?: string
  name?: string
  description?: string
  taskTypes?: string[]
  repos?: string[]
  availability?: string
  maxDepth?: number
  slug?: string
} = {}) {
  const pubkey = overrides.pubkey ?? getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
  const slug = overrides.slug ?? 'test-agent'
  return {
    id: 'abc123',
    pubkey,
    kind: 31990,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', slug],
      ['k', '14'],
      ['t', 'dispatch'],
      ['t', 'think'],
      ['p', pubkey],
    ],
    content: JSON.stringify({
      name: overrides.name ?? 'Test Agent',
      description: overrides.description ?? 'A test dispatch agent',
      taskTypes: overrides.taskTypes ?? ['think', 'build'],
      repos: overrides.repos ?? ['toll-booth'],
      availability: overrides.availability ?? 'available',
      ...(overrides.maxDepth !== undefined ? { maxDepth: overrides.maxDepth } : {}),
      protocol: 'dispatch-v1',
    }),
    sig: 'fakesig',
  }
}

describe('dispatch capability handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // -------------------------------------------------------------------------
  // handleCapabilityPublish
  // -------------------------------------------------------------------------
  describe('handleCapabilityPublish', () => {
    it('creates a kind 31990 event with correct tags', async () => {
      const pool = mockPool()
      const result = await handleCapabilityPublish(ctx, pool as any, {
        name: 'Prometheus',
        description: 'Full-stack TypeScript agent',
        taskTypes: ['think', 'build'],
        repos: ['toll-booth', 'trott-sdk'],
        availability: 'available',
        maxDepth: 3,
      })

      expect(result.event.kind).toBe(31990)
      expect(result.publish.success).toBe(true)

      // Check d-tag (slugified name)
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag).toBeDefined()
      expect(dTag![1]).toBe('prometheus')

      // Check k-tag for NIP-17 DM kind
      const kTag = result.event.tags.find((t: string[]) => t[0] === 'k')
      expect(kTag).toBeDefined()
      expect(kTag![1]).toBe('14')

      // Check dispatch t-tag
      const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
      const tValues = tTags.map((t: string[]) => t[1])
      expect(tValues).toContain('dispatch')
      expect(tValues).toContain('think')
      expect(tValues).toContain('build')

      // Check p-tag contains own pubkey
      const pTag = result.event.tags.find((t: string[]) => t[0] === 'p')
      expect(pTag).toBeDefined()
      expect(pTag![1]).toBe(ctx.activePublicKeyHex)
    })

    it('uses custom slug when provided', async () => {
      const pool = mockPool()
      const result = await handleCapabilityPublish(ctx, pool as any, {
        name: 'Prometheus',
        description: 'Agent',
        taskTypes: ['think'],
        slug: 'custom-slug',
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toBe('custom-slug')
    })

    it('defaults slug to slugified name', async () => {
      const pool = mockPool()
      const result = await handleCapabilityPublish(ctx, pool as any, {
        name: 'My Cool Agent',
        description: 'Does things',
        taskTypes: ['build'],
      })

      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag![1]).toBe('my-cool-agent')
    })

    it('content JSON is correctly structured', async () => {
      const pool = mockPool()
      const result = await handleCapabilityPublish(ctx, pool as any, {
        name: 'Forge Worker',
        description: 'Build specialist',
        taskTypes: ['build'],
        repos: ['toll-booth'],
        availability: 'busy',
        maxDepth: 2,
      })

      const content = JSON.parse(result.event.content)
      expect(content.name).toBe('Forge Worker')
      expect(content.description).toBe('Build specialist')
      expect(content.taskTypes).toEqual(['build'])
      expect(content.repos).toEqual(['toll-booth'])
      expect(content.availability).toBe('busy')
      expect(content.maxDepth).toBe(2)
      expect(content.protocol).toBe('dispatch-v1')
    })

    it('omits maxDepth from content when not provided', async () => {
      const pool = mockPool()
      const result = await handleCapabilityPublish(ctx, pool as any, {
        name: 'Agent',
        description: 'Simple agent',
        taskTypes: ['think'],
      })

      const content = JSON.parse(result.event.content)
      expect(content.maxDepth).toBeUndefined()
      expect(content.repos).toEqual([])
      expect(content.availability).toBe('available')
    })
  })

  // -------------------------------------------------------------------------
  // handleCapabilityDiscover
  // -------------------------------------------------------------------------
  describe('handleCapabilityDiscover', () => {
    it('queries for dispatch-tagged kind 31990 events', async () => {
      const events = [fakeCapabilityEvent()]
      const pool = mockPool(events)

      const result = await handleCapabilityDiscover(pool as any, 'npub1test', {})

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        '#t': ['dispatch'],
        limit: 20,
      })
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Test Agent')
      expect(result[0].taskTypes).toEqual(['think', 'build'])
    })

    it('filters by task type when provided', async () => {
      const pool = mockPool([])

      await handleCapabilityDiscover(pool as any, 'npub1test', { taskType: 'build' })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        '#t': ['dispatch', 'build'],
        limit: 20,
      })
    })

    it('respects custom limit', async () => {
      const pool = mockPool([])

      await handleCapabilityDiscover(pool as any, 'npub1test', { limit: 5 })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        '#t': ['dispatch'],
        limit: 5,
      })
    })

    it('skips events with non-dispatch protocol', async () => {
      const badEvent = {
        ...fakeCapabilityEvent(),
        content: JSON.stringify({ name: 'Bad', protocol: 'other' }),
      }
      const pool = mockPool([badEvent])

      const result = await handleCapabilityDiscover(pool as any, 'npub1test', {})
      expect(result).toHaveLength(0)
    })

    it('skips events with invalid JSON content', async () => {
      const badEvent = {
        ...fakeCapabilityEvent(),
        content: 'not json',
      }
      const pool = mockPool([badEvent])

      const result = await handleCapabilityDiscover(pool as any, 'npub1test', {})
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // handleCapabilityRead
  // -------------------------------------------------------------------------
  describe('handleCapabilityRead', () => {
    it('fetches a specific agent capability card', async () => {
      const pubkey = getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
      const event = fakeCapabilityEvent({ pubkey, name: 'Alice Agent', availability: 'busy' })
      const pool = mockPool([event])

      const result = await handleCapabilityRead(pool as any, 'npub1test', { pubkey })

      expect(pool.query).toHaveBeenCalledWith('npub1test', {
        kinds: [31990],
        authors: [pubkey],
        '#t': ['dispatch'],
      })
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Alice Agent')
      expect(result!.availability).toBe('busy')
      expect(result!.pubkey).toBe(pubkey)
    })

    it('returns null when no capability card exists', async () => {
      const pool = mockPool([])
      const pubkey = getPublicKey(Buffer.from('03'.repeat(32), 'hex'))

      const result = await handleCapabilityRead(pool as any, 'npub1test', { pubkey })
      expect(result).toBeNull()
    })

    it('returns the most recent event when multiple exist', async () => {
      const pubkey = getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
      const older = { ...fakeCapabilityEvent({ pubkey, name: 'Old' }), created_at: 1000 }
      const newer = { ...fakeCapabilityEvent({ pubkey, name: 'New' }), created_at: 2000 }
      const pool = mockPool([older, newer])

      const result = await handleCapabilityRead(pool as any, 'npub1test', { pubkey })
      expect(result!.name).toBe('New')
    })
  })
})
