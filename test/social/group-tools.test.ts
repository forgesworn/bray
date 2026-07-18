import { describe, expect, it } from 'vitest'
import { registerSocialTools } from '../../src/social/tools.js'

describe('NIP-29 MCP surface', () => {
  it('requires relay-scoped operations and removes the unsafe stale role mutation', () => {
    const tools = new Map<string, any>()
    const server = {
      registerTool(name: string, definition: unknown, handler: unknown) {
        tools.set(name, { definition, handler })
      },
    }
    registerSocialTools(server as any, {
      ctx: {} as any,
      pool: {} as any,
      veilCacheTtl: 1,
      veilCacheMax: 1,
    } as any)

    expect(tools.has('group-set-roles')).toBe(false)
    for (const name of [
      'group-info', 'group-chat', 'group-send', 'group-members', 'group-inspect',
      'group-create', 'group-update', 'group-add-user', 'group-remove-user',
      'group-invite-create', 'group-join', 'group-leave', 'group-delete-event', 'group-delete',
      'group-forum-topics', 'group-forum-topic-create', 'group-forum-comments', 'group-forum-comment',
    ]) {
      expect(tools.get(name)?.definition.inputSchema.relay, `${name} relay schema`).toBeDefined()
    }
    expect(tools.get('group-delete').definition.annotations.destructiveHint).toBe(true)
    expect(tools.get('group-delete-event').definition.annotations.destructiveHint).toBe(true)
    expect(tools.get('group-inspect').definition.annotations.readOnlyHint).toBe(true)
  })
})
