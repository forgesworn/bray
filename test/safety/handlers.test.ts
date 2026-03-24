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
    it('configures a duress persona', () => {
      const pool = mockPool()
      const result = handleDuressConfigure(ctx, pool as any, {})
      expect(result.configured).toBe(true)
      expect(result.npub).toMatch(/^npub1/)
    })
  })

  describe('handleDuressActivate', () => {
    it('switches to duress persona', () => {
      const pool = mockPool()
      handleDuressConfigure(ctx, pool as any, { personaName: 'safe' })
      const masterNpub = ctx.activeNpub
      const result = handleDuressActivate(ctx, { personaName: 'safe' })
      expect(result.npub).toMatch(/^npub1/)
      expect(result.npub).not.toBe(masterNpub)
    })

    it('response is identical structure to identity_switch', () => {
      const pool = mockPool()
      handleDuressConfigure(ctx, pool as any, {})
      const result = handleDuressActivate(ctx, {})
      // identity_switch returns { npub: string }
      expect(Object.keys(result)).toEqual(['npub'])
    })

    it('duress identity appears in identity_list as normal', () => {
      const pool = mockPool()
      handleDuressConfigure(ctx, pool as any, { personaName: 'emergency' })
      const list = ctx.listIdentities()
      expect(list.some(i => i.personaName === 'emergency')).toBe(true)
    })
  })
})
