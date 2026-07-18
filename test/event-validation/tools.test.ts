import { describe, expect, it } from 'vitest'
import { registerUtilTools } from '../../src/util/tools.js'

describe('validate-event MCP action', () => {
  it('registers as a read-only catalog-compatible action', () => {
    const tools = new Map<string, any>()
    const server = {
      registerTool(name: string, definition: unknown, handler: unknown) {
        tools.set(name, { definition, handler })
      },
    }
    registerUtilTools(server as any, { ctx: {} as any, pool: {} as any } as any)

    const action = tools.get('validate-event')
    expect(action).toBeDefined()
    expect(action.definition.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    expect(action.definition.description).toContain('pinned Registry of Kinds')
  })
})
