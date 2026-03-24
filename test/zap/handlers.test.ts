import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleZapReceipts,
  handleZapDecode,
  handleZapSend,
  handleZapBalance,
  handleZapMakeInvoice,
  handleZapLookupInvoice,
  handleZapListTransactions,
  handleZapParseResponse,
  parseNwcUri,
} from '../../src/zap/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
// Use the test key's own hex for NWC secret (valid secp256k1 scalar)
const NWC_SECRET = 'c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
const NWC_WALLET_PUBKEY = '818b1ff78425c45464e7400d764ffc980dfdf522787e0c0309036b52933fece4'
const NWC_URI = `nostr+walletconnect://${NWC_WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${NWC_SECRET}`

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('zap handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // --- NWC URI parsing ---

  describe('parseNwcUri', () => {
    it('parses valid NWC URI', () => {
      const conn = parseNwcUri(NWC_URI)
      expect(conn.pubkey).toBe(NWC_WALLET_PUBKEY)
      expect(conn.relay).toBe('wss://relay.example.com')
      expect(conn.secret).toBe(NWC_SECRET)
    })

    it('throws on missing components', () => {
      expect(() => parseNwcUri('nostr+walletconnect://pubkey')).toThrow(/missing/)
    })
  })

  // --- NWC pay_invoice ---

  describe('handleZapSend', () => {
    it('errors when NWC not configured', async () => {
      const pool = mockPool()
      await expect(handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1...',
      })).rejects.toThrow(/wallet not configured/i)
    })

    it('creates kind 23194 NWC request event', async () => {
      const pool = mockPool()
      const result = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1pjtest',
        nwcUri: NWC_URI,
      })
      expect(result.event.kind).toBe(23194)
      expect(result.event.content).toBeDefined()
      expect(result.event.content.length).toBeGreaterThan(0)
      // p-tag should reference the wallet service
      const pTag = result.event.tags.find(t => t[0] === 'p')
      expect(pTag![1]).toBe(NWC_WALLET_PUBKEY)
      expect(pool.publish).toHaveBeenCalled()
    })

    it('signs with the NWC client key, not the identity key', async () => {
      const pool = mockPool()
      const result = await handleZapSend(ctx, pool as any, {
        invoice: 'lnbc10u1pjtest',
        nwcUri: NWC_URI,
      })
      // The event pubkey should be the NWC client pubkey (derived from NWC_SECRET)
      // NOT the identity's pubkey
      const { getPublicKey } = await import('nostr-tools/pure')
      const expectedPubkey = getPublicKey(Buffer.from(NWC_SECRET, 'hex'))
      expect(result.event.pubkey).toBe(expectedPubkey)
    })
  })

  // --- NWC get_balance ---

  describe('handleZapBalance', () => {
    it('errors when NWC not configured', async () => {
      const pool = mockPool()
      await expect(handleZapBalance(ctx, pool as any, {}))
        .rejects.toThrow(/wallet not configured/i)
    })

    it('creates kind 23194 get_balance request', async () => {
      const pool = mockPool()
      const result = await handleZapBalance(ctx, pool as any, { nwcUri: NWC_URI })
      expect(result.event.kind).toBe(23194)
    })
  })

  // --- NWC make_invoice ---

  describe('handleZapMakeInvoice', () => {
    it('errors when NWC not configured', async () => {
      const pool = mockPool()
      await expect(handleZapMakeInvoice(ctx, pool as any, { amountMsats: 10000 }))
        .rejects.toThrow(/wallet not configured/i)
    })

    it('creates kind 23194 make_invoice request', async () => {
      const pool = mockPool()
      const result = await handleZapMakeInvoice(ctx, pool as any, {
        amountMsats: 50000,
        description: 'test invoice',
        nwcUri: NWC_URI,
      })
      expect(result.event.kind).toBe(23194)
    })
  })

  // --- NWC lookup_invoice ---

  describe('handleZapLookupInvoice', () => {
    it('creates lookup request with payment hash', async () => {
      const pool = mockPool()
      const result = await handleZapLookupInvoice(ctx, pool as any, {
        paymentHash: 'abc123',
        nwcUri: NWC_URI,
      })
      expect(result.event.kind).toBe(23194)
    })
  })

  // --- NWC list_transactions ---

  describe('handleZapListTransactions', () => {
    it('creates list_transactions request', async () => {
      const pool = mockPool()
      const result = await handleZapListTransactions(ctx, pool as any, {
        limit: 5,
        nwcUri: NWC_URI,
      })
      expect(result.event.kind).toBe(23194)
    })
  })

  // --- NWC response parsing ---

  describe('handleZapParseResponse', () => {
    it('decrypts and parses a NWC response', async () => {
      // Build a fake response by encrypting with the same keys
      const { getConversationKey, encrypt } = await import('nostr-tools/nip44')
      const { finalizeEvent, generateSecretKey } = await import('nostr-tools/pure')

      const walletSk = generateSecretKey()
      const clientSecretBytes = Buffer.from(NWC_SECRET, 'hex')
      const { getPublicKey } = await import('nostr-tools/pure')
      const clientPubkey = getPublicKey(clientSecretBytes)

      // Wallet encrypts response to the client
      const conversationKey = getConversationKey(walletSk, clientPubkey)
      const payload = JSON.stringify({
        result_type: 'get_balance',
        result: { balance: 100000 },
      })
      const encrypted = encrypt(payload, conversationKey)

      const walletPubkey = getPublicKey(walletSk)
      const responseEvent = finalizeEvent({
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', clientPubkey], ['e', 'request-event-id']],
        content: encrypted,
      }, walletSk) as any

      // Build a URI pointing to this wallet's pubkey
      const testUri = `nostr+walletconnect://${walletPubkey}?relay=wss%3A%2F%2Frelay.example.com&secret=${NWC_SECRET}`
      const parsed = handleZapParseResponse(testUri, responseEvent)
      expect(parsed.result_type).toBe('get_balance')
      expect(parsed.result!.balance).toBe(100000)
    })
  })

  // --- Zap receipts ---

  describe('handleZapReceipts', () => {
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
      const pool = mockPool([zapReceipt])
      const result = await handleZapReceipts(ctx, pool as any)
      expect(result.length).toBe(1)
      expect(result[0].amountMsats).toBe(50000)
      expect(result[0].sender).toBe('sender1')
      expect(result[0].message).toBe('great!')
    })

    it('handles malformed zap receipt gracefully', async () => {
      const badReceipt = {
        kind: 9735,
        pubkey: 'zapnode',
        created_at: 1000,
        tags: [['description', 'not-json']],
        content: '',
        id: 'bad1',
        sig: 'sig1',
      }
      const pool = mockPool([badReceipt])
      const result = await handleZapReceipts(ctx, pool as any)
      expect(result.length).toBe(1)
      expect(result[0].sender).toBeUndefined()
      expect(result[0].amountMsats).toBeUndefined()
    })
  })

  // --- Bolt11 decode ---

  describe('handleZapDecode', () => {
    it('decodes amount from lnbc with u multiplier', () => {
      expect(handleZapDecode('lnbc10u1...').amountMsats).toBe(1_000_000)
    })

    it('decodes amount from lnbc with m multiplier', () => {
      expect(handleZapDecode('lnbc1m1...').amountMsats).toBe(100_000_000)
    })

    it('decodes amount from lnbc with n multiplier', () => {
      expect(handleZapDecode('lnbc500n1...').amountMsats).toBe(50_000)
    })

    it('decodes testnet lntb prefix', () => {
      expect(handleZapDecode('lntb10u1...').amountMsats).toBe(1_000_000)
    })

    it('returns empty for unrecognised format', () => {
      expect(handleZapDecode('not-a-bolt11').amountMsats).toBeUndefined()
    })
  })
})
