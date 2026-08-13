import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdentityContext } from '../../src/context.js'
import {
  handleZapBalance,
  handleZapDecode,
  handleZapListTransactions,
  handleZapLookupInvoice,
  handleZapMakeInvoice,
  handleZapReceipts,
  handleZapSend,
  loadWallets,
  parseNwcUri,
  resolveNwcUri,
  saveWallets,
} from '../../src/zap/handlers.js'
import { normaliseNwcUriFile, readNwcUriFile } from '../../src/zap/nwc-file.js'
import { buildNwcUri, createMockWallet } from './mock-nwc-wallet.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const CLIENT_SECRET = 'a3'.repeat(32)
const SETTLED_INVOICE = 'lnbc10n1pj48ugqpp5urnh55r5z2cjpahduc0ky22mrfajluva8hxg7ujnu5txx3cv3z8qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgp0xzz'
const AMOUNTLESS_INVOICE =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmw' +
  'wd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz' +
  '9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'
const PAYMENT_HASH = 'e0e77a507412b120f6ede61f62295b1a7b2ff19d3dcc8f7253e51663470c888e'

function publicPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn(),
  }
}

describe('zap handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('validates NWC connections without exposing their secret', () => {
    const wallet = createMockWallet()
    const uri = buildNwcUri(wallet.pubkey, CLIENT_SECRET)
    const connection = parseNwcUri(uri)
    expect(connection).toMatchObject({ pubkey: wallet.pubkey, relay: 'wss://mock.relay/' })
    expect(JSON.stringify(connection)).not.toContain(CLIENT_SECRET)
    expect(() => parseNwcUri('nostr+walletconnect://pubkey')).toThrow(/invalid/i)
  })

  it('stores only private secret-file references and fails closed on unsafe state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bray-nwc-files-'))
    try {
      const uri = buildNwcUri(createMockWallet().pubkey, CLIENT_SECRET)
      const secretFile = join(directory, 'wallet.nwc')
      const registryFile = join(directory, 'wallets.json')
      writeFileSync(secretFile, `${uri}\n`, { mode: 0o600 })

      const normalised = normaliseNwcUriFile(secretFile)
      expect(readNwcUriFile(normalised)).toBe(uri)
      saveWallets(registryFile, { [ctx.activePublicKeyHex]: normalised })

      const registryText = readFileSync(registryFile, 'utf-8')
      expect(registryText).toContain(normalised)
      expect(registryText).not.toContain('nostr+walletconnect:')
      expect(registryText).not.toContain(CLIENT_SECRET)
      expect(statSync(registryFile).mode & 0o777).toBe(0o600)
      expect(loadWallets(registryFile)).toEqual({ [ctx.activePublicKeyHex]: normalised })
      expect(resolveNwcUri(ctx, registryFile, 'fallback-must-not-be-used')).toBe(uri)

      writeFileSync(registryFile, '{"wallets":{}}\n', { mode: 0o600 })
      expect(() => resolveNwcUri(ctx, registryFile, 'fallback-must-not-be-used')).toThrow('unsupported or unsafe format')

      if (process.platform !== 'win32') {
        chmodSync(secretFile, 0o644)
        expect(() => readNwcUriFile(secretFile)).toThrow('chmod 600')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses wallet operations when no NWC connection is configured', async () => {
    await expect(handleZapSend(ctx, publicPool() as any, { invoice: SETTLED_INVOICE })).rejects.toThrow(/wallet not configured/i)
    await expect(handleZapBalance(ctx, publicPool() as any, {})).rejects.toThrow(/wallet not configured/i)
    await expect(handleZapMakeInvoice(ctx, publicPool() as any, { amountMsats: 1000 })).rejects.toThrow(/wallet not configured/i)
  })

  it('reports payment only after receiving and verifying the wallet preimage', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const result = await handleZapSend(ctx, publicPool() as any, {
      invoice: SETTLED_INVOICE,
      nwcUri: buildNwcUri(wallet.pubkey, CLIENT_SECRET),
      transport: wallet.transport,
    })

    expect(result).toEqual({
      preimage: 'aa'.repeat(32),
      fees_paid: 1000,
      paymentHash: PAYMENT_HASH,
      verified: true,
    })
    expect(wallet.history).toMatchObject([{ method: 'pay_invoice', params: { invoice: SETTLED_INVOICE } }])
  })

  it('refuses amountless invoices without an explicit amount policy', async () => {
    const wallet = createMockWallet()
    await expect(handleZapSend(ctx, publicPool() as any, {
      invoice: AMOUNTLESS_INVOICE,
      nwcUri: buildNwcUri(wallet.pubkey, CLIENT_SECRET),
      transport: wallet.transport,
    })).rejects.toThrow('Amountless BOLT-11 invoices are refused')
    expect(wallet.history).toHaveLength(0)
  })

  it('returns authenticated results for the other wallet operations', async () => {
    const wallet = createMockWallet({ balance: 500_000 })
    const nwcUri = buildNwcUri(wallet.pubkey, CLIENT_SECRET)
    const common = { nwcUri, transport: wallet.transport }

    await expect(handleZapBalance(ctx, publicPool() as any, common)).resolves.toEqual({ balance: 500_000 })
    await expect(handleZapMakeInvoice(ctx, publicPool() as any, {
      ...common,
      amountMsats: 50_000,
      description: 'test invoice',
    })).resolves.toMatchObject({ invoice: 'lnbc50000n1mock', payment_hash: 'b'.repeat(64) })
    await expect(handleZapLookupInvoice(ctx, publicPool() as any, {
      ...common,
      paymentHash: PAYMENT_HASH,
    })).resolves.toMatchObject({ preimage: 'c'.repeat(64) })
    await expect(handleZapListTransactions(ctx, publicPool() as any, {
      ...common,
      limit: 5,
    })).resolves.toMatchObject({ transactions: [{ type: 'incoming' }] })
  })

  describe('zap receipts', () => {
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
      const result = await handleZapReceipts(ctx, publicPool([zapReceipt]) as any)
      expect(result).toMatchObject([{ amountMsats: 50_000, sender: 'sender1', message: 'great!' }])
    })

    it('handles malformed zap receipt descriptions', async () => {
      const badReceipt = {
        kind: 9735,
        pubkey: 'zapnode',
        created_at: 1000,
        tags: [['description', 'not-json']],
        content: '',
        id: 'bad1',
        sig: 'sig1',
      }
      const result = await handleZapReceipts(ctx, publicPool([badReceipt]) as any)
      expect(result[0]?.sender).toBeUndefined()
    })
  })

  it('decodes only structurally valid BOLT-11 invoices', () => {
    expect(handleZapDecode(SETTLED_INVOICE)).toMatchObject({ amountMsats: 1000, expiry: 3600 })
    expect(handleZapDecode('lnbc10u1...')).toEqual({})
    expect(handleZapDecode('not-a-bolt11')).toEqual({})
  })
})
