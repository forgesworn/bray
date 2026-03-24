import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { handleRelayList, handleRelaySet, handleRelayAdd, handleRelayInfo } from './handlers.js'

export function registerRelayTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('relay_list', {
    description: 'List the relay set (read/write) for the active identity. Optionally check for shared relays with another identity.',
    inputSchema: {
      compareWithNpub: z.string().optional().describe('Compare shared relays with this npub'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ compareWithNpub }) => {
    const result = handleRelayList(deps.ctx, deps.pool, compareWithNpub)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay_set', {
    description: 'Publish a kind 10002 relay list for the active identity. Warns if a relay list already exists.',
    inputSchema: {
      relays: z.array(z.object({
        url: z.string().describe('Relay WebSocket URL'),
        mode: z.enum(['read', 'write']).optional().describe('Read, write, or both (default)'),
      })).describe('Relay entries'),
      confirm: z.boolean().default(false).describe('Set true to overwrite existing relay list'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ relays, confirm }) => {
    const result = await handleRelaySet(deps.ctx, deps.pool, { relays, confirm })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.warning
        ? { warning: result.warning }
        : { published: true, id: result.event.id }
      , null, 2) }],
    }
  })

  server.registerTool('relay_add', {
    description: 'Add a single relay to the active identity\'s relay set (in-memory only — does not publish kind 10002).',
    inputSchema: {
      url: z.string().describe('Relay WebSocket URL'),
      mode: z.enum(['read', 'write']).optional().describe('Read, write, or both (default)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ url, mode }) => {
    const result = handleRelayAdd(deps.ctx, deps.pool, { url, mode })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay_info', {
    description: 'Fetch the NIP-11 relay information document for a relay URL.',
    inputSchema: {
      url: z.string().describe('Relay WebSocket URL (wss://...)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ url }) => {
    const info = await handleRelayInfo(url)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
    }
  })
}
