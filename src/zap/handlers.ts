import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

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
