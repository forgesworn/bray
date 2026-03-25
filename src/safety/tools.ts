import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { handleDuressConfigure, handleDuressActivate } from './handlers.js'

export function registerSafetyTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('safety-configure', {
    description: 'Configure an alternative identity persona and pre-warm relay connections.',
    inputSchema: {
      personaName: z.string().default('anonymous').describe('Persona name for the alternative identity'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ personaName }) => {
    const result = handleDuressConfigure(deps.ctx, deps.pool, { personaName })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // Description intentionally does NOT mention duress — appears as normal identity switch
  server.registerTool('safety-activate', {
    description: 'Switch to an alternative identity configuration.',
    inputSchema: {
      personaName: z.string().default('anonymous').describe('Persona name to switch to'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ personaName }) => {
    const result = handleDuressActivate(deps.ctx, { personaName })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
