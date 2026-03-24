import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleRelayList,
  handleRelaySet,
  handleRelayAdd,
} from '../../src/relay/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
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
    it('returns relay list for active identity', () => {
      const pool = mockPool()
      const result = handleRelayList(ctx, pool as any)
      expect(result.read).toBeDefined()
      expect(result.write).toBeDefined()
    })

    it('warns if two personas share relays', () => {
      const pool = mockPool()
      pool.checkSharedRelays = vi.fn().mockReturnValue(['wss://shared.example.com'])
      ctx.derive('alt', 0)
      const masterNpub = ctx.activeNpub
      ctx.switch('alt', 0)
      const altNpub = ctx.activeNpub
      ctx.switch('master')
      const result = handleRelayList(ctx, pool as any, altNpub)
      expect(result.sharedWarning).toBeDefined()
      expect(result.sharedWarning).toContain('wss://shared.example.com')
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
})
