import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { handleZapReceipts, handleZapDecode, handleZapSend, handleZapBalance } from './handlers.js'

export function registerZapTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('zap_receipts', {
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

  server.registerTool('zap_decode', {
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

  server.registerTool('zap_send', {
    description: 'Pay a Lightning invoice via Nostr Wallet Connect (NWC). Requires NWC_URI to be configured.',
    inputSchema: {
      invoice: z.string().describe('Bolt11 Lightning invoice to pay'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ invoice }) => {
    const result = await handleZapSend(deps.ctx, deps.pool, {
      invoice,
      nwcUri: deps.nwcUri,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('zap_balance', {
    description: 'Check NWC wallet connection status. Returns wallet pubkey and relay if configured.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = handleZapBalance({ nwcUri: deps.nwcUri })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
