import { afterEach, describe, expect, it } from 'vitest'
import { NwcClient } from '@forgesworn/nwc-kit'
import { WalletService, grantUri, newGrant, type ServiceWallet } from '../../src/wallet-service/service.js'
import { ONE_SAT, RELAY, fakeRelay, openWallet } from './helpers.js'

// When the relay ends the service's subscription (it restarts, drops the
// socket, or bray replaces the connection), the service subscribes again
// rather than going quiet while still saying it serves.

let running: WalletService | null = null
afterEach(() => {
  running?.close()
  running = null
})

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const start = (
  relay: ReturnType<typeof fakeRelay>,
  wallet: ServiceWallet,
  extra: { shouldServe?: () => boolean } = {},
) => {
  const grant = newGrant({ name: 'spender', relays: [RELAY], methods: ['get_info', 'pay_invoice'], budgetMsat: 10_000 })
  const logs: string[] = []
  running = new WalletService({
    wallet,
    transport: relay.service,
    persist: async () => {},
    log: message => logs.push(message),
    resubscribeDelayMs: 10,
    ...extra,
  })
  return { grant, uri: grantUri(grant), logs }
}

describe('the wallet service after its subscription ends', () => {
  it('subscribes again and answers the next request', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri } = start(relay, wallet)
    await running!.serve(grant)

    relay.drop()
    await pause(60)
    expect(relay.serviceSubscriptions()).toBe(1)

    const client = new NwcClient(uri, { transport: relay.nwc, requestTimeoutMs: 1_000 })
    await client.payInvoice({ invoice: ONE_SAT })
    expect(paid).toHaveLength(1)
    client.close()
  })

  it('does not pay a request again when the new subscription replays it', async () => {
    const relay = fakeRelay()
    const { wallet, paid } = openWallet()
    const { grant, uri, logs } = start(relay, wallet)
    await running!.serve(grant)
    const client = new NwcClient(uri, { transport: relay.nwc, requestTimeoutMs: 1_000 })
    await client.payInvoice({ invoice: ONE_SAT })

    relay.drop()
    await pause(60)

    expect(relay.serviceSubscriptions()).toBe(1)
    expect(paid).toHaveLength(1)
    expect(logs.some(l => l.includes('ignored a replayed request'))).toBe(true)
    client.close()
  })

  it('keeps trying, backing off, while the relay refuses a new subscription', async () => {
    const relay = fakeRelay()
    const { wallet } = openWallet()
    const { grant, logs } = start(relay, wallet)
    await running!.serve(grant)

    relay.refuseNextSubscriptions(2)
    relay.drop()
    await pause(200)

    expect(relay.serviceSubscriptions()).toBe(1)
    expect(logs.filter(l => l.includes('could not subscribe again'))).toHaveLength(2)
  })

  it('does not subscribe again for a grant it has stopped', async () => {
    const relay = fakeRelay()
    const { wallet } = openWallet()
    const { grant } = start(relay, wallet)
    await running!.serve(grant)
    running!.stop(grant.id)

    relay.drop()
    await pause(60)
    expect(relay.serviceSubscriptions()).toBe(0)
  })

  it('stops, rather than subscribing again, when it should no longer serve (the identity changed)', async () => {
    const relay = fakeRelay()
    const { wallet } = openWallet()
    const { grant, logs } = start(relay, wallet, { shouldServe: () => false })
    await running!.serve(grant)

    relay.drop()
    await pause(60)

    expect(relay.serviceSubscriptions()).toBe(0)
    expect(running!.serving()).toEqual([])
    expect(logs.some(l => l.includes('stopped serving spender'))).toBe(true)
  })
})
