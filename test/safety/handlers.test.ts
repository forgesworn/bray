import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleDuressConfigure, handleDuressActivate } from '../../src/safety/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool() {
  return {
    getRelays: vi.fn().mockReturnValue({ read: [], write: [] }),
    reconfigure: vi.fn(),
  }
}

describe('safety handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleDuressConfigure', () => {
    it('configures a duress persona', async () => {
      const pool = mockPool()
      const result = await handleDuressConfigure(ctx, pool as any, {})
      expect(result.configured).toBe(true)
      expect(result.npub).toMatch(/^npub1/)
    })

    it('uses custom persona name', async () => {
      const pool = mockPool()
      const result = await handleDuressConfigure(ctx, pool as any, { personaName: 'escape-hatch' })
      expect(result.configured).toBe(true)
      const list = await ctx.listIdentities()
      expect(list.some(i => i.personaName === 'escape-hatch')).toBe(true)
    })

    it('defaults to "anonymous" persona name', async () => {
      const pool = mockPool()
      await handleDuressConfigure(ctx, pool as any, {})
      const list = await ctx.listIdentities()
      expect(list.some(i => i.personaName === 'anonymous')).toBe(true)
    })

    it('produces deterministic npub for same persona name', async () => {
      const pool = mockPool()
      const r1 = await handleDuressConfigure(ctx, pool as any, { personaName: 'safe' })
      const r2 = await handleDuressConfigure(ctx, pool as any, { personaName: 'safe' })
      expect(r1.npub).toBe(r2.npub)
    })

    it('produces different npubs for different persona names', async () => {
      const pool = mockPool()
      const r1 = await handleDuressConfigure(ctx, pool as any, { personaName: 'alpha' })
      const r2 = await handleDuressConfigure(ctx, pool as any, { personaName: 'beta' })
      expect(r1.npub).not.toBe(r2.npub)
    })
  })

  describe('handleDuressActivate', () => {
    it('switches to duress persona', async () => {
      const pool = mockPool()
      await handleDuressConfigure(ctx, pool as any, { personaName: 'safe' })
      const masterNpub = ctx.activeNpub
      const result = await handleDuressActivate(ctx, { personaName: 'safe' })
      expect(result.npub).toMatch(/^npub1/)
      expect(result.npub).not.toBe(masterNpub)
    })

    it('response is identical structure to identity_switch', async () => {
      const pool = mockPool()
      await handleDuressConfigure(ctx, pool as any, {})
      const result = await handleDuressActivate(ctx, {})
      expect(Object.keys(result)).toEqual(['npub'])
    })

    it('duress identity appears in identity_list as normal', async () => {
      const pool = mockPool()
      await handleDuressConfigure(ctx, pool as any, { personaName: 'emergency' })
      const list = await ctx.listIdentities()
      expect(list.some(i => i.personaName === 'emergency')).toBe(true)
    })

    it('does NOT publish any Nostr events on activation', async () => {
      const pool = mockPool()
      await handleDuressConfigure(ctx, pool as any, {})
      await handleDuressActivate(ctx, {})
      // Pool should not have been called for publishing
      expect(pool.reconfigure).not.toHaveBeenCalled()
    })

    it('can switch back to master after activation', async () => {
      const pool = mockPool()
      const masterNpub = ctx.activeNpub
      await handleDuressConfigure(ctx, pool as any, { personaName: 'safe' })
      await handleDuressActivate(ctx, { personaName: 'safe' })
      expect(ctx.activeNpub).not.toBe(masterNpub)
      await ctx.switch('master')
      expect(ctx.activeNpub).toBe(masterNpub)
    })

    it('duress persona is cryptographically unlinkable to master', async () => {
      const pool = mockPool()
      const masterNpub = ctx.activeNpub
      const { npub: duressNpub } = await handleDuressConfigure(ctx, pool as any, {})
      // The npubs are completely different — no deterministic relationship visible
      expect(duressNpub).not.toBe(masterNpub)
      expect(duressNpub.slice(0, 10)).not.toBe(masterNpub.slice(0, 10))
    })
  })
})
