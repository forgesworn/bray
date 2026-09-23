import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { registerZapTools } from '../../src/zap/tools.js'
import { registerMarketplaceTools } from '../../src/marketplace/tools.js'
import { IdentityContext } from '../../src/context.js'
import { buildNwcUri, createMockWallet, type MockWallet } from './mock-nwc-wallet.js'

// `confirm: true` is the model agreeing with itself. When the client can
// ask the human, the human decides; either way bray's caps apply.

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const CLIENT_SECRET = 'a3'.repeat(32)
const SETTLED_INVOICE = 'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'

let directory: string
const saved = { ...process.env }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bray-zap-tools-'))
  process.env.BRAY_HOME = directory
  delete process.env.BRAY_MAX_PAYMENT_MSAT
  delete process.env.BRAY_MAX_DAILY_MSAT
})
afterEach(() => {
  process.env = { ...saved }
  rmSync(directory, { recursive: true, force: true })
})

type Answer = 'approve' | 'decline' | null

async function connect(answer: Answer, wallet: MockWallet) {
  const server = new McpServer({ name: 'zap-tools-test', version: '0.0.0' }, {})
  const deps = {
    ctx: new IdentityContext(TEST_NSEC, 'nsec'),
    pool: { query: async () => [], publish: async () => ({}) },
    nip65: {},
    walletsFile: join(directory, 'wallets.json'),
    nwcUri: buildNwcUri(wallet.pubkey, CLIENT_SECRET),
    nwcTransport: wallet.transport,
  } as any
  registerZapTools(server, deps)
  registerMarketplaceTools(server, deps)
  const asked: string[] = []
  const client = new Client(
    { name: 'zap-tools-client', version: '0.0.0' },
    answer === null ? {} : { capabilities: { elicitation: { form: {} } } },
  )
  if (answer !== null) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      asked.push(String(request.params.message))
      return answer === 'approve'
        ? { action: 'accept', content: { approve: true } }
        : { action: 'decline' }
    })
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return { client, asked }
}

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args }) as any
  return { isError: result.isError === true, text: result.content[0].text as string }
}

const payments = (wallet: MockWallet) => wallet.history.filter((entry) => entry.method === 'pay_invoice')

describe('payment tools ask the human when they can', () => {
  it('does not pay when the human declines, even with confirm: true', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const { client, asked } = await connect('decline', wallet)
    const result = await call(client, 'zap-send', { invoice: SETTLED_INVOICE, confirm: true })
    expect(JSON.parse(result.text)).toMatchObject({ paid: false, declined: true })
    expect(asked[0]).toMatch(/1000 msat/)
    expect(payments(wallet)).toHaveLength(0)
    await client.close()
  })

  it('pays when the human approves', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const { client } = await connect('approve', wallet)
    const result = await call(client, 'zap-send', { invoice: SETTLED_INVOICE, confirm: true })
    expect(JSON.parse(result.text)).toMatchObject({ paid: true, verified: true, humanApproved: true })
    expect(payments(wallet)).toHaveLength(1)
    await client.close()
  })

  it('falls back to confirm when the client cannot be asked', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const { client } = await connect(null, wallet)
    const result = await call(client, 'zap-send', { invoice: SETTLED_INVOICE, confirm: true })
    expect(JSON.parse(result.text)).toMatchObject({ paid: true, humanApproved: false })
    await client.close()
  })

  it('still applies the caps without elicitation, before anything is sent', async () => {
    process.env.BRAY_MAX_PAYMENT_MSAT = '999'
    const wallet = createMockWallet({ balance: 500_000 })
    const { client } = await connect(null, wallet)
    const result = await call(client, 'zap-send', { invoice: SETTLED_INVOICE, confirm: true })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/BRAY_MAX_PAYMENT_MSAT/)
    expect(payments(wallet)).toHaveLength(0)
    await client.close()
  })

  it('does not ask the human to approve a payment the caps would refuse', async () => {
    process.env.BRAY_MAX_PAYMENT_MSAT = '999'
    const wallet = createMockWallet({ balance: 500_000 })
    const { client, asked } = await connect('approve', wallet)
    const result = await call(client, 'zap-send', { invoice: SETTLED_INVOICE, confirm: true })
    expect(result.isError).toBe(true)
    expect(asked).toHaveLength(0)
    await client.close()
  })

  it('asks before marketplace-pay spends too', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const { client, asked } = await connect('decline', wallet)
    const result = await call(client, 'marketplace-pay', {
      url: 'https://api.example.com/paid',
      macaroon: 'AgEEbHNhdAJCAAA=',
      invoice: SETTLED_INVOICE,
      confirm: true,
    })
    expect(JSON.parse(result.text)).toMatchObject({ paid: false, declined: true })
    expect(asked).toHaveLength(1)
    expect(payments(wallet)).toHaveLength(0)
    await client.close()
  })
})
