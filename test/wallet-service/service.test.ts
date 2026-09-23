import { afterEach, describe, expect, it } from 'vitest'
import { NwcClient } from '@forgesworn/nwc-kit'
import {
  WalletService,
  grantUri,
  newGrant,
  type Grant,
  type ServiceWallet,
} from '../../src/wallet-service/service.js'

// Handing out a wallet connection narrower than the one you hold.
//
// The client in every test is nwc-kit - the same one `zap-send` uses to
// spend through somebody else's wallet, which verifies event signatures and
// matches responses to requests. The wallet behind the service would pay
// anything it is asked to; the point of these tests is that what is handed
// out cannot ask for anything.

import { ONE_SAT, RELAY, fakeRelay, openWallet } from './helpers.js'

let running: WalletService | null = null
afterEach(() => {
  running?.close()
  running = null
})

const serve = async (
  relay: ReturnType<typeof fakeRelay>,
  wallet: ServiceWallet,
  input: Parameters<typeof newGrant>[0],
): Promise<{ grant: Grant; uri: string }> => {
  const grant = newGrant({ relays: [RELAY], ...input })
  running = new WalletService({ wallet, transport: relay.service, persist: async () => {} })
  await running.serve(grant)
  return { grant, uri: grantUri(grant) }
}

describe('a grant is narrower than the URI behind it', () => {
  it('advertises no spending and no balance by default, and refuses both', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { uri } = await serve(relay, wallet, { name: 'reader' })

    const client = new NwcClient(uri, { transport: relay.nwc })
    const capabilities = await client.connect()
    expect(capabilities.methods).toEqual(['get_info', 'make_invoice'])
    await expect(client.getBalance()).rejects.toThrow(/does not advertise get_balance/)
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow(/does not advertise pay_invoice/)
    expect(paid).toHaveLength(0)
    client.close()
  })

  it('refuses to issue a spending connection with no budget at all', () => {
    expect(() => newGrant({ name: 'greedy', relays: [RELAY], methods: ['pay_invoice'] })).toThrow(
      /no unlimited grant/,
    )
  })

  it('stops at the budget even though the wallet behind it would pay anything', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 2_500,
    })
    const client = new NwcClient(uri, { transport: relay.nwc })
    await client.connect()

    await client.payInvoice({ invoice: ONE_SAT })
    await client.payInvoice({ invoice: ONE_SAT })
    // 500 msat left and the invoice is for 1000
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow(/500 msat of its budget left/)

    expect(paid).toHaveLength(2)
    expect(grant.spentMsat).toBe(2_000)
    client.close()
  })

  it('caps a single payment below the budget when asked to', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 10_000,
      maxPaymentMsat: 500,
    })
    const client = new NwcClient(uri, { transport: relay.nwc })
    await client.connect()
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow(/ceiling for one payment/)
    expect(paid).toHaveLength(0)
    client.close()
  })

  it('pays once when the same signed request arrives twice', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 10_000,
    })
    const client = new NwcClient(uri, { transport: relay.nwc })
    await client.connect()
    await client.payInvoice({ invoice: ONE_SAT })

    // A relay handing the same event back is ordinary. Treating it as new
    // is a second payment nobody asked for.
    const request = relay.stored.find((event) => event.kind === 23194)!
    relay.deliver(request)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(paid).toHaveLength(1)
    expect(grant.spentMsat).toBe(1_000)
    client.close()
  })

  it('writes a spending request down before the money moves', async () => {
    // The crash window: if the id is only remembered once the payment has
    // finished, a process that dies mid-payment comes back with no record
    // of it, and the client - having had no answer - retries.
    const relay = fakeRelay()
    const persisted: string[][] = []
    const grant = newGrant({ name: 'agent', relays: [RELAY], methods: ['get_info', 'pay_invoice'], budgetMsat: 10_000 })
    let asked = false
    running = new WalletService({
      wallet: {
        ...openWallet().wallet,
        payInvoice: () => {
          asked = true
          return new Promise(() => {})
        },
      },
      transport: relay.service,
      persist: async () => {
        persisted.push([...(grant.seen ?? [])])
      },
    })
    await running.serve(grant)

    const client = new NwcClient(grantUri(grant), { transport: relay.nwc, requestTimeoutMs: 400 })
    await client.connect()
    void client.payInvoice({ invoice: ONE_SAT }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(asked).toBe(true)
    expect(grant.seen).toHaveLength(1)
    expect(persisted[0]).toEqual(grant.seen)
    client.close()
  })

  it('stops answering the moment it is revoked', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 10_000,
    })
    running!.stop(grant.id)

    const client = new NwcClient(uri, { transport: relay.nwc, requestTimeoutMs: 400 })
    await client.connect()
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow()
    expect(paid).toHaveLength(0)
    client.close()
  })

  it('cannot be used by anyone but the holder of its secret', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 10_000,
    })
    void uri
    // The service pubkey is public - it is in the info event. A stranger
    // building a valid request under their own key seals it to a
    // conversation this service cannot open, so it is never answered.
    const stranger = newGrant({ name: 'stranger', relays: [RELAY] })
    const forged = { ...grant, clientSecretHex: stranger.clientSecretHex, clientPubkey: stranger.clientPubkey }
    const client = new NwcClient(grantUri(forged), { transport: relay.nwc, requestTimeoutMs: 400 })
    await client.connect()
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow()
    expect(paid).toHaveLength(0)
    expect(relay.stored.filter((event) => event.kind === 23195)).toHaveLength(0)
    client.close()
  })
})

