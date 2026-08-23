import { finalizeEvent, getPublicKey, verifyEvent, nip44 } from 'nostr-tools'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { tryDecodeBolt11 } from 'farrier-kit'

// A NIP-47 wallet service: the server side of Nostr Wallet Connect.
//
// bray already speaks NWC as a client - `zap-send` spends through a wallet
// the operator configured. This is the other direction. bray answers NIP-47
// on behalf of that wallet, and what it adds is the thing the wallet itself
// does not have: a connection you can hand to an agent that is narrower
// than the one you hold.
//
// That is the whole point. An NWC URI is an unbounded capability over a
// node - hand it to an agent and it can spend everything, forever, by any
// method the wallet supports. What is handed out here is scoped:
//
//   - the method list is an allowlist, defaulting to no spending and no
//     balance disclosure. Both are opt-in, per connection.
//   - a connection that may spend MUST carry a budget. There is no
//     unlimited grant to issue by accident.
//   - a request that arrives twice is answered once. A relay will hand the
//     same signed request over again, and a replayed pay_invoice is a
//     second payment.
//   - requests on one connection are serialised, so two arriving together
//     cannot both read the same remaining budget.
//
// The same runtime, and the same rules, front a bearer-note wallet in
// forgesworn/notecase (src/nwcservice.ts). It is deliberately written
// against a `ServiceWallet` interface rather than against either wallet.

export const NWC_INFO_KIND = 13194
export const NWC_REQUEST_KIND = 23194
export const NWC_RESPONSE_KIND = 23195

export const DEFAULT_METHODS = ['get_info', 'make_invoice', 'lookup_invoice'] as const
export const SUPPORTED_METHODS = [
  'get_info',
  'get_balance',
  'make_invoice',
  'lookup_invoice',
  'pay_invoice',
] as const

export const SPENDING_METHODS: readonly string[] = ['pay_invoice']

// A request older than this is not answered. NIP-47 requests carry their
// own `expiration`, but that is the sender's word for it: a relay replaying
// a week-old event must not be able to spend, whatever the event claims
// about itself.
const MAX_REQUEST_AGE_SECS = 300
const MAX_REQUEST_FUTURE_SECS = 60
const SEEN_LIMIT = 256

export class ServiceError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Thrown by a wallet that refused BEFORE anything could leave: a bad
// invoice, an expired one, not enough balance. The only failure that gives
// the budget back, because it is the only one where nothing went out.
export class PaymentNotSentError extends ServiceError {
  constructor(message: string) {
    super('PAYMENT_FAILED', message)
  }
}

export interface ServiceInvoice {
  type: 'incoming' | 'outgoing'
  invoice: string
  paymentHash: string
  amountMsat: number
  feesPaidMsat?: number
  preimage?: string
  description?: string
  settledAt?: number
  createdAt: number
  expiresAt?: number
}

// What the runtime needs of a wallet. Everything money-related is behind
// this, so the NIP-47 plumbing is testable without one and a different
// wallet can be fronted by the same rules.
export interface ServiceWallet {
  alias(): string
  balanceMsat(): Promise<number>
  makeInvoice(request: { amountMsat: number; description?: string }): Promise<ServiceInvoice>
  payInvoice(request: { invoice: string; amountMsat: number }): Promise<{ preimage: string; feesPaidMsat: number }>
  lookupInvoice(query: { paymentHash?: string; invoice?: string }): Promise<ServiceInvoice | null>
}

export interface ServiceTransport {
  subscribe(relays: string[], filter: Filter, onEvent: (event: NostrEvent) => void): Promise<() => void>
  publish(relays: string[], event: NostrEvent): Promise<void>
}

