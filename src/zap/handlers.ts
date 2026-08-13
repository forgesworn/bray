import {
  chmodSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { NwcClient, NwcError, inspectNwcConnection } from '@forgesworn/nwc-kit'
import { NwcTransactionHistoryClient } from '@forgesworn/nwc-kit/extensions/05'
import type {
  GetBalanceResult,
  NwcRequestOptions,
  NwcTransaction,
  NwcTransport,
  PayInvoiceResult,
} from '@forgesworn/nwc-kit'
import { tryDecodeBolt11, verifyPreimage } from 'farrier-kit'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import {
  readPrivateRegularFile,
  readNwcUriFile,
} from './nwc-file.js'

// --- Per-Identity Wallet Store ---

interface WalletsData {
  version: 1
  walletFiles: Record<string, string>
}

const PUBKEY_HEX = /^[0-9a-f]{64}$/i
const MAX_WALLETS_FILE_BYTES = 1_048_576
const MAX_WALLETS = 128
const MAX_PATH_CHARS = 4096

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateWalletFiles(value: unknown): Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > MAX_WALLETS) {
    throw new Error(`Wallet registry must contain at most ${MAX_WALLETS} entries`)
  }
  const walletFiles: Record<string, string> = {}
  for (const [pubkey, filePath] of Object.entries(value)) {
    if (
      !PUBKEY_HEX.test(pubkey) ||
      typeof filePath !== 'string' ||
      filePath.length === 0 ||
      filePath.length > MAX_PATH_CHARS ||
      !isAbsolute(filePath)
    ) {
      throw new Error('Wallet registry contains an invalid public key or secret-file path')
    }
    walletFiles[pubkey.toLowerCase()] = filePath
  }
  return walletFiles
}

/**
 * Load the wallets map from the JSON file. Returns empty map if file missing.
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @returns A map of public key hex strings to absolute NWC secret-file paths.
 *
 * @example
 * const wallets = loadWallets('/home/user/.bray/wallets.json')
 * // { 'abc123...': '/run/secrets/alice-nwc' }
 */
export function loadWallets(walletsFile: string): Record<string, string> {
  if (!walletsFile || !existsSync(walletsFile)) return {}
  const bytes = readPrivateRegularFile(walletsFile, MAX_WALLETS_FILE_BYTES, 'Wallet registry')
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf-8'))
  } catch {
    throw new Error('Wallet registry is not valid JSON')
  } finally {
    bytes.fill(0)
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !('walletFiles' in parsed) ||
    Object.keys(parsed).some((key) => key !== 'version' && key !== 'walletFiles')
  ) {
    throw new Error('Wallet registry has an unsupported or unsafe format')
  }
  return validateWalletFiles(parsed.walletFiles)
}

/**
 * Save the wallets map to the JSON file. Creates parent dirs and sets 0600.
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @param wallets - Map of public key hex strings to absolute NWC secret-file paths.
 * @returns void
 *
 * @example
 * saveWallets('/home/user/.bray/wallets.json', {
 *   'abc123...': '/run/secrets/alice-nwc',
 * })
 */
