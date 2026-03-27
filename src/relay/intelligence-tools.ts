import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { relayUrl } from '../validation.js'
import {
  handleRelayDiscover,
  handleRelayNipSearch,
  handleRelayCompare,
  handleRelayDiversity,
  handleRelayRecommend,
} from './intelligence-handlers.js'

export function registerRelayIntelligenceTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('relay-discover', {
    description:
      'Discover relays used by your contacts. Fetches kind 10002 (NIP-65) relay lists from your follow list, ' +
      'aggregates relay URLs, and ranks by popularity. Shows which relays your contacts cluster on.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).optional()
        .describe('Maximum relays to return (default 20, max 100)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    const result = await handleRelayDiscover(deps.ctx, deps.pool, { limit })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-nip-search', {
    description:
      'Find relays that support specific NIPs. Queries NIP-11 info documents and filters to relays ' +
      'supporting requested NIP numbers. Useful for finding relays with search (NIP-50), auth (NIP-42), ' +
      'event counts (NIP-45), or other capabilities.',
    inputSchema: {
      nips: z.array(z.number().int().min(1).max(200))
        .min(1)
        .describe('NIP numbers to search for (e.g. [50, 42])'),
      candidateRelays: z.array(relayUrl).optional()
        .describe('Relay URLs to check (defaults to your configured relays)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ nips, candidateRelays }) => {
    const result = await handleRelayNipSearch(deps.ctx, deps.pool, { nips, candidateRelays })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-compare', {
    description:
      'Compare 2 or more relays side-by-side. For each relay: NIP-11 metadata, response time, ' +
      'supported NIPs, whether you have events on it, software, and limitations.',
    inputSchema: {
      relays: z.array(relayUrl).min(2).max(10)
        .describe('Relay URLs to compare (2-10)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ relays }) => {
    const result = await handleRelayCompare(deps.ctx, deps.pool, { relays })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-diversity', {
    description:
      'Analyse your relay set for centralisation risk. Checks unique operators, software diversity, ' +
      'and reachability. Flags if >50% of relays share an operator. Returns warnings and recommendations.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await handleRelayDiversity(deps.ctx, deps.pool)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-recommend', {
    description:
      'Recommend relays for your use case. Uses contact relay discovery, NIP-11 metadata, and health checks ' +
      'to score and rank relay candidates. Strategies: balanced (mix of popular + diverse), privacy (Tor-friendly, ' +
      'no auth), performance (lowest latency), social (relays your contacts cluster on).',
    inputSchema: {
      strategy: z.enum(['balanced', 'privacy', 'performance', 'social']).optional()
        .describe('Recommendation strategy (default: balanced)'),
      limit: z.number().int().min(1).max(50).default(10).optional()
        .describe('Maximum recommendations to return (default 10)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ strategy, limit }) => {
    const result = await handleRelayRecommend(deps.ctx, deps.pool, { strategy, limit })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
