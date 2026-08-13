import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleZapBalance,
  handleZapListTransactions,
  handleZapSend,
  ZapPaymentOutcomeUnknownError,
} from '../../src/zap/handlers.js'
import { buildNwcUri, createMockWallet } from './mock-nwc-wallet.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const CLIENT_SECRET = 'a3'.repeat(32)
const SETTLED_INVOICE = 'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'

describe('NWC round-trip integration', () => {
  let ctx: IdentityContext
  const pool = { query: vi.fn(), publish: vi.fn() } as any

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('discovers capabilities, pays, verifies settlement, and observes the new balance', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const nwcUri = buildNwcUri(wallet.pubkey, CLIENT_SECRET)
    const options = { nwcUri, transport: wallet.transport }

    await expect(handleZapBalance(ctx, pool, options)).resolves.toEqual({ balance: 500_000 })
    await expect(handleZapSend(ctx, pool, { ...options, invoice: SETTLED_INVOICE })).resolves.toMatchObject({
      verified: true,
      preimage: 'aa'.repeat(32),
    })
    await expect(handleZapBalance(ctx, pool, options)).resolves.toEqual({ balance: 490_000 })
    expect(wallet.history.map((entry) => entry.method)).toEqual(['get_balance', 'pay_invoice', 'get_balance'])
  })

  it('fails closed on a wallet error and on a mismatched settlement preimage', async () => {
    const broke = createMockWallet({ balance: 0 })
    await expect(handleZapSend(ctx, pool, {
      invoice: SETTLED_INVOICE,
      nwcUri: buildNwcUri(broke.pubkey, CLIENT_SECRET),
      transport: broke.transport,
    })).rejects.toMatchObject({ code: 'WALLET_ERROR', walletCode: 'INSUFFICIENT_BALANCE' })

    const lying = createMockWallet({ paymentPreimage: 'ff'.repeat(32) })
    await expect(handleZapSend(ctx, pool, {
      invoice: SETTLED_INVOICE,
      nwcUri: buildNwcUri(lying.pubkey, CLIENT_SECRET),
      transport: lying.transport,
    })).rejects.toMatchObject({
      code: 'PAYMENT_OUTCOME_UNKNOWN',
      paymentHash: 'e0e77a507412b120f6ede61f62295b1a7b2ff19d3dcc8f7253e51663470c888e',
    } satisfies Partial<ZapPaymentOutcomeUnknownError>)
  })

  it('keeps extension 05 isolated while returning authenticated history', async () => {
    const wallet = createMockWallet()
    await expect(handleZapListTransactions(ctx, pool, {
      nwcUri: buildNwcUri(wallet.pubkey, CLIENT_SECRET),
      transport: wallet.transport,
      limit: 5,
    })).resolves.toMatchObject({ transactions: [{ type: 'incoming' }] })
  })
})
