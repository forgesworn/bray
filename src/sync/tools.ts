import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId, nostrEventSchema, relayUrl } from '../validation.js'
import { toolResponse } from '../tool-response.js'
import { handleSyncPlan } from './handlers.js'

/** Register the read-only reconciliation planner. Transfers remain explicit CLI/SDK operations. */
export function registerSyncTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('sync-plan', {
    description:
      'Read-only comparison of a bounded local event set with one relay. Uses NIP-77 Negentropy when supported, ' +
      'otherwise reports a bounded REQ fallback. This returns IDs only; it does not transfer or publish events.',
    inputSchema: {
      relay: relayUrl.describe('Target relay URL'),
      events: z.array(nostrEventSchema).max(10_000).optional().describe('Local signed events to compare (default: empty local set)'),
      kinds: z.array(z.number().int().min(0).max(65_535)).max(100).optional().describe('Restrict reconciliation to event kinds'),
      authors: z.array(hexId).max(100).optional().describe('Restrict reconciliation to author pubkeys'),
      since: z.number().int().min(0).optional().describe('Unix timestamp lower bound'),
      until: z.number().int().min(0).optional().describe('Unix timestamp upper bound'),
      maxIds: z.number().int().min(1).max(10_000).default(1_000).describe('Maximum local-only and remote-only IDs retained in the response'),
      maxRemoteEvents: z.number().int().min(1).max(50_000).default(10_000).describe('Maximum events scanned if REQ fallback is required'),
      timeoutMs: z.number().int().min(100).max(120_000).default(10_000).describe('Reconciliation timeout in milliseconds'),
      protocol: z.enum(['auto', 'nip77', 'req-fallback']).default('auto').describe('Try NIP-77 then fallback, or force one protocol'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async args => toolResponse(await handleSyncPlan(deps.pool, args), 'json'))
}
