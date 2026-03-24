import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface ZapReceipt {
  id: string
  sender?: string
  amountMsats?: number
  message?: string
  createdAt: number
}

/** Parse zap receipts (kind 9735) for the active identity */
export async function handleZapReceipts(
  ctx: IdentityContext,
  pool: RelayPool,
  opts?: { since?: number; limit?: number },
): Promise<ZapReceipt[]> {
  const events = await pool.query(ctx.activeNpub, {
    kinds: [9735],
    '#p': [ctx.activeNpub],
    limit: opts?.limit ?? 20,
    ...(opts?.since ? { since: opts.since } : {}),
  })

  return events.map(parseZapReceipt)
}

function parseZapReceipt(event: NostrEvent): ZapReceipt {
  const result: ZapReceipt = {
    id: event.id,
    createdAt: event.created_at,
  }

  const descTag = event.tags.find(t => t[0] === 'description')
  if (descTag?.[1]) {
    try {
      const zapReq = JSON.parse(descTag[1])
      result.sender = zapReq.pubkey
      result.message = zapReq.content
      const amountTag = zapReq.tags?.find((t: string[]) => t[0] === 'amount')
      if (amountTag?.[1]) {
        result.amountMsats = parseInt(amountTag[1], 10)
      }
    } catch { /* malformed zap request */ }
  }

  return result
}

/** Decode basic bolt11 invoice fields */
export function handleZapDecode(bolt11: string): {
  amountMsats?: number
  description?: string
  expiry?: number
} {
  // Basic bolt11 prefix parsing — amount is encoded in the human-readable part
  // Full decode requires a bolt11 library; this extracts what we can
  const result: { amountMsats?: number; description?: string; expiry?: number } = {}

  // Extract amount from human-readable part: lnbc<amount><multiplier>
  const match = bolt11.match(/^ln(?:bc|tb|tbs)(\d+)([munp])?/)
  if (match) {
    const num = parseInt(match[1], 10)
    const multiplier = match[2]
    const satsMultipliers: Record<string, number> = {
      'm': 100_000_000, // milli-bitcoin = 0.001 BTC
      'u': 100_000,     // micro-bitcoin = 0.000001 BTC
      'n': 100,         // nano-bitcoin
      'p': 0.1,         // pico-bitcoin
    }
    if (multiplier && satsMultipliers[multiplier]) {
      result.amountMsats = Math.round(num * satsMultipliers[multiplier])
    }
  }

  return result
}

interface NwcConnection {
  pubkey: string
  relay: string
  secret: string
}

/** Parse a nostr+walletconnect:// URI */
function parseNwcUri(uri: string): NwcConnection {
  // Format: nostr+walletconnect://<pubkey>?relay=<url>&secret=<hex>
  const url = new URL(uri)
  const pubkey = url.hostname || url.pathname.replace('//', '')
  const relay = url.searchParams.get('relay')
  const secret = url.searchParams.get('secret')
  if (!pubkey || !relay || !secret) {
    throw new Error('Invalid NWC URI: missing pubkey, relay, or secret')
  }
  return { pubkey, relay, secret }
}

/** Send a zap via NWC (Nostr Wallet Connect) */
export async function handleZapSend(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { invoice: string; nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured. Set NWC_URI or NWC_URI_FILE to enable zap sending.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const { encrypt } = await import('nostr-tools/nip44')

  // Build NWC pay_invoice request (NIP-47 kind 23194)
  const conversationKey = (await import('nostr-tools/nip44')).getConversationKey(
    Buffer.from(conn.secret, 'hex'),
    conn.pubkey,
  )
  const content = encrypt(
    JSON.stringify({ method: 'pay_invoice', params: { invoice: args.invoice } }),
    conversationKey,
  )

  const sign = ctx.getSigningFunction()
  const nwcEvent = await sign({
    kind: 23194,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', conn.pubkey]],
    content,
  })

  const publish = await pool.publish(ctx.activeNpub, nwcEvent)
  return { event: nwcEvent, publish }
}

/** Get wallet balance via NWC — returns connection status */
export function handleZapBalance(
  args: { nwcUri?: string },
): { configured: boolean; walletPubkey?: string; relay?: string } {
  if (!args.nwcUri) {
    return { configured: false }
  }
  const conn = parseNwcUri(args.nwcUri)
  return { configured: true, walletPubkey: conn.pubkey, relay: conn.relay }
}
