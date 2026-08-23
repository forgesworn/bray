import { NwcClient } from '@forgesworn/nwc-kit'
import type { NwcTransport } from '@forgesworn/nwc-kit'
import { tryDecodeBolt11, verifyPreimage } from 'farrier-kit'
import { PaymentNotSentError, ServiceError, type ServiceInvoice, type ServiceWallet } from './service.js'

// The wallet behind the service: the one the operator already configured
// for `zap-send`, reached as an NWC client.
//
// So bray sits between two NWC connections - an unbounded one it holds, and
// whatever narrow ones it hands out. Nothing about the money changes here.
// What changes is who can do what: the URI upstream can spend everything by
// every method the wallet supports, and the URIs downstream can do only
// what their grant says, only up to their budget, and only until they are
// revoked.
//
// Every claimed payment is checked the same way `zap-send` checks it: a
// preimage that does not settle the invoice is not evidence money moved,
// and passing that on to whoever asked would be repeating a lie rather
// than telling one.

export interface UpstreamOptions {
  uri: string
  transport?: NwcTransport
  alias?: string
}

async function withClient<T>(options: UpstreamOptions, run: (client: NwcClient) => Promise<T>): Promise<T> {
  const client = new NwcClient(options.uri, { ...(options.transport ? { transport: options.transport } : {}) })
  try {
    return await run(client)
  } finally {
    client.close()
  }
}

export function upstreamWallet(options: UpstreamOptions): ServiceWallet {
  return {
    alias: () => options.alias ?? 'bray',

    balanceMsat: async () =>
      withClient(options, async (client) => {
        await client.connect()
        const balance = await client.getBalance()
        return Number(balance.balance ?? 0)
      }),

    async makeInvoice({ amountMsat, description }) {
      return withClient(options, async (client) => {
        const capabilities = await client.connect()
        if (!capabilities.methods.includes('make_invoice')) {
          throw new ServiceError('NOT_IMPLEMENTED', 'The wallet behind this service cannot issue invoices.')
        }
        const transaction = await client.makeInvoice({
          amount: amountMsat,
          ...(description === undefined ? {} : { description }),
        })
        const invoice = String(transaction.invoice ?? '')
        const decoded = tryDecodeBolt11(invoice)
        if (!decoded) {
          throw new ServiceError('INTERNAL', 'The wallet returned something that is not a decodable invoice.')
        }
        // An invoice for a different amount than the one asked for is not a
        // smaller problem than no invoice: whoever pays it pays that.
        if (decoded.amountMsats !== null && Number(decoded.amountMsats) !== amountMsat) {
          throw new ServiceError(
            'INTERNAL',
            `The wallet issued an invoice for ${String(decoded.amountMsats)} msat, not the ${amountMsat} msat asked for.`,
          )
        }
        return {
          type: 'incoming',
          invoice,
          paymentHash: decoded.paymentHashHex,
          amountMsat,
          createdAt: decoded.timestamp,
          expiresAt: decoded.timestamp + decoded.expirySeconds,
          ...(description === undefined ? {} : { description }),
        } satisfies ServiceInvoice
      })
    },

    async payInvoice({ invoice }) {
      const decoded = tryDecodeBolt11(invoice)
      if (!decoded) throw new PaymentNotSentError('That is not a decodable BOLT-11 invoice.')
      return withClient(options, async (client) => {
        const capabilities = await client.connect()
        if (!capabilities.methods.includes('pay_invoice')) {
          throw new PaymentNotSentError('The wallet behind this service cannot pay invoices.')
        }
        const result = await client.payInvoice({ invoice })
        if (!result.preimage || !verifyPreimage(result.preimage, decoded.paymentHashHex)) {
          // The wallet says it paid and cannot prove it. Not a refusal -
          // something may well have gone out - so the budget keeps the
          // charge and the caller is told the proof is missing.
          throw new ServiceError(
            'OTHER',
            'The wallet claims payment but its preimage does not settle that invoice.',
          )
        }
        return { preimage: result.preimage, feesPaidMsat: Number(result.fees_paid ?? 0) }
      })
    },

    async lookupInvoice(query) {
      return withClient(options, async (client) => {
        const capabilities = await client.connect()
        if (!capabilities.methods.includes('lookup_invoice')) {
          throw new ServiceError('NOT_IMPLEMENTED', 'The wallet behind this service cannot look invoices up.')
        }
        const found = await client.lookupInvoice({
          ...(query.paymentHash === undefined ? {} : { payment_hash: query.paymentHash }),
          ...(query.invoice === undefined ? {} : { invoice: query.invoice }),
        })
        if (!found) return null
        return {
          type: found.type === 'outgoing' ? 'outgoing' : 'incoming',
          invoice: String(found.invoice ?? ''),
          paymentHash: String(found.payment_hash ?? ''),
          amountMsat: Number(found.amount ?? 0),
          createdAt: Number(found.created_at ?? 0),
          ...(found.settled_at === undefined ? {} : { settledAt: Number(found.settled_at) }),
          ...(found.preimage === undefined ? {} : { preimage: String(found.preimage) }),
          ...(found.fees_paid === undefined ? {} : { feesPaidMsat: Number(found.fees_paid) }),
          ...(found.description === undefined ? {} : { description: String(found.description) }),
        } satisfies ServiceInvoice
      })
    },
  }
}
