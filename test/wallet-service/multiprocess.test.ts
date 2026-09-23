import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NwcClient } from '@forgesworn/nwc-kit'
import { WalletService, grantUri, newGrant } from '../../src/wallet-service/service.js'
import {
  acquireServeLock,
  fileGrantStore,
  loadGrants,
  refillGrant,
  releaseServeLock,
  revokeGrant,
  updateGrants,
} from '../../src/wallet-service/grants.js'
import { ONE_SAT, RELAY, fakeRelay, openWallet } from './helpers.js'

// Several bray processes share one grants file: an MCP session serving,
// a CLI or a second client revoking or refilling. The file is the record;
// no process may miss a change another made, or undo it by writing back
// what it remembered.

const PUBKEY = 'ab'.repeat(32)
let directory: string
let path: string
let running: WalletService | null = null

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bray-grants-'))
  path = join(directory, 'wallet-grants.json')
})
afterEach(() => {
  running?.close()
  running = null
  rmSync(directory, { recursive: true, force: true })
})

const serveFromFile = async (budgetMsat: number) => {
  const relay = fakeRelay()
  const { wallet, paid } = openWallet()
  const grant = newGrant({ name: 'agent', relays: [RELAY], methods: ['get_info', 'pay_invoice'], budgetMsat })
  updateGrants(path, PUBKEY, (grants) => { grants.push(grant) })
  running = new WalletService({ wallet, transport: relay.service, store: fileGrantStore(path, PUBKEY) })
  // The serving process holds its own copy, as the MCP tool does.
  await running.serve(structuredClone(grant))
  const client = new NwcClient(grantUri(grant), { transport: relay.nwc, requestTimeoutMs: 400 })
  await client.connect()
  return { grant, client, paid }
}

describe('grants shared between processes', () => {
  it('stops paying once another process revokes the connection', async () => {
    const { client, paid } = await serveFromFile(10_000)
    await client.payInvoice({ invoice: ONE_SAT })
    expect(paid).toHaveLength(1)

    revokeGrant(path, PUBKEY, 'agent')

    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow()
    expect(paid).toHaveLength(1)
    // ...and the serving process cannot write the revocation away.
    expect(loadGrants(path, PUBKEY)[0]!.revokedAt).toBeTypeOf('number')
    client.close()
  })

  it('honours a refill made by another process, and does not overwrite it', async () => {
    const { client, paid } = await serveFromFile(2_000)
    await client.payInvoice({ invoice: ONE_SAT })
    await expect(client.payInvoice({ invoice: ONE_SAT })).rejects.toThrow(/1000 msat of its budget left/)

    refillGrant(path, PUBKEY, 'agent', 4_000)
    await client.payInvoice({ invoice: ONE_SAT })

    expect(paid).toHaveLength(2)
    const stored = loadGrants(path, PUBKEY)[0]!
    expect(stored.budgetMsat).toBe(4_000)
    expect(stored.spentMsat).toBe(1_000)
    client.close()
  })

  it('lets only one process serve the grants at a time', () => {
    // A live process that is not this one: the parent that started it.
    writeFileSync(`${path}.serving`, String(process.ppid), { mode: 0o600 })
    expect(() => acquireServeLock(path)).toThrow(/already serving/)
  })

  it('takes over a serving claim whose process has gone', () => {
    writeFileSync(`${path}.serving`, '999999999', { mode: 0o600 })
    acquireServeLock(path)
    acquireServeLock(path)
    releaseServeLock(path)
    expect(existsSync(`${path}.serving`)).toBe(false)
  })
})
