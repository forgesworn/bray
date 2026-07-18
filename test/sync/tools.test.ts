import { describe, expect, it, vi } from 'vitest'
import { registerSyncTools } from '../../src/sync/tools.js'

describe('sync-plan MCP action', () => {
  it('is catalog-compatible, read-only, and performs no transfer', async () => {
    const tools = new Map<string, any>()
    const server = {
      registerTool(name: string, definition: unknown, handler: unknown) {
        tools.set(name, { definition, handler })
      },
    }
    const pool = {
      reconcileDirect: vi.fn().mockResolvedValue({
        localOnlyIds: [], remoteOnlyIds: [],
        localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
      }),
      queryDirect: vi.fn(),
      publishDirect: vi.fn(),
    }
    registerSyncTools(server as any, { ctx: {} as any, pool } as any)

    const action = tools.get('sync-plan')
    expect(action.definition.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    const response = await action.handler({
      relay: 'wss://relay.example.com',
      maxIds: 100,
      maxRemoteEvents: 100,
      timeoutMs: 1_000,
      protocol: 'auto',
    })
    expect(JSON.parse(response.content[0].text)).toMatchObject({ protocol: 'nip77' })
    expect(pool.queryDirect).not.toHaveBeenCalled()
    expect(pool.publishDirect).not.toHaveBeenCalled()
  })
})