export interface Grant {
  id: string
  name: string
  // One service key per connection: two grants share nothing a relay can
  // correlate, and revoking one is deleting a key rather than re-issuing
  // everybody else's.
  serviceSecretHex: string
  servicePubkey: string
  clientSecretHex: string
  clientPubkey: string
  relays: string[]
  methods: string[]
  budgetMsat?: number
  spentMsat: number
  maxPaymentMsat?: number
  seen?: string[]
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

export function grantUri(grant: Grant): string {
  const relays = grant.relays.map((relay) => `relay=${encodeURIComponent(relay)}`).join('&')
  return `nostr+walletconnect://${grant.servicePubkey}?${relays}&secret=${grant.clientSecretHex}`
}

export function spends(methods: string[]): boolean {
  return methods.some((method) => SPENDING_METHODS.includes(method))
}

export function validateGrant(input: {
  methods: string[]
  relays: string[]
  budgetMsat?: number
  maxPaymentMsat?: number
}): void {
  if (input.relays.length === 0) throw new ServiceError('OTHER', 'A connection needs at least one relay.')
  if (input.methods.length === 0) throw new ServiceError('OTHER', 'A connection needs at least one method.')
  for (const method of input.methods) {
    if (!(SUPPORTED_METHODS as readonly string[]).includes(method)) {
      throw new ServiceError('NOT_IMPLEMENTED', `This service cannot answer ${method}.`)
    }
  }
  if (spends(input.methods)) {
    if (input.budgetMsat === undefined) {
      throw new ServiceError('OTHER', 'A connection that can spend needs a budget - there is no unlimited grant.')
    }
    if (!Number.isSafeInteger(input.budgetMsat) || input.budgetMsat <= 0) {
      throw new ServiceError('OTHER', 'The budget must be a positive integer of milli-satoshis.')
    }
  } else if (input.budgetMsat !== undefined) {
    throw new ServiceError('OTHER', 'A budget means nothing on a connection that cannot spend.')
  }
  if (input.maxPaymentMsat !== undefined) {
    if (!Number.isSafeInteger(input.maxPaymentMsat) || input.maxPaymentMsat <= 0) {
      throw new ServiceError('OTHER', 'The per-payment ceiling must be a positive integer of milli-satoshis.')
    }
    if (input.budgetMsat !== undefined && input.maxPaymentMsat > input.budgetMsat) {
      throw new ServiceError('OTHER', 'The per-payment ceiling is above the whole budget.')
    }
  }
}

export function remainingBudgetMsat(grant: Grant): number {
  return grant.budgetMsat === undefined ? 0 : Math.max(0, grant.budgetMsat - grant.spentMsat)
}

export function newGrant(input: {
  name: string
  relays: string[]
  methods?: string[]
  budgetMsat?: number
  maxPaymentMsat?: number
}): Grant {
  const methods = input.methods ?? [...DEFAULT_METHODS]
  validateGrant({ methods, relays: input.relays, ...(input.budgetMsat === undefined ? {} : { budgetMsat: input.budgetMsat }), ...(input.maxPaymentMsat === undefined ? {} : { maxPaymentMsat: input.maxPaymentMsat }) })
  const serviceSecretHex = bytesToHex(randomSecret())
  const clientSecretHex = bytesToHex(randomSecret())
  return {
    id: bytesToHex(randomSecret()).slice(0, 16),
    name: input.name,
    serviceSecretHex,
    servicePubkey: getPublicKey(hexToBytes(serviceSecretHex)),
    clientSecretHex,
    clientPubkey: getPublicKey(hexToBytes(clientSecretHex)),
    relays: [...new Set(input.relays)],
    methods,
    spentMsat: 0,
    ...(input.budgetMsat === undefined ? {} : { budgetMsat: input.budgetMsat }),
    ...(input.maxPaymentMsat === undefined ? {} : { maxPaymentMsat: input.maxPaymentMsat }),
    createdAt: Date.now(),
  }
}

function randomSecret(): Uint8Array {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytes
}

interface Answer {
  result_type: string
  result?: unknown
  error?: { code: string; message: string }
}

function conversationKey(grant: Grant): Uint8Array {
  return nip44.getConversationKey(hexToBytes(grant.serviceSecretHex), grant.clientPubkey)
}

export function infoEvent(grant: Grant): NostrEvent {
  return finalizeEvent(
    {
      kind: NWC_INFO_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['encryption', 'nip44_v2']],
      content: grant.methods.join(' '),
    },
    hexToBytes(grant.serviceSecretHex),
  )
}

function responseEvent(grant: Grant, request: NostrEvent, answer: Answer): NostrEvent {
  return finalizeEvent(
    {
      kind: NWC_RESPONSE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', request.pubkey],
        ['e', request.id],
        ['encryption', 'nip44_v2'],
      ],
      content: nip44.encrypt(JSON.stringify(answer), conversationKey(grant)),
    },
    hexToBytes(grant.serviceSecretHex),
  )
}

function invoiceResult(view: ServiceInvoice): Record<string, unknown> {
  return {
    type: view.type,
    invoice: view.invoice,
    payment_hash: view.paymentHash,
    amount: view.amountMsat,
    created_at: view.createdAt,
    ...(view.description === undefined ? {} : { description: view.description }),
    ...(view.expiresAt === undefined ? {} : { expires_at: view.expiresAt }),
    ...(view.settledAt === undefined ? {} : { settled_at: view.settledAt }),
    ...(view.preimage === undefined ? {} : { preimage: view.preimage }),
    ...(view.feesPaidMsat === undefined ? {} : { fees_paid: view.feesPaidMsat }),
  }
}