describe('a grant sees only its own invoices', () => {
  const OTHER_HASH = 'ef'.repeat(32)
  const history = () => {
    const asked: string[] = []
    const { wallet, paid } = openWallet()
    const withHistory: ServiceWallet = {
      ...wallet,
      // The wallet behind the service knows every invoice anyone made,
      // with its preimage.
      lookupInvoice: async ({ paymentHash }) => {
        asked.push(paymentHash!)
        return {
          type: 'outgoing',
          invoice: ONE_SAT,
          paymentHash: paymentHash!,
          amountMsat: 1_000,
          createdAt: 1_700_000_000,
          preimage: '99'.repeat(32),
        }
      },
    }
    return { wallet: withHistory, asked, paid }
  }

  it('does not offer lookup_invoice by default', () => {
    expect(newGrant({ name: 'reader', relays: [RELAY] }).methods).not.toContain('lookup_invoice')
  })

  it('answers for invoices it issued and refuses everyone else\'s as not found', async () => {
    const relay = fakeRelay()
    const { wallet, asked } = history()
    const { uri } = await serve(relay, wallet, { name: 'shop', methods: ['get_info', 'make_invoice', 'lookup_invoice'] })
    const client = new NwcClient(uri, { transport: relay.nwc })
    await client.connect()

    const made = await client.makeInvoice({ amount: 1_000 })
    await expect(client.lookupInvoice({ payment_hash: made.payment_hash! })).resolves.toMatchObject({
      payment_hash: made.payment_hash,
    })
    await expect(client.lookupInvoice({ payment_hash: OTHER_HASH })).rejects.toThrow(/No invoice here/)
    // The wallet was never asked about somebody else's payment.
    expect(asked).not.toContain(OTHER_HASH)
    client.close()
  })

  it('answers for invoices it paid', async () => {
    const relay = fakeRelay()
    const { wallet } = history()
    const { uri } = await serve(relay, wallet, {
      name: 'agent',
      methods: ['get_info', 'pay_invoice', 'lookup_invoice'],
      budgetMsat: 10_000,
    })
    const client = new NwcClient(uri, { transport: relay.nwc })
    await client.connect()
    await client.payInvoice({ invoice: ONE_SAT })
    await expect(client.lookupInvoice({ invoice: ONE_SAT })).resolves.toMatchObject({ amount: 1_000 })
    client.close()
  })
})
