import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// --- Per-Identity Wallet Store ---

interface WalletsData {
  wallets: Record<string, string>
}

/**
 * Load the wallets map from the JSON file. Returns empty map if file missing.
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @returns A map of public key hex strings to NWC URIs.
 *
 * @example
 * const wallets = loadWallets('/home/user/.bray/wallets.json')
 * // { 'abc123...': 'nostr+walletconnect://...' }
 */
export function loadWallets(walletsFile: string): Record<string, string> {
  if (!walletsFile || !existsSync(walletsFile)) return {}
  try {
    const data: WalletsData = JSON.parse(readFileSync(walletsFile, 'utf-8'))
    return data.wallets ?? {}
  } catch {
    return {}
  }
}

/**
 * Save the wallets map to the JSON file. Creates parent dirs and sets 0600.
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @param wallets - Map of public key hex strings to NWC URIs to persist.
 * @returns void
 *
 * @example
 * saveWallets('/home/user/.bray/wallets.json', {
 *   'abc123...': 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=deadbeef',
 * })
 */
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
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @param globalNwcUri - Optional fallback NWC URI used when no per-identity wallet is found.
 * @returns The resolved NWC URI, or `undefined` if no wallet is configured.
 *
 * @example
 * const uri = resolveNwcUri(ctx, '/home/user/.bray/wallets.json', process.env.NWC_URI)
 * if (!uri) throw new Error('No wallet configured')
 */
export function resolveNwcUri(
  ctx: SigningContext,
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

/**
 * Parse a nostr+walletconnect:// URI.
 *
 * @param uri - A `nostr+walletconnect://` URI as specified in NIP-47.
 * @returns A parsed {@link NwcConnection} containing the wallet pubkey, relay URL, and connection secret.
 * @throws {Error} If `pubkey`, `relay`, or `secret` are missing from the URI.
 *
 * @example
 * const conn = parseNwcUri(
 *   'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * )
 * // { pubkey: 'abc123', relay: 'wss://relay.example', secret: 'deadbeef' }
 */
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

/**
 * Parse zap receipts (kind 9735) for the active identity.
 *
 * @param opts - Optional query constraints.
 * @param opts.since - Unix timestamp (seconds); only receipts after this time are returned.
 * @param opts.limit - Maximum number of receipts to return (default 20).
 * @returns A list of {@link ZapReceipt} objects, newest first.
 *
 * @example
 * const receipts = await handleZapReceipts(ctx, pool, { limit: 5, since: 1700000000 })
 * receipts.forEach(r => console.log(`${r.amountMsats} msats from ${r.sender}`))
 */
export async function handleZapReceipts(
  ctx: SigningContext,
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

/**
 * Decode basic bolt11 invoice fields.
 *
 * @param bolt11 - A BOLT-11 Lightning invoice string (e.g. `lnbc...`).
 * @returns An object with the decoded fields. `amountMsats` is present when the
 *   amount is encoded in the invoice prefix; `description` and `expiry` are not
 *   yet decoded and will be absent in the current implementation.
 *
 * @example
 * const { amountMsats } = handleZapDecode('lnbc1000n1...')
 * console.log(`Invoice is for ${amountMsats} msats`)
 */
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

/**
 * Pay a Lightning invoice via NWC.
 *
 * @param args - Payment arguments.
 * @param args.invoice - BOLT-11 Lightning invoice to pay.
 * @param args.nwcUri - NWC URI identifying the wallet to use.
 * @returns The signed NIP-47 request event and relay publish result.
 * @throws {Error} If `nwcUri` is not provided.
 *
 * @example
 * const { event, publish } = await handleZapSend(ctx, pool, {
 *   invoice: 'lnbc500n1...',
 *   nwcUri: 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * })
 */
export async function handleZapSend(
  ctx: SigningContext,
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

/**
 * Request wallet balance via NWC.
 *
 * @param args - Balance request arguments.
 * @param args.nwcUri - NWC URI identifying the wallet to query.
 * @returns The signed NIP-47 `get_balance` request event and relay publish result.
 * @throws {Error} If `nwcUri` is not provided.
 *
 * @example
 * const { event, publish } = await handleZapBalance(ctx, pool, {
 *   nwcUri: 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * })
 */
export async function handleZapBalance(
  ctx: SigningContext,
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

/**
 * Generate a Lightning invoice via NWC.
 *
 * @param args - Invoice creation arguments.
 * @param args.amountMsats - Invoice amount in millisatoshis.
 * @param args.description - Optional human-readable memo attached to the invoice.
 * @param args.nwcUri - NWC URI identifying the wallet to use.
 * @returns The signed NIP-47 `make_invoice` request event and relay publish result.
 * @throws {Error} If `nwcUri` is not provided.
 *
 * @example
 * const { event, publish } = await handleZapMakeInvoice(ctx, pool, {
 *   amountMsats: 21_000,
 *   description: 'Coffee ☕',
 *   nwcUri: 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * })
 */
export async function handleZapMakeInvoice(
  ctx: SigningContext,
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

/**
 * Look up an invoice via NWC.
 *
 * @param args - Lookup arguments. Provide at least one of `paymentHash` or `invoice`.
 * @param args.paymentHash - Hex-encoded payment hash of the invoice to look up.
 * @param args.invoice - BOLT-11 invoice string to look up.
 * @param args.nwcUri - NWC URI identifying the wallet to query.
 * @returns The signed NIP-47 `lookup_invoice` request event and relay publish result.
 * @throws {Error} If `nwcUri` is not provided.
 *
 * @example
 * const { event, publish } = await handleZapLookupInvoice(ctx, pool, {
 *   paymentHash: 'a1b2c3...',
 *   nwcUri: 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * })
 */
export async function handleZapLookupInvoice(
  ctx: SigningContext,
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

/**
 * List recent transactions via NWC.
 *
 * @param args - Pagination arguments.
 * @param args.limit - Maximum number of transactions to return (default 10).
 * @param args.offset - Number of transactions to skip for pagination (default 0).
 * @param args.nwcUri - NWC URI identifying the wallet to query.
 * @returns The signed NIP-47 `list_transactions` request event and relay publish result.
 * @throws {Error} If `nwcUri` is not provided.
 *
 * @example
 * const { event, publish } = await handleZapListTransactions(ctx, pool, {
 *   limit: 5,
 *   offset: 0,
 *   nwcUri: 'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * })
 */
export async function handleZapListTransactions(
  ctx: SigningContext,
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

/**
 * Parse a NWC wallet response event.
 *
 * @param nwcUri - The NWC URI whose secret is used to decrypt the response.
 * @param event - A kind 23195 NIP-47 response event from the wallet service.
 * @returns The decrypted response payload containing `result_type`, an optional
 *   `result` object, and an optional `error` with `code` and `message`.
 *
 * @example
 * const response = handleZapParseResponse(
 *   'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 *   walletResponseEvent,
 * )
 * if (response.error) console.error(response.error.message)
 * else console.log(response.result)
 */
export function handleZapParseResponse(
  nwcUri: string,
  event: NostrEvent,
): { result_type: string; result?: Record<string, unknown>; error?: { code: string; message: string } } {
  const conn = parseNwcUri(nwcUri)
  return decryptNwcResponse(conn, event)
}
