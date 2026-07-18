import { describe, expect, it, vi } from 'vitest'
import { registerSocialTools } from '../../src/social/tools.js'

describe('publish-event structured validation failure', () => {
  it('returns machine-readable issues and does not sign or publish', async () => {
    const tools = new Map<string, any>()
    const sign = vi.fn()
    const publish = vi.fn()
    registerSocialTools({
      registerTool(name: string, definition: unknown, handler: unknown) {
        tools.set(name, { definition, handler })
      },
    } as any, {
      ctx: {
        getSigningFunction: () => sign,
        activeNpub: 'npub-test',
        activePublicKeyHex: 'a'.repeat(64),
      },
      pool: { publish },
      veilCacheTtl: 1,
      veilCacheMax: 1,
    } as any)

    const response = await tools.get('publish-event').handler({
      kind: 30023,
      content: '# Missing d tag',
      tags: [],
      validationMode: 'strict-known',
    })
    const body = JSON.parse(response.content[0].text)
    expect(response.isError).toBe(true)
    expect(body.error).toBe('event_semantic_validation_failed')
    expect(body.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expect.any(String), path: expect.any(Array), suggestion: expect.any(String) }),
    ]))
    expect(sign).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
