import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleZapReceipts, handleZapDecode } from '../../src/zap/handlers.js'

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
})
