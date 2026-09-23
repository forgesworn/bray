import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upstreamWallet } from '../../src/wallet-service/upstream.js'
import { PaymentNotSentError } from '../../src/wallet-service/service.js'
import { PaymentGuard } from '../../src/zap/payment-guard.js'
import { buildNwcUri, createMockWallet } from '../zap/mock-nwc-wallet.js'

// The wallet behind the service. bray sits between two NWC connections, so
// what it forwards has to be checked exactly as carefully as what it
// receives: a service that repeats an unproven claim of payment is lying to
// whoever asked, whoever told it first.

const CLIENT_SECRET = 'a3'.repeat(32)
const SETTLED_INVOICE =
  'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'

describe('the wallet behind the service', () => {
  it('reports its balance and pays with a preimage that settles the invoice', async () => {
    const mock = createMockWallet({ balance: 500_000 })
    const wallet = upstreamWallet({ uri: buildNwcUri(mock.pubkey, CLIENT_SECRET), transport: mock.transport })

    await expect(wallet.balanceMsat()).resolves.toBe(500_000)
    const paid = await wallet.payInvoice({ invoice: SETTLED_INVOICE, amountMsat: 1_000 })
    expect(paid.preimage).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a claimed payment it cannot prove', async () => {
    // The wallet says it paid and hands over a preimage that does not
    // settle that invoice. Passing it on would make this service the one
    // telling the lie.
    const lying = createMockWallet({ paymentPreimage: 'ff'.repeat(32) })
    const wallet = upstreamWallet({ uri: buildNwcUri(lying.pubkey, CLIENT_SECRET), transport: lying.transport })

    await expect(wallet.payInvoice({ invoice: SETTLED_INVOICE, amountMsat: 1_000 })).rejects.toThrow(
      /does not settle that invoice/,
    )
  })

  it('refuses an invoice it cannot decode before asking the wallet for anything', async () => {
    const mock = createMockWallet()
    const wallet = upstreamWallet({ uri: buildNwcUri(mock.pubkey, CLIENT_SECRET), transport: mock.transport })

    await expect(wallet.payInvoice({ invoice: 'not-an-invoice', amountMsat: 1_000 })).rejects.toThrow(
      /not a decodable/,
    )
    expect(mock.history).toHaveLength(0)
  })

  it('treats a definite wallet refusal as not sent, without repeating what the wallet said', async () => {
    // The mock refuses with INSUFFICIENT_BALANCE / "Not enough funds" below 10,000 msat.
    const poor = createMockWallet({ balance: 1 })
    const directory = mkdtempSync(join(tmpdir(), 'bray-upstream-'))
    try {
      const guard = new PaymentGuard({
        path: join(directory, 'payment-ledger.json'),
        limits: { maxPaymentMsat: 5_000, maxDailyMsat: 100_000 },
      })
      const wallet = upstreamWallet({ uri: buildNwcUri(poor.pubkey, CLIENT_SECRET), transport: poor.transport, guard })
      const refused = await wallet.payInvoice({ invoice: SETTLED_INVOICE, amountMsat: 1_000 }).catch((err: unknown) => err)
      expect(refused).toBeInstanceOf(PaymentNotSentError)
      expect((refused as Error).message).not.toMatch(/funds|balance/i)
      expect(guard.spentTodayMsat()).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
