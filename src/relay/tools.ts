import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { relayUrl } from '../validation.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import { handleRelayList, handleRelaySet, handleRelayAdd, handleRelayInfo, handleRelayQuery } from './handlers.js'
import { handleRelayCount } from './count.js'
import { handleRelayAuth } from './auth.js'
import { handleCastSpell } from './spell.js'

export function registerRelayTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('relay-list', {
    description: 'List the relay set (read/write) for the active identity. Optionally check for shared relays with another identity.',
    inputSchema: {
      compareWithNpub: z.string().optional().describe('Compare shared relays with this npub'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ compareWithNpub, output }) => {
    const result = await handleRelayList(deps.ctx, deps.pool, compareWithNpub)
    return toolResponse(result, output, fmt.formatRelays)
  })

  server.registerTool('relay-set', {
    description: 'Publish a kind 10002 relay list for the active identity. Warns if a relay list already exists.',
    inputSchema: {
      relays: z.array(z.object({
        url: relayUrl.describe('Relay WebSocket URL'),
        mode: z.enum(['read', 'write']).optional().describe('Read, write, or both (default)'),
      })).describe('Relay entries'),
      confirm: z.boolean().default(false).describe('Set true to overwrite existing relay list'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ relays, confirm }) => {
    const result = await handleRelaySet(deps.ctx, deps.pool, { relays, confirm })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.warning
        ? { warning: result.warning }
        : { published: true, id: result.event.id }
      , null, 2) }],
    }
  })

  server.registerTool('relay-add', {
    description: 'Add a single relay to the active identity\'s relay set (in-memory only — does not publish kind 10002).',
    inputSchema: {
      url: relayUrl.describe('Relay WebSocket URL'),
      mode: z.enum(['read', 'write']).optional().describe('Read, write, or both (default)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ url, mode }) => {
    const result = handleRelayAdd(deps.ctx, deps.pool, { url, mode })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-query', {
    description: 'Query events from Nostr relays by kind, author, ids, tags, or time range. Useful for discovering events, scanning for specific kinds, or investigating unknown event schemas. Uses explicit relays if provided, otherwise the active identity\'s read relays. Filter fields may be supplied either as top-level arguments or wrapped in a single "filter" object (both shapes are accepted).',
    inputSchema: {
      ids: z.array(z.string()).optional().describe('Event IDs (hex) to fetch directly'),
      kinds: z.array(z.number().int()).optional().describe('Event kinds to filter by (e.g. [30301, 31000])'),
      authors: z.array(z.string()).optional().describe('Hex pubkeys of event authors'),
      tags: z.record(z.string(), z.array(z.string())).optional().describe('Tag filters as key-value pairs (e.g. {"#p": ["hex..."], "#d": ["prefix"]})'),
      since: z.number().int().optional().describe('Unix timestamp, only events created after this time'),
      until: z.number().int().optional().describe('Unix timestamp, only events created before this time'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum number of events to return (default 50, max 500)'),
      relays: z.array(relayUrl).optional().describe('Explicit relay URLs to query (overrides identity relay set)'),
      search: z.string().optional().describe('Full-text search query (NIP-50). Only works on relays that support NIP-50; others will ignore it.'),
      // Alias: some MCP clients naturally wrap the whole filter in a single "filter" object.
      // Without this alias the MCP SDK silently strips the unknown key, leaving the handler
      // with an empty argument set and returning a broad firehose of events.
      filter: z.object({
        ids: z.array(z.string()).optional(),
        kinds: z.array(z.number().int()).optional(),
        authors: z.array(z.string()).optional(),
        tags: z.record(z.string(), z.array(z.string())).optional(),
        since: z.number().int().optional(),
        until: z.number().int().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        search: z.string().optional(),
      }).optional().describe('Alias: all filter fields wrapped in a single object. Merged with any top-level fields; top-level values win on conflict.'),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    // Merge nested "filter" alias with top-level fields. Top-level values win on conflict so
    // the canonical form stays authoritative, but a caller that only supplies "filter" still
    // gets everything through. Without this merge the MCP SDK strips the unknown top-level
    // "filter" key and the handler receives an empty object, yielding a firehose response.
    const f = args.filter ?? {}
    const mergedLimit = args.limit ?? f.limit ?? 50
    const events = await handleRelayQuery(deps.pool, deps.ctx.activeNpub, {
      ids: args.ids ?? f.ids,
      kinds: args.kinds ?? f.kinds,
      authors: args.authors ?? f.authors,
      tags: args.tags ?? f.tags,
      since: args.since ?? f.since,
      until: args.until ?? f.until,
      limit: mergedLimit,
      relays: args.relays,
      search: args.search ?? f.search,
    })
    const summary = events.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      tags: e.tags,
      content: e.content.length > 500 ? e.content.slice(0, 500) + '...' : e.content,
      created_at: e.created_at,
    }))
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(
        { count: events.length, events: summary },
        null, 2,
      ) }],
    }
  })

  server.registerTool('relay-info', {
    description: 'Fetch the NIP-11 relay information document for a relay URL.',
    inputSchema: {
      url: relayUrl.describe('Relay WebSocket URL (wss://...)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ url }) => {
    const info = await handleRelayInfo(url)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
    }
  })

  server.registerTool('relay-count', {
    description: 'Count events matching a filter without fetching them (NIP-45). Sends a COUNT request to each relay. Falls back to fetch-and-count (capped at 1000) if the relay does not support NIP-45. Results show per-relay counts with fallback/estimated flags.',
    inputSchema: {
      relays: z.array(relayUrl).describe('Relay URLs to count from'),
      kinds: z.array(z.number().int()).optional().describe('Event kinds to filter by'),
      authors: z.array(z.string()).optional().describe('Hex pubkeys of event authors'),
      tags: z.record(z.string(), z.array(z.string())).optional().describe('Tag filters as key-value pairs'),
      since: z.number().int().optional().describe('Unix timestamp lower bound'),
      until: z.number().int().optional().describe('Unix timestamp upper bound'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ relays, kinds, authors, tags, since, until }) => {
    const filter: Record<string, unknown> = {}
    if (kinds?.length) filter.kinds = kinds
    if (authors?.length) filter.authors = authors
    if (since) filter.since = since
    if (until) filter.until = until
    if (tags) {
      for (const [key, values] of Object.entries(tags)) {
        const tagKey = key.startsWith('#') ? key : `#${key}`
        filter[tagKey] = values
      }
    }

    const poolQuery = async (urls: string[], f: Record<string, unknown>) => {
      return deps.pool.queryDirect(urls, f as any)
    }

    const result = await handleRelayCount(relays, filter, poolQuery)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- NIP-A7 Spells ---

  server.registerTool('cast-spell', {
    description: 'Execute a NIP-A7 Spell (kind 777). Fetches the Spell event, resolves runtime variables ($me → your pubkey, $contacts → your follow list) and relative timestamps (e.g. "7d", "30d"), builds a REQ filter, and queries relays. Pass either an event ID or a Spell event object from a prior relay-query.',
    inputSchema: {
      eventId: z.string().optional().describe('Event ID (hex) of the kind 777 Spell to cast'),
      relays: z.array(relayUrl).optional().describe('Override relays for the result query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ eventId, relays }) => {
    const result = await handleCastSpell(deps.ctx, deps.pool, { eventId, relays })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('relay-auth', {
    description: 'Authenticate to a relay that requires NIP-42 AUTH. Connects to the relay, waits for an AUTH challenge, signs a kind 22242 event, and sends it back. Returns { authenticated: true/false }. Use this when a relay-query fails due to AUTH requirements, then retry the query.',
    inputSchema: {
      relay: relayUrl.describe('Relay WebSocket URL to authenticate with'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ relay }) => {
    const result = await handleRelayAuth(deps.ctx, relay)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
