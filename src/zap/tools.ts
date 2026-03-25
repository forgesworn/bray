import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import {
  handleZapReceipts,
  handleZapDecode,
  handleZapSend,
  handleZapBalance,
  handleZapMakeInvoice,
  handleZapLookupInvoice,
  handleZapListTransactions,
} from './handlers.js'

export function registerZapTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('zap-send', {
    description: 'Pay a Lightning invoice via Nostr Wallet Connect (NWC). SPENDS REAL SATS. Decodes the invoice and shows amount first — set confirm: true to execute payment.',
    inputSchema: {
      invoice: z.string().describe('Bolt11 Lightning invoice to pay'),
      confirm: z.boolean().default(false).describe('Set true to execute payment (preview by default)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ invoice, confirm }) => {
    // Always decode first so the caller sees what they're paying
    const decoded = handleZapDecode(invoice)
    if (!confirm) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          preview: true,
          amountMsats: decoded.amountMsats,
          description: decoded.description,
          message: `This will pay ${decoded.amountMsats} msats. Set confirm: true to execute.`,
        }, null, 2) }],
      }
    }
    const result = await handleZapSend(deps.ctx, deps.pool, { invoice, nwcUri: deps.nwcUri })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        paid: true,
        amountMsats: decoded.amountMsats,
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('zap-balance', {
    description: 'Request wallet balance via NWC. Sends a get_balance request to the wallet service.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await handleZapBalance(deps.ctx, deps.pool, { nwcUri: deps.nwcUri })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('zap-make-invoice', {
    description: 'Generate a Lightning invoice via NWC to receive payments.',
    inputSchema: {
      amountMsats: z.number().int().min(1).describe('Invoice amount in millisatoshis'),
      description: z.string().optional().describe('Invoice description'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ amountMsats, description }) => {
    const result = await handleZapMakeInvoice(deps.ctx, deps.pool, {
      amountMsats, description, nwcUri: deps.nwcUri,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('zap-lookup-invoice', {
    description: 'Look up a Lightning invoice status via NWC.',
    inputSchema: {
      paymentHash: z.string().optional().describe('Payment hash to look up'),
      invoice: z.string().optional().describe('Bolt11 invoice to look up'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ paymentHash, invoice }) => {
    const result = await handleZapLookupInvoice(deps.ctx, deps.pool, {
      paymentHash, invoice, nwcUri: deps.nwcUri,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('zap-list-transactions', {
    description: 'List recent Lightning transactions via NWC.',
    inputSchema: {
      limit: z.number().int().min(1).default(10).describe('Max transactions to return'),
      offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit, offset }) => {
    const result = await handleZapListTransactions(deps.ctx, deps.pool, {
      limit, offset, nwcUri: deps.nwcUri,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('zap-receipts', {
    description: 'Fetch zap receipts (kind 9735) for the active identity. Returns sender, amount in msats, and message.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only fetch zaps after this time'),
      limit: z.number().int().min(1).default(20).describe('Max receipts to return'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, limit }) => {
    const receipts = await handleZapReceipts(deps.ctx, deps.pool, { since, limit })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(receipts, null, 2) }],
    }
  })

  server.registerTool('zap-decode', {
    description: 'Decode basic fields from a bolt11 Lightning invoice string.',
    inputSchema: {
      bolt11: z.string().describe('Bolt11 invoice string'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ bolt11 }) => {
    const decoded = handleZapDecode(bolt11)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(decoded, null, 2) }],
    }
  })
}
