import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// --- Per-Identity Wallet Store ---

interface WalletsData {
  wallets: Record<string, string>
}

/** Load the wallets map from the JSON file. Returns empty map if file missing. */
export function loadWallets(walletsFile: string): Record<string, string> {
  if (!walletsFile || !existsSync(walletsFile)) return {}
  try {
    const data: WalletsData = JSON.parse(readFileSync(walletsFile, 'utf-8'))
    return data.wallets ?? {}
  } catch {
    return {}
  }
}

/** Save the wallets map to the JSON file. Creates parent dirs and sets 0600. */
export function saveWallets(walletsFile: string, wallets: Record<string, string>): void {
  const dir = dirname(walletsFile)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const data: WalletsData = { wallets }
  writeFileSync(walletsFile, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
}

/**
 * Resolve the NWC URI for the active identity.
 * 1. Per-identity wallet from wallets file
 * 2. Global NWC URI (fallback)
 * 3. undefined (no wallet configured)
 */
export function resolveNwcUri(
  ctx: IdentityContext,
  walletsFile: string,
  globalNwcUri?: string,
): string | undefined {
  const pubkey = ctx.activePublicKeyHex
  const wallets = loadWallets(walletsFile)
  return wallets[pubkey] ?? globalNwcUri
}

// --- NWC Connection ---

export interface NwcConnection {
  pubkey: string
  relay: string
  secret: string
}

/** Parse a nostr+walletconnect:// URI */
export function parseNwcUri(uri: string): NwcConnection {
  const url = new URL(uri)
  const pubkey = url.hostname || url.pathname.replace('//', '')
  const relay = url.searchParams.get('relay')
  const secret = url.searchParams.get('secret')
  if (!pubkey || !relay || !secret) {
    throw new Error('Invalid NWC URI: missing pubkey, relay, or secret')
  }
  return { pubkey, relay, secret }
}

/** Build an encrypted NIP-47 request event (kind 23194) */
function buildNwcRequest(
  conn: NwcConnection,
  method: string,
  params: Record<string, unknown>,
): NostrEvent {
  const secretBytes = Buffer.from(conn.secret, 'hex')
  try {
    const conversationKey = getConversationKey(secretBytes, conn.pubkey)

    const content = encrypt(
      JSON.stringify({ method, params }),
      conversationKey,
    )

    const event = finalizeEvent({
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', conn.pubkey]],
      content,
    }, secretBytes) as unknown as NostrEvent

    return event
  } finally {
    secretBytes.fill(0)
  }
}

/** Decrypt a NIP-47 response event (kind 23195) */
function decryptNwcResponse(
  conn: NwcConnection,
  event: NostrEvent,
): { result_type: string; result?: Record<string, unknown>; error?: { code: string; message: string } } {
  const secretBytes = Buffer.from(conn.secret, 'hex')
  try {
    const conversationKey = getConversationKey(secretBytes, conn.pubkey)
    const plaintext = decrypt(event.content, conversationKey)
    try {
      return JSON.parse(plaintext)
    } catch {
      throw new Error('NWC response is not valid JSON')
    }
  } finally {
    secretBytes.fill(0)
  }
}

// --- Zap Receipts ---

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
  const { decode } = await import('nostr-tools/nip19')
  const activeHex = decode(ctx.activeNpub).data as string
  const events = await pool.query(ctx.activeNpub, {
    kinds: [9735],
    '#p': [activeHex],
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

// --- Bolt11 Decode ---

/** Decode basic bolt11 invoice fields */
export function handleZapDecode(bolt11: string): {
  amountMsats?: number
  description?: string
  expiry?: number
} {
  const result: { amountMsats?: number; description?: string; expiry?: number } = {}

  const match = bolt11.match(/^ln(?:bc|tb|tbs)(\d+)([munp])?/)
  if (match) {
    const num = parseInt(match[1], 10)
    const multiplier = match[2]
    const multipliers: Record<string, number> = {
      'm': 100_000_000,
      'u': 100_000,
      'n': 100,
      'p': 0.1,
    }
    if (multiplier && multipliers[multiplier]) {
      result.amountMsats = Math.round(num * multipliers[multiplier])
    }
  }

  return result
}

// --- NWC Operations ---

/** Pay a Lightning invoice via NWC */
export async function handleZapSend(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { invoice: string; nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured. Set NWC_URI or NWC_URI_FILE to enable zap sending.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const event = buildNwcRequest(conn, 'pay_invoice', { invoice: args.invoice })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Request wallet balance via NWC */
export async function handleZapBalance(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured. Set NWC_URI or NWC_URI_FILE to check balance.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const event = buildNwcRequest(conn, 'get_balance', {})
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Generate a Lightning invoice via NWC */
export async function handleZapMakeInvoice(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { amountMsats: number; description?: string; nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured. Set NWC_URI or NWC_URI_FILE to create invoices.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const event = buildNwcRequest(conn, 'make_invoice', {
    amount: args.amountMsats,
    description: args.description,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Look up an invoice via NWC */
export async function handleZapLookupInvoice(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { paymentHash?: string; invoice?: string; nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const params: Record<string, unknown> = {}
  if (args.paymentHash) params.payment_hash = args.paymentHash
  if (args.invoice) params.invoice = args.invoice
  const event = buildNwcRequest(conn, 'lookup_invoice', params)
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** List recent transactions via NWC */
export async function handleZapListTransactions(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { limit?: number; offset?: number; nwcUri?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.nwcUri) {
    throw new Error('Wallet not configured.')
  }

  const conn = parseNwcUri(args.nwcUri)
  const event = buildNwcRequest(conn, 'list_transactions', {
    limit: args.limit ?? 10,
    offset: args.offset ?? 0,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Parse a NWC wallet response event */
export function handleZapParseResponse(
  nwcUri: string,
  event: NostrEvent,
): { result_type: string; result?: Record<string, unknown>; error?: { code: string; message: string } } {
  const conn = parseNwcUri(nwcUri)
  return decryptNwcResponse(conn, event)
}