export function saveWallets(walletsFile: string, wallets: Record<string, string>): void {
  if (!walletsFile) throw new Error('Wallet registry path is not configured')
  const validated = validateWalletFiles(wallets)
  const dir = dirname(walletsFile)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const data: WalletsData = { version: 1, walletFiles: validated }
  const temporary = join(dir, `.${basename(walletsFile)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, walletsFile)
    chmodSync(walletsFile, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/**
 * Resolve the NWC URI for the active identity.
 * 1. Per-identity NWC secret file referenced by the wallet registry
 * 2. Global NWC URI (fallback)
 * 3. undefined (no wallet configured)
 *
 * @param walletsFile - Absolute path to the JSON wallets store.
 * @param globalNwcUri - Optional fallback NWC URI used when no per-identity wallet is found.
 * @returns The resolved NWC URI, or `undefined` if no wallet is configured.
 *
 * @example
 * const uri = resolveNwcUri(ctx, '/home/user/.bray/wallets.json', configuredNwcUri)
 * if (!uri) throw new Error('No wallet configured')
 */
export function resolveNwcUri(
  ctx: SigningContext,
  walletsFile: string,
  globalNwcUri?: string,
): string | undefined {
  const pubkey = ctx.activePublicKeyHex
  const wallets = loadWallets(walletsFile)
  const walletFile = wallets[pubkey.toLowerCase()]
  return walletFile ? readNwcUriFile(walletFile) : globalNwcUri
}

// --- NWC Connection ---

export interface NwcConnection {
  pubkey: string
  relay: string
  relays: readonly string[]
  lud16?: string
}

/**
 * Parse a nostr+walletconnect:// URI.
 *
 * @param uri - A `nostr+walletconnect://` URI as specified in NIP-47.
 * @returns Public connection metadata. The connection secret is never returned.
 * @throws {Error} If the URI is malformed or insecure.
 *
 * @example
 * const conn = parseNwcUri(
 *   'nostr+walletconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef',
 * )
 * // { pubkey: 'abc123', relay: 'wss://relay.example/', relays: ['wss://relay.example/'] }
 */
export function parseNwcUri(uri: string): NwcConnection {
  const connection = inspectNwcConnection(uri)
  return {
    pubkey: connection.walletPubkey,
    relay: connection.relays[0]!,
    relays: connection.relays,
    ...(connection.lud16 ? { lud16: connection.lud16 } : {}),
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
 * @returns The bounded amount, description and expiry fields committed by the
 *   invoice. `amountMsats` is absent for an amountless invoice.
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
  const decoded = tryDecodeBolt11(bolt11)
  if (!decoded) return {}
  if (decoded.amountMsats !== null && decoded.amountMsats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('BOLT-11 amount exceeds JavaScript safe integer range')
  }
  return {
    ...(decoded.amountMsats !== null ? { amountMsats: Number(decoded.amountMsats) } : {}),
    ...(decoded.description !== null ? { description: decoded.description } : {}),
    expiry: decoded.expirySeconds,
  }
}

// --- NWC Operations ---

interface NwcOperationOptions extends NwcRequestOptions {
  /** Injectable for deterministic tests and specialised relay transports. */
  transport?: NwcTransport
}

interface NwcArgs extends NwcOperationOptions {
  nwcUri?: string
}

export interface ZapPaymentResult extends PayInvoiceResult {
  paymentHash: string
  verified: true
}

/**
 * The wallet may have submitted a payment but Bray cannot prove settlement.
 * Callers must reconcile `paymentHash` before attempting the invoice again.
 */
export class ZapPaymentOutcomeUnknownError extends Error {
  readonly code = 'PAYMENT_OUTCOME_UNKNOWN'

  constructor(readonly paymentHash: string) {
    super(`Payment outcome is unknown for ${paymentHash}. Reconcile the original invoice before retrying.`)
    this.name = 'ZapPaymentOutcomeUnknownError'
  }
}

function requireWallet(nwcUri: string | undefined, action: string): string {
  if (!nwcUri) {
    throw new Error(`Wallet not configured. Set NWC_URI_FILE or connect a persona wallet file to ${action}.`)
  }
  return nwcUri
}

function requestOptions(args: NwcOperationOptions): NwcRequestOptions {
  return {
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
  }
}

async function withClient<T>(
  nwcUri: string,
  transport: NwcTransport | undefined,
  operation: (client: NwcClient) => Promise<T>,
): Promise<T> {
  const client = new NwcClient(nwcUri, { ...(transport ? { transport } : {}) })
  try {
    return await operation(client)
  } finally {
    client.close()
  }
}

/** Pay a BOLT-11 invoice and return only after the wallet proves settlement. */
export async function handleZapSend(
  _ctx: SigningContext,
  _pool: RelayPool,
  args: { invoice: string } & NwcArgs,
): Promise<ZapPaymentResult> {
  const uri = requireWallet(args.nwcUri, 'enable payments')
  const decoded = tryDecodeBolt11(args.invoice)
  if (!decoded) throw new Error('Invalid BOLT-11 invoice')
  if (decoded.amountMsats === null) {
    throw new Error('Amountless BOLT-11 invoices are refused because no explicit payment amount was supplied')
  }
  if (decoded.amountMsats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('BOLT-11 amount exceeds JavaScript safe integer range')
  }
  let paid: PayInvoiceResult
  try {
    paid = await withClient(uri, args.transport, (client) =>
      client.payInvoice({ invoice: args.invoice }, requestOptions(args)))
  } catch (error) {
    // An authenticated wallet rejection is definitive. Transport, timeout,
    // abort, and malformed-response failures can happen after submission.
    if (error instanceof NwcError && error.code === 'WALLET_ERROR') throw error
    throw new ZapPaymentOutcomeUnknownError(decoded.paymentHashHex)
  }
  if (!verifyPreimage(paid.preimage, decoded.paymentHashHex)) {
    throw new ZapPaymentOutcomeUnknownError(decoded.paymentHashHex)
  }
  return { ...paid, paymentHash: decoded.paymentHashHex, verified: true }
}

/** Return the wallet's confirmed balance in millisatoshis. */
export async function handleZapBalance(
  _ctx: SigningContext,
  _pool: RelayPool,
  args: NwcArgs,
): Promise<GetBalanceResult> {
  const uri = requireWallet(args.nwcUri, 'check the balance')
  return withClient(uri, args.transport, (client) => client.getBalance(requestOptions(args)))
}

/** Generate a Lightning invoice through the configured wallet. */
export async function handleZapMakeInvoice(
  _ctx: SigningContext,
  _pool: RelayPool,
  args: { amountMsats: number; description?: string } & NwcArgs,
): Promise<NwcTransaction> {
  const uri = requireWallet(args.nwcUri, 'create invoices')
  return withClient(uri, args.transport, (client) => client.makeInvoice({
    amount: args.amountMsats,
    ...(args.description !== undefined ? { description: args.description } : {}),
  }, requestOptions(args)))
}

/** Look up an invoice and return the wallet's authenticated result. */
export async function handleZapLookupInvoice(
  _ctx: SigningContext,
  _pool: RelayPool,
  args: { paymentHash?: string; invoice?: string } & NwcArgs,
): Promise<NwcTransaction> {
  const uri = requireWallet(args.nwcUri, 'look up invoices')
  return withClient(uri, args.transport, (client) => client.lookupInvoice({
    ...(args.paymentHash !== undefined ? { payment_hash: args.paymentHash } : {}),
    ...(args.invoice !== undefined ? { invoice: args.invoice } : {}),
  }, requestOptions(args)))
}

/** List recent transactions through the isolated NIP-47 extension 05 client. */
export async function handleZapListTransactions(
  _ctx: SigningContext,
  _pool: RelayPool,
  args: { limit?: number; offset?: number } & NwcArgs,
): Promise<{ transactions: NwcTransaction[] }> {
  const uri = requireWallet(args.nwcUri, 'list transactions')
  const client = new NwcTransactionHistoryClient(uri, {
    ...(args.transport ? { transport: args.transport } : {}),
  })
  try {
    return await client.listTransactions({
      limit: args.limit ?? 10,
      offset: args.offset ?? 0,
    }, requestOptions(args))
  } finally {
    client.close()
  }
}
