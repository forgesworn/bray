/**
 * NWC Round-Trip Integration Tests
 *
 * Tests the full NIP-47 cycle:
 *   Client builds request → NIP-44 encrypt → Mock wallet decrypts →
 *   Wallet processes → NIP-44 encrypt response → Client decrypts
 *
 * No real Lightning, no external relays. Proves the crypto works end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleZapSend,
  handleZapBalance,
  handleZapMakeInvoice,
  handleZapLookupInvoice,
  handleZapListTransactions,
  handleZapParseResponse,
} from '../../src/zap/handlers.js'
import { createMockWallet, buildNwcUri } from './mock-nwc-wallet.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
// NWC client secret — must be DIFFERENT from the identity key (TEST_NSEC)
const CLIENT_SECRET = 'a3f19ad618bcd6c58b892dfed6d20e5980c4ec11709c2d65718d3d653be9d397'

describe('NWC round-trip integration', () => {
  let ctx: IdentityContext
  let wallet: ReturnType<typeof createMockWallet>
  let nwcUri: string

  // Pool that captures published events and feeds them to the mock wallet
  function createNwcPool() {
    return {
      query: vi.fn().mockResolvedValue([]),
      publish: vi.fn().mockImplementation(async (_npub: string, event: any) => {
        return { success: true, allAccepted: true, accepted: ['wss://mock.relay'], rejected: [], errors: [] }
      }),
      getRelays: vi.fn().mockReturnValue({ read: ['wss://mock.relay'], write: ['wss://mock.relay'] }),
    }
  }

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    wallet = createMockWallet({ balance: 500_000 }) // 500 sats
    nwcUri = buildNwcUri(wallet.pubkey, CLIENT_SECRET)
  })

  describe('pay_invoice', () => {
    it('full round-trip: client encrypts → wallet decrypts → wallet responds → client decrypts', async () => {
      const pool = createNwcPool()

      // 1. Client builds and publishes the request
      const { event: requestEvent } = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1pjrealinvoice',
        nwcUri,
      })
      expect(requestEvent.kind).toBe(23194)

      // 2. Mock wallet processes the request (decrypts, validates, builds response)
      const responseEvent = wallet.processRequest(requestEvent)
      expect(responseEvent.kind).toBe(23195)

      // 3. Client decrypts the response
      const parsed = handleZapParseResponse(nwcUri, responseEvent)
      expect(parsed.result_type).toBe('pay_invoice')
      expect(parsed.result!.preimage).toBeDefined()
      expect(parsed.error).toBeUndefined()

      // 4. Wallet actually processed the method
      expect(wallet.history.length).toBe(1)
      expect(wallet.history[0].method).toBe('pay_invoice')
      expect(wallet.history[0].params.invoice).toBe('lnbc10u1pjrealinvoice')
    })

    it('wallet deducts balance on successful payment', async () => {
      const pool = createNwcPool()
      const balanceBefore = wallet.balance

      const { event } = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc1test',
        nwcUri,
      })
      wallet.processRequest(event)

      expect(wallet.balance).toBeLessThan(balanceBefore)
    })

    it('wallet returns error when insufficient balance', async () => {
      const brokewallet = createMockWallet({ balance: 0 })
      const brokeUri = buildNwcUri(brokewallet.pubkey, CLIENT_SECRET)
      const pool = createNwcPool()

      const { event } = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc1test',
        nwcUri: brokeUri,
      })
      const response = brokewallet.processRequest(event)
      const parsed = handleZapParseResponse(brokeUri, response)

      expect(parsed.error).toBeDefined()
      expect(parsed.error!.code).toBe('INSUFFICIENT_BALANCE')
    })
  })

  describe('get_balance', () => {
    it('round-trip returns wallet balance', async () => {
      const pool = createNwcPool()

      const { event } = await handleZapBalance(ctx, pool as any, { nwcUri })
      const response = wallet.processRequest(event)
      const parsed = handleZapParseResponse(nwcUri, response)

      expect(parsed.result_type).toBe('get_balance')
      expect(parsed.result!.balance).toBe(500_000)
    })
  })

  describe('make_invoice', () => {
    it('round-trip creates invoice', async () => {
      const pool = createNwcPool()

      const { event } = await handleZapMakeInvoice(ctx, pool as any, {
        amountMsats: 100_000,
        description: 'test zap',
        nwcUri,
      })
      const response = wallet.processRequest(event)
      const parsed = handleZapParseResponse(nwcUri, response)

      expect(parsed.result_type).toBe('make_invoice')
      expect(parsed.result!.invoice).toBeDefined()
      expect(parsed.result!.payment_hash).toBeDefined()

      // Verify wallet saw the correct params
      expect(wallet.history[0].params.amount).toBe(100_000)
      expect(wallet.history[0].params.description).toBe('test zap')
    })
  })

  describe('lookup_invoice', () => {
    it('round-trip looks up invoice status', async () => {
      const pool = createNwcPool()

      const { event } = await handleZapLookupInvoice(ctx, pool as any, {
        paymentHash: 'abc123',
        nwcUri,
      })
      const response = wallet.processRequest(event)
      const parsed = handleZapParseResponse(nwcUri, response)

      expect(parsed.result_type).toBe('lookup_invoice')
      expect(parsed.result!.paid).toBe(true)
    })
  })

  describe('list_transactions', () => {
    it('round-trip lists transactions', async () => {
      const pool = createNwcPool()

      const { event } = await handleZapListTransactions(ctx, pool as any, {
        limit: 5,
        nwcUri,
      })
      const response = wallet.processRequest(event)
      const parsed = handleZapParseResponse(nwcUri, response)

      expect(parsed.result_type).toBe('list_transactions')
      const txs = parsed.result!.transactions as any[]
      expect(txs.length).toBeGreaterThan(0)
      expect(txs[0].type).toBe('incoming')
    })
  })

  describe('multiple operations', () => {
    it('sequential operations maintain wallet state', async () => {
      const pool = createNwcPool()

      // Check balance
      const balReq = await handleZapBalance(ctx, pool as any, { nwcUri })
      const balResp = wallet.processRequest(balReq.event)
      const bal = handleZapParseResponse(nwcUri, balResp)
      expect(bal.result!.balance).toBe(500_000)

      // Pay invoice
      const payReq = await handleZapSend(ctx, pool as any, { invoice: 'lnbc1test', nwcUri })
      wallet.processRequest(payReq.event)

      // Check balance again — should be lower
      const bal2Req = await handleZapBalance(ctx, pool as any, { nwcUri })
      const bal2Resp = wallet.processRequest(bal2Req.event)
      const bal2 = handleZapParseResponse(nwcUri, bal2Resp)
      expect(bal2.result!.balance).toBeLessThan(500_000)

      // Wallet should have 3 operations in history
      expect(wallet.history.length).toBe(3)
      expect(wallet.history.map(h => h.method)).toEqual([
        'get_balance',
        'pay_invoice',
        'get_balance',
      ])
    })
  })

  describe('crypto correctness', () => {
    it('request event is signed by NWC client key, not identity key', async () => {
      const pool = createNwcPool()
      const { getPublicKey } = await import('nostr-tools/pure')
      const expectedClientPubkey = getPublicKey(Buffer.from(CLIENT_SECRET, 'hex'))

      const { event } = await handleZapSend(ctx, pool as any, { invoice: 'lnbc1test', nwcUri })
      expect(event.pubkey).toBe(expectedClientPubkey)
      // Must NOT be the identity's pubkey
      const { decode } = await import('nostr-tools/nip19')
      const identityHex = decode(ctx.activeNpub).data as string
      expect(event.pubkey).not.toBe(identityHex)
    })

    it('request p-tag references the wallet service pubkey', async () => {
      const pool = createNwcPool()
      const { event } = await handleZapSend(ctx, pool as any, { invoice: 'lnbc1test', nwcUri })
      const pTag = event.tags.find(t => t[0] === 'p')
      expect(pTag![1]).toBe(wallet.pubkey)
    })

    it('response e-tag references the request event id', async () => {
      const pool = createNwcPool()
      const { event: reqEvent } = await handleZapSend(ctx, pool as any, { invoice: 'lnbc1test', nwcUri })
      const respEvent = wallet.processRequest(reqEvent)
      const eTag = respEvent.tags.find(t => t[0] === 'e')
      expect(eTag![1]).toBe(reqEvent.id)
    })

    it('content is NIP-44 encrypted (not plaintext)', async () => {
      const pool = createNwcPool()
      const { event } = await handleZapSend(ctx, pool as any, { invoice: 'lnbc1test', nwcUri })
      // NIP-44 v2 payloads are base64-encoded, not JSON
      expect(() => JSON.parse(event.content)).toThrow()
      expect(event.content.length).toBeGreaterThan(0)
    })
  })
})
