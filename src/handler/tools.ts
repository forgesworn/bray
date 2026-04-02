import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import { handleHandlerPublish, handleHandlerDiscover } from './handlers.js'

export function registerHandlerTools(server: McpServer, deps: ToolDeps): void {
  // --- handler-publish ---

  server.registerTool('handler-publish', {
    description: 'Publish a NIP-XX Machine Application Handler card (kind 31990) advertising MCP transport endpoints. Lets other agents and tools discover MCP servers on Nostr by the event kinds they support. Provide at least one of stdio_command or http_url.',
    inputSchema: {
      name: z.string().describe('Handler name (e.g. "nostr-bray", "402-mcp")'),
      about: z.string().describe('What this handler does'),
      kinds: z.array(z.string()).describe('Event kinds this handler supports (e.g. ["1", "31402"])'),
      stdio_command: z.string().optional().describe('stdio transport command (e.g. "npx nostr-bray")'),
      http_url: z.string().optional().describe('HTTP transport URL (e.g. "https://mcp.example.com/sse")'),
      picture: z.string().optional().describe('Icon URL'),
      d_tag: z.string().optional().describe('Custom d-tag identifier (defaults to slugified name)'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, about, kinds, stdio_command, http_url, picture, d_tag, output }) => {
    const result = await handleHandlerPublish(deps.ctx, deps.pool, {
      name,
      about,
      kinds,
      stdioCommand: stdio_command,
      httpUrl: http_url,
      picture,
      dTag: d_tag,
    })
    return toolResponse(result, output, fmt.formatPublish)
  })

  // --- handler-discover ---

  server.registerTool('handler-discover', {
    description: 'Discover MCP-capable handlers on Nostr. Searches for kind 31990 events that include mcp transport tags. Optionally filter by supported event kind. Returns handler names, descriptions, supported kinds, and transport endpoints.',
    inputSchema: {
      kind: z.string().optional().describe('Filter by supported event kind (e.g. "1", "31402")'),
      limit: z.number().optional().describe('Maximum number of results (default: 20)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ kind, limit, output }) => {
    const result = await handleHandlerDiscover(deps.pool, deps.ctx.activeNpub, {
      kind,
      limit,
    })
    return toolResponse(result, output, fmt.formatHandlers)
  })
}