export interface ServiceOptions {
  wallet: ServiceWallet
  transport: ServiceTransport
  // Awaited BEFORE an answer goes out: a budget that has been spent must be
  // on disk before the payer is told it worked.
  persist: () => Promise<void>
  log?: (message: string) => void
  now?: () => number
}

export class WalletService {
  readonly #opts: ServiceOptions
  readonly #now: () => number
  readonly #stops = new Map<string, () => void>()
  readonly #queues = new Map<string, Promise<void>>()
  readonly #grants = new Map<string, Grant>()

  constructor(opts: ServiceOptions) {
    this.#opts = opts
    this.#now = opts.now ?? (() => Date.now())
  }

  serving(): string[] {
    return [...this.#stops.keys()]
  }

  async serve(grant: Grant): Promise<void> {
    if (grant.revokedAt) return
    this.stop(grant.id)
    this.#grants.set(grant.id, grant)
    await this.#opts.transport.publish(grant.relays, infoEvent(grant))
    const since = Math.floor(this.#now() / 1000) - MAX_REQUEST_AGE_SECS
    const stop = await this.#opts.transport.subscribe(
      grant.relays,
      { kinds: [NWC_REQUEST_KIND], '#p': [grant.servicePubkey], since },
      (event) => this.#enqueue(grant.id, event),
    )
    this.#stops.set(grant.id, stop)
    this.#opts.log?.(`serving ${grant.name} on ${grant.relays.join(', ')}`)
  }

  stop(grantId: string): void {
    this.#stops.get(grantId)?.()
    this.#stops.delete(grantId)
    this.#grants.delete(grantId)
  }

  close(): void {
    for (const id of [...this.#stops.keys()]) this.stop(id)
  }

  // Every request on one connection runs after the last has finished. Two
  // pay_invoice requests arriving together must not both read the same
  // remaining budget and both decide there is room.
  #enqueue(grantId: string, event: NostrEvent): void {
    const previous = this.#queues.get(grantId) ?? Promise.resolve()
    this.#queues.set(
      grantId,
      previous
        .then(() => this.#handle(grantId, event))
        .catch((err: unknown) => this.#opts.log?.(`request failed: ${(err as Error).message}`)),
    )
  }

  async #handle(grantId: string, event: NostrEvent): Promise<void> {
    const grant = this.#grants.get(grantId)
    if (!grant || grant.revokedAt) return

    // Anyone can publish an event tagged at this pubkey - it is in the info
    // event, which is public. What keeps a stranger out is further down:
    // the conversation key is derived from THIS connection's client pubkey,
    // so NIP-44 cannot open anything anyone else sealed. This is the cheap
    // rejection of noise before the expensive one.
    if (event.pubkey !== grant.clientPubkey) return
    if (!verifyEvent(event)) return

    const seconds = Math.floor(this.#now() / 1000)
    if (event.created_at < seconds - MAX_REQUEST_AGE_SECS) return
    if (event.created_at > seconds + MAX_REQUEST_FUTURE_SECS) return
    const expiration = event.tags.find((tag) => tag[0] === 'expiration')?.[1]
    if (expiration && Number(expiration) < seconds) return

    const seen = grant.seen ?? []
    if (seen.includes(event.id)) {
      this.#opts.log?.(`ignored a replayed request on ${grant.name}`)
      return
    }

    let parsed: { method?: unknown; params?: unknown }
    try {
      parsed = JSON.parse(nip44.decrypt(event.content, conversationKey(grant))) as typeof parsed
    } catch {
      this.#opts.log?.(`could not read a request on ${grant.name}`)
      return
    }
    const method = typeof parsed.method === 'string' ? parsed.method : ''
    const params = (parsed.params ?? {}) as Record<string, unknown>

    const remember = async (): Promise<void> => {
      grant.seen = [...seen, event.id].slice(-SEEN_LIMIT)
      grant.lastUsedAt = this.#now()
      await this.#opts.persist()
    }

    // A spending request is written down before it runs, so a crash between
    // the two leaves a request that will not be tried again rather than one
    // that might be paid twice.
    const spending = SPENDING_METHODS.includes(method)
    if (spending) await remember()

    let answer: Answer
    try {
      if (!grant.methods.includes(method)) {
        throw new ServiceError(
          'RESTRICTED',
          (SUPPORTED_METHODS as readonly string[]).includes(method)
            ? `This connection may not ${method}.`
            : `This service cannot answer ${method}.`,
        )
      }
      answer = { result_type: method, result: await this.#dispatch(grant, method, params) }
    } catch (err) {
      const code = err instanceof ServiceError ? err.code : 'INTERNAL'
      const message = (err as Error).message || 'The wallet could not answer that.'
      answer = { result_type: method, error: { code, message } }
      this.#opts.log?.(`refused ${method || 'an unnamed method'} on ${grant.name}: ${message}`)
    }
    if (!spending) await remember()
    await this.#opts.transport.publish(grant.relays, responseEvent(grant, event, answer))
  }

  async #dispatch(grant: Grant, method: string, params: Record<string, unknown>): Promise<unknown> {
    const wallet = this.#opts.wallet
    switch (method) {
      case 'get_info':
        return { alias: wallet.alias(), network: 'mainnet', methods: grant.methods, notifications: [] }
      case 'get_balance':
        return { balance: await wallet.balanceMsat() }
      case 'make_invoice': {
        const amountMsat = Number(params.amount)
        if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) {
          throw new ServiceError('OTHER', 'make_invoice needs an amount in milli-satoshis.')
        }
        const description = typeof params.description === 'string' ? params.description : undefined
        return invoiceResult(
          await wallet.makeInvoice({ amountMsat, ...(description === undefined ? {} : { description }) }),
        )
      }
      case 'lookup_invoice': {
        const paymentHash = typeof params.payment_hash === 'string' ? params.payment_hash : undefined
        const invoice = typeof params.invoice === 'string' ? params.invoice : undefined
        if (!paymentHash && !invoice) {
          throw new ServiceError('OTHER', 'lookup_invoice needs a payment_hash or an invoice.')
        }
        const view = await wallet.lookupInvoice({
          ...(paymentHash === undefined ? {} : { paymentHash }),
          ...(invoice === undefined ? {} : { invoice }),
        })
        if (!view) throw new ServiceError('NOT_FOUND', 'No invoice here by that name.')
        return invoiceResult(view)
      }
      case 'pay_invoice': {
        const invoice = typeof params.invoice === 'string' ? params.invoice.trim() : ''
        if (!invoice) throw new ServiceError('OTHER', 'pay_invoice needs an invoice.')
        const amountMsat = priceOf(invoice, params)
        charge(grant, amountMsat)
        // Spent BEFORE the attempt and persisted: a crash mid-payment must
        // leave a budget that has paid for it. The other order lets one
        // connection spend its grant twice by dying at the right moment.
        grant.spentMsat += amountMsat
        await this.#opts.persist()
        try {
          const paid = await this.#opts.wallet.payInvoice({ invoice, amountMsat })
          return { preimage: paid.preimage, fees_paid: paid.feesPaidMsat }
        } catch (err) {
          if (err instanceof PaymentNotSentError) {
            grant.spentMsat -= amountMsat
            await this.#opts.persist()
          }
          throw err
        }
      }
      default:
        throw new ServiceError('NOT_IMPLEMENTED', `This service cannot answer ${method}.`)
    }
  }
}

// What this payment costs the budget, read off the invoice itself rather
// than taken from the request. A budget checked against a figure the payer
// supplied is not a budget.
function priceOf(invoice: string, params: Record<string, unknown>): number {
  const decoded = tryDecodeBolt11(invoice)
  if (!decoded) throw new PaymentNotSentError('That is not a decodable BOLT-11 invoice.')
  const asked = params.amount === undefined ? undefined : Number(params.amount)
  if (asked !== undefined && (!Number.isSafeInteger(asked) || asked <= 0)) {
    throw new PaymentNotSentError('That amount is not a whole number of milli-satoshis.')
  }
  if (decoded.amountMsats !== null) {
    const stated = Number(decoded.amountMsats)
    if (asked !== undefined && asked !== stated) {
      throw new PaymentNotSentError(`That invoice is for ${stated} msat, not the ${asked} msat asked for.`)
    }
    return stated
  }
  if (asked === undefined) throw new PaymentNotSentError('That invoice states no amount - say how much to send.')
  return asked
}

// Refuses before anything is attempted, and says which ceiling it hit: a
// payer told only "no" tries again.
function charge(grant: Grant, amountMsat: number): void {
  if (grant.budgetMsat === undefined) {
    throw new ServiceError('RESTRICTED', 'This connection has no budget to spend from.')
  }
  if (grant.maxPaymentMsat !== undefined && amountMsat > grant.maxPaymentMsat) {
    throw new ServiceError(
      'QUOTA_EXCEEDED',
      `That is ${amountMsat} msat and this connection's ceiling for one payment is ${grant.maxPaymentMsat} msat.`,
    )
  }
  const remaining = remainingBudgetMsat(grant)
  if (amountMsat > remaining) {
    throw new ServiceError(
      'QUOTA_EXCEEDED',
      `That is ${amountMsat} msat and this connection has ${remaining} msat of its budget left.`,
    )
  }
}
