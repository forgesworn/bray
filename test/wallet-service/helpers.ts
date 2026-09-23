import { matchFilter } from 'nostr-tools'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { NwcEvent, NwcTransport } from '@forgesworn/nwc-kit'
import type { ServiceTransport, ServiceWallet } from '../../src/wallet-service/service.js'

// Shared by the wallet-service tests: an in-memory relay both sides can
// use, and a wallet that pays whatever it is handed.

export const RELAY = 'wss://relay.test'
// 1000 msat, decodable, from the same fixture the zap tests use
export const ONE_SAT =
  'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'

export const fakeRelay = () => {
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
export const openWallet = () => {
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

