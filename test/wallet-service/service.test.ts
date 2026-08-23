import { afterEach, describe, expect, it } from 'vitest'
import { matchFilter } from 'nostr-tools'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { NwcClient } from '@forgesworn/nwc-kit'
import type { NwcEvent, NwcTransport } from '@forgesworn/nwc-kit'
import {
  WalletService,
  grantUri,
  newGrant,
  type Grant,
  type ServiceTransport,
  type ServiceWallet,
} from '../../src/wallet-service/service.js'

// Handing out a wallet connection narrower than the one you hold.
//
// The client in every test is nwc-kit - the same one `zap-send` uses to
// spend through somebody else's wallet, which verifies event signatures and
// matches responses to requests. The wallet behind the service would pay
// anything it is asked to; the point of these tests is that what is handed
// out cannot ask for anything.

const RELAY = 'wss://relay.test'
// 1000 msat, decodable, from the same fixture the zap tests use
const ONE_SAT =
  'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'

const fakeRelay = () => {
  const stored: NostrEvent[] = []
  const live: Array<{ filter: Filter; onEvent: (event: NostrEvent) => void }> = []
  const deliver = (event: NostrEvent) => {
    stored.push(event)
    for (const subscription of [...live]) {
      if (matchFilter(subscription.filter, event)) subscription.onEvent(event)
    }
  }
  const subscribe = (filter: Filter, onEvent: (event: NostrEvent) => void) => {
    const entry = { filter, onEvent }
    live.push(entry)
    for (const event of [...stored]) if (matchFilter(filter, event)) onEvent(event)
    return () => {
      const index = live.indexOf(entry)
      if (index >= 0) live.splice(index, 1)
    }
  }
  const service: ServiceTransport = {
    subscribe: async (_relays, filter, onEvent) => subscribe(filter, onEvent),
    publish: async (_relays, event) => {
      deliver(event)
    },
  }
  const nwc: NwcTransport = {
    query: async (_relays, filter) => stored.filter((event) => matchFilter(filter as Filter, event)) as NwcEvent[],
    subscribe: (_relays, filter, handlers) => {
      const stop = subscribe(filter as Filter, (event) => handlers.onevent(event as NwcEvent))
      return { close: stop }
    },
    publish: async (relays, event) => {
      deliver(event as NostrEvent)
      return [...relays].map((relay) => ({ relay, accepted: true }))
    },
    close: () => {},
  }
  return { service, nwc, stored, deliver }
}

// A wallet with no opinions at all: it pays whatever it is handed. Every
// refusal in these tests therefore comes from the grant, which is the
// whole claim being made.
const openWallet = () => {
  const paid: string[] = []
  const wallet: ServiceWallet = {
    alias: () => 'upstream',
    balanceMsat: async () => 5_000_000,
    makeInvoice: async ({ amountMsat }) => ({
      type: 'incoming',
      invoice: ONE_SAT,
      paymentHash: 'ab'.repeat(32),
      amountMsat,
      createdAt: 1_700_000_000,
    }),
    payInvoice: async ({ invoice }) => {
      paid.push(invoice)
      return { preimage: 'cd'.repeat(32), feesPaidMsat: 0 }
    },
    lookupInvoice: async () => null,
  }
  return { wallet, paid }
}

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
    expect(capabilities.methods).toEqual(['get_info', 'make_invoice', 'lookup_invoice'])
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
