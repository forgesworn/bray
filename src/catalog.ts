import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

interface CatalogEntry {
  name: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: Record<string, any>
  annotations?: Record<string, boolean>
  handler: ToolHandler
}

/**
 * Holds non-promoted tool definitions and exposes them via search-actions
 * and execute-action meta-tools. This keeps the primary tool list lean
 * (context-window economics) while still making every action discoverable.
 */
export class ActionCatalog {
  private readonly entries = new Map<string, CatalogEntry>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add(name: string, definition: any, handler: ToolHandler): void {
    this.entries.set(name, {
      name,
      description: definition.description ?? '',
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
      handler,
    })
  }

  get size(): number {
    return this.entries.size
  }

  search(intent: string): Array<{ name: string; description: string; parameters?: Record<string, string> }> {
    const tokens = intent.toLowerCase().split(/[\s\-_]+/).filter(t => t.length > 1)
    const scored: Array<{ entry: CatalogEntry; score: number }> = []

    for (const entry of this.entries.values()) {
      const haystack = `${entry.name} ${entry.description}`.toLowerCase()
      let score = 0
      for (const token of tokens) {
        if (haystack.includes(token)) score++
      }
      if (score > 0) scored.push({ entry, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 10).map(({ entry }) => ({
      name: entry.name,
      description: entry.description,
      parameters: extractParams(entry.inputSchema),
    }))
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const entry = this.entries.get(name)
    if (!entry) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `Unknown action "${name}". Use search-actions to find available actions.`,
          }),
        }],
      }
    }

    if (entry.inputSchema && Object.keys(entry.inputSchema).length > 0) {
      const schema = z.object(entry.inputSchema)
      const result = schema.safeParse(params)
      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Invalid parameters',
              action: name,
              issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
              expected: extractParams(entry.inputSchema),
            }, null, 2),
          }],
        }
      }
      return entry.handler(result.data)
    }

    return entry.handler(params)
  }

  registerMetaTools(server: McpServer): void {
    const catalog = this

    server.registerTool('search-actions', {
      description:
        `Search ${catalog.size} additional actions by describing what you want to do. ` +
        'Returns matching actions with names, descriptions, and parameter schemas. ' +
        'Use this when the promoted tools (whoami, social-post, social-reply, social-feed, ' +
        'dm-send, dm-read, zap-send, zap-balance, identity-switch, relay-query) ' +
        'do not cover what you need.',
      inputSchema: {
        intent: z.string().describe(
          'Describe what you want to do (e.g. "upload a file", "verify an attestation", ' +
          '"encrypt a message", "manage contacts", "ring signature")',
        ),
      },
      annotations: { readOnlyHint: true },
    }, async ({ intent }) => {
      const matches = catalog.search(intent)
      if (matches.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              matches: [],
              hint: 'No matches found. Try different keywords or broader terms.',
            }, null, 2),
          }],
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ matches }, null, 2),
        }],
      }
    })

    server.registerTool('execute-action', {
      description:
        'Execute an action found via search-actions. Pass the exact action name and its parameters.',
      inputSchema: {
        action: z.string().describe('Action name from search-actions results'),
        params: z.record(z.string(), z.unknown()).default({}).describe(
          'Parameters for the action (see search-actions results for expected params)',
        ),
      },
      annotations: { openWorldHint: true },
    }, async ({ action, params }) => {
      return catalog.execute(action, params as Record<string, unknown>)
    })
  }
}

/**
 * Create a proxy around McpServer that intercepts registerTool calls.
 * Promoted tools go to the real server; everything else goes to the catalog.
 */
export function createCatalogProxy(
  server: McpServer,
  catalog: ActionCatalog,
  promoted: Set<string>,
): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (name: string, definition: any, handler: any) => {
          if (promoted.has(name)) {
            return target.registerTool(name, definition, handler)
          }
          catalog.add(name, definition, handler)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParams(schema?: Record<string, any>): Record<string, string> | undefined {
  if (!schema || Object.keys(schema).length === 0) return undefined
  const params: Record<string, string> = {}
  for (const [key, zodType] of Object.entries(schema)) {
    params[key] = zodType?.description ?? '(no description)'
  }
  return params
}
