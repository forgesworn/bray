import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdentityContext } from '../../src/context.js'
import { handleZapSend } from '../../src/zap/handlers.js'
import {
  DEFAULT_MAX_DAILY_MSAT,
  DEFAULT_MAX_PAYMENT_MSAT,
  PaymentGuard,
  PaymentLimitError,
  feeReserveMsat,
  paymentLimitsFromEnv,
} from '../../src/zap/payment-guard.js'
import { upstreamWallet } from '../../src/wallet-service/upstream.js'
import { PaymentNotSentError } from '../../src/wallet-service/service.js'
import { buildNwcUri, createMockWallet } from './mock-nwc-wallet.js'

// bray's own ceiling on spending. `confirm: true` is a flag the model sets
// for itself; these limits are the part it cannot set.

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const CLIENT_SECRET = 'a3'.repeat(32)
// 1000 msat
const SETTLED_INVOICE = 'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'
const PAYMENT_HASH = 'e0e77a507412b120f6ede61f62295b1a7b2ff19d3dcc8f7253e51663470c888e'
const pool = { query: async () => [], publish: async () => ({}) } as any

let directory: string
let ctx: IdentityContext
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bray-guard-'))
  ctx = new IdentityContext(TEST_NSEC, 'nsec')
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const guardAt = (limits: { maxPaymentMsat: number; maxDailyMsat: number }, now = () => Date.now()) =>
  new PaymentGuard({ path: join(directory, 'payment-ledger.json'), limits, now })

const pay = (guard: PaymentGuard, wallet = createMockWallet({ balance: 500_000 })) =>
  handleZapSend(ctx, pool, {
    invoice: SETTLED_INVOICE,
    nwcUri: buildNwcUri(wallet.pubkey, CLIENT_SECRET),
    transport: wallet.transport,
    guard,
  })

describe('bray-side payment limits', () => {
  it('defaults to conservative ceilings and rejects nonsense in the environment', () => {
    expect(paymentLimitsFromEnv({})).toEqual({
      maxPaymentMsat: DEFAULT_MAX_PAYMENT_MSAT,
      maxDailyMsat: DEFAULT_MAX_DAILY_MSAT,
    })
    expect(paymentLimitsFromEnv({ BRAY_MAX_PAYMENT_MSAT: '2000', BRAY_MAX_DAILY_MSAT: '9000' })).toEqual({
      maxPaymentMsat: 2000,
      maxDailyMsat: 9000,
    })
    expect(() => paymentLimitsFromEnv({ BRAY_MAX_PAYMENT_MSAT: '10 sats' })).toThrow(/BRAY_MAX_PAYMENT_MSAT/)
    expect(() => paymentLimitsFromEnv({ BRAY_MAX_DAILY_MSAT: '-1' })).toThrow(/BRAY_MAX_DAILY_MSAT/)
  })

  it('refuses a payment above the per-payment ceiling before the wallet is asked', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    await expect(pay(guardAt({ maxPaymentMsat: 999, maxDailyMsat: 1_000_000 }), wallet)).rejects.toThrow(
      PaymentLimitError,
    )
    expect(wallet.history).toHaveLength(0)
  })

  it('keeps the daily total across a restart', async () => {
    const limits = { maxPaymentMsat: 5_000, maxDailyMsat: 2_500 }
    await pay(guardAt(limits))
    // fees_paid from the mock wallet is 1000 msat: 1000 + 1000 charged
    expect(guardAt(limits).spentTodayMsat()).toBe(2_000)

    // A fresh guard is a fresh process. The allowance must not come back.
    expect(() => guardAt(limits).check('44'.repeat(32), 1_000)).toThrow(/24-hour allowance/)
  })

  it('gives the allowance back after a definite wallet refusal', async () => {
    const guard = guardAt({ maxPaymentMsat: 5_000, maxDailyMsat: 100_000 })
    // The mock refuses with INSUFFICIENT_BALANCE below 10,000 msat
    await expect(pay(guard, createMockWallet({ balance: 1 }))).rejects.toThrow()
    expect(guard.spentTodayMsat()).toBe(0)
    expect(guard.status(PAYMENT_HASH)).toBe('failed')
  })

  it('counts payments older than a day out of the rolling window', async () => {
    let now = 1_000_000_000_000
    const limits = { maxPaymentMsat: 5_000, maxDailyMsat: 3_000 }
    const guard = guardAt(limits, () => now)
    guard.reserve('11'.repeat(32), 1_000)
    guard.settle('11'.repeat(32), 0)
    expect(() => guard.check('22'.repeat(32), 1_500)).toThrow(PaymentLimitError)
    now += 86_400_001
    expect(() => guard.check('22'.repeat(32), 1_500)).not.toThrow()
  })

  it('reserves a fee margin and keeps it when the wallet does not report a fee', () => {
    const guard = guardAt({ maxPaymentMsat: 1_000_000, maxDailyMsat: 10_000_000 })
    guard.reserve('33'.repeat(32), 500_000)
    expect(guard.spentTodayMsat()).toBe(500_000 + feeReserveMsat(500_000))
    guard.settle('33'.repeat(32), undefined)
    expect(guard.spentTodayMsat()).toBe(505_000)
    expect(feeReserveMsat(10)).toBe(1_000)
  })

  it('applies to what a scoped connection spends through the wallet service', async () => {
    const mock = createMockWallet({ balance: 500_000 })
    const wallet = upstreamWallet({
      uri: buildNwcUri(mock.pubkey, CLIENT_SECRET),
      transport: mock.transport,
      guard: guardAt({ maxPaymentMsat: 999, maxDailyMsat: 1_000_000 }),
    })
    await expect(wallet.payInvoice({ invoice: SETTLED_INVOICE, amountMsat: 1_000 })).rejects.toThrow(
      PaymentNotSentError,
    )
    expect(mock.history.filter((entry) => entry.method === 'pay_invoice')).toHaveLength(0)
  })

  it('fails closed on a ledger nobody can read', async () => {
    const { writeFileSync } = await import('node:fs')
    const path = join(directory, 'payment-ledger.json')
    writeFileSync(path, '{not json', { mode: 0o600 })
    const guard = new PaymentGuard({ path, limits: { maxPaymentMsat: 5_000, maxDailyMsat: 100_000 } })
    expect(() => guard.check(PAYMENT_HASH, 1_000)).toThrow(/refusing to spend/)
  })
})
