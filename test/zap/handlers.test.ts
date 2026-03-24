import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleZapReceipts, handleZapDecode, handleZapSend, handleZapBalance } from '../../src/zap/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return { query: vi.fn().mockResolvedValue(events) }
}

describe('zap handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleZapReceipts', () => {
    it('parses kind 9735 events with amount and sender', async () => {
      const zapReceipt = {
        kind: 9735,
        pubkey: 'zapnode',
        created_at: 1000,
        tags: [
          ['p', ctx.activeNpub],
          ['description', JSON.stringify({
            kind: 9734,
            pubkey: 'sender1',
            content: 'great!',
            tags: [['amount', '50000']],
          })],
        ],
        content: '',
        id: 'zap1',
        sig: 'sig1',
      }
      const pool = mockPool([zapReceipt])
      const result = await handleZapReceipts(ctx, pool as any)
      expect(result.length).toBe(1)
      expect(result[0].amountMsats).toBe(50000)
      expect(result[0].sender).toBe('sender1')
      expect(result[0].message).toBe('great!')
    })
  })

  describe('handleZapDecode', () => {
    it('decodes amount from bolt11 prefix', () => {
      const result = handleZapDecode('lnbc10u1...')
      expect(result.amountMsats).toBe(1_000_000) // 10 micro-btc = 1000 sats = 1000000 msats
    })

    it('returns empty for unrecognised format', () => {
      const result = handleZapDecode('not-a-bolt11')
      expect(result.amountMsats).toBeUndefined()
    })
  })

  describe('handleZapSend', () => {
    it('errors when NWC not configured', async () => {
      const pool = mockPool()
      await expect(handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1...',
      })).rejects.toThrow(/wallet not configured/i)
    })

    it('creates NWC request event when URI provided', async () => {
      const pool = {
        ...mockPool(),
        publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay'], rejected: [], errors: [] }),
      }
      const nwcUri = 'nostr+walletconnect://818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4?relay=wss%3A%2F%2Frelay.example.com&secret=c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
      const result = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1pjtest',
        nwcUri,
      })
      expect(result.event).toBeDefined()
      expect(result.event.kind).toBe(23194)
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  describe('handleZapBalance', () => {
    it('returns configured: false when no NWC URI', () => {
      const result = handleZapBalance({})
      expect(result.configured).toBe(false)
    })

    it('returns wallet info when NWC configured', () => {
      const nwcUri = 'nostr+walletconnect://818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4?relay=wss%3A%2F%2Frelay.example.com&secret=c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
      const result = handleZapBalance({ nwcUri })
      expect(result.configured).toBe(true)
      expect(result.walletPubkey).toBeDefined()
      expect(result.relay).toContain('relay.example.com')
    })
  })
})
