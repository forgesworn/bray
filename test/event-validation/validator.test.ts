import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  EventSemanticValidationError,
  KIND_REGISTRY_COMMIT,
  KIND_REGISTRY_SHA256,
  PINNED_KIND_REGISTRY,
  handleValidateEvent,
} from '../../src/event-validation/index.js'
import { handlePublishEvent } from '../../src/social/handlers.js'
import { handlePublishRaw } from '../../src/event/handlers.js'

const TEST_KEY = '0'.repeat(63) + '1'

describe('pinned Registry of Kinds validation', () => {
  it('ships an immutable, identified registry snapshot', () => {
    expect(KIND_REGISTRY_COMMIT).toBe('d51285770b3093e575bdf8d0bd81786fe1efbd6d')
    expect(KIND_REGISTRY_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(PINNED_KIND_REGISTRY.kinds)).toHaveLength(255)
  })

  it('accepts valid known-kind content', () => {
    const result = handleValidateEvent({ kind: 0, content: '{"name":"agent"}', tags: [] })
    expect(result).toMatchObject({ valid: true, knownKind: true, status: 'known-valid' })
    expect(result.issues).toEqual([])
  })

  it('returns machine-readable errors and fixes for malformed known kinds', () => {
    const result = handleValidateEvent({ kind: 0, content: 'not-json', tags: [] })
    expect(result.valid).toBe(false)
    expect(result.status).toBe('known-invalid')
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'value.invalid_json',
      path: ['content'],
      severity: 'error',
      suggestion: expect.stringContaining('JSON.stringify'),
    }))
  })

  it('reports an exact tag item path for invalid protocol values', () => {
    const result = handleValidateEvent({ kind: 1, content: 'hello', tags: [['p', 'not-a-pubkey']] })
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'value.invalid_pubkey',
      path: ['tags', 0, 1],
    }))
  })

  it('requires the d tag for known addressable kinds', () => {
    const result = handleValidateEvent({ kind: 30023, content: '# Article', tags: [] })
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'tag.required_missing',
      message: expect.stringContaining('"d"'),
    }))
  })

  it('allows unknown experimental kinds with a warning', () => {
    const kind = 65_535
    expect(PINNED_KIND_REGISTRY.kinds[String(kind)]).toBeUndefined()
    const result = handleValidateEvent({ kind, content: 'experimental', tags: [['x', 'value']] })
    expect(result).toMatchObject({ valid: true, knownKind: false, status: 'unknown' })
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'kind.unknown', severity: 'warning' }))
  })

  it('makes the off escape hatch explicit in the result', () => {
    const result = handleValidateEvent({ kind: 0, content: 'not-json', tags: [] }, 'off')
    expect(result).toMatchObject({ valid: true, status: 'validation-off', mode: 'off' })
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'validation.off' }))
  })

  it('keeps basic shape and safety checks enabled when protocol validation is off', () => {
    const result = handleValidateEvent({ kind: -1, content: 42, tags: 'not-tags' }, 'off')
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'event.invalid_kind', severity: 'error' }),
      expect.objectContaining({ code: 'event.invalid_content', severity: 'error' }),
      expect.objectContaining({ code: 'event.invalid_tags', severity: 'error' }),
      expect.objectContaining({ code: 'validation.off', severity: 'warning' }),
    ]))
  })
})

describe('validation at arbitrary signing boundaries', () => {
  let ctx: IdentityContext
  const pool = {
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.example'], rejected: [], errors: [] }),
    publishDirect: vi.fn(),
  }

  beforeEach(() => {
    ctx = new IdentityContext(TEST_KEY, 'hex')
    vi.clearAllMocks()
  })

  afterEach(() => ctx.destroy())

  it('rejects malformed known events before signing or publishing', async () => {
    await expect(handlePublishEvent(ctx, pool as any, {
      kind: 0,
      content: 'not-json',
      tags: [],
    })).rejects.toBeInstanceOf(EventSemanticValidationError)
    expect(pool.publish).not.toHaveBeenCalled()
  })

  it('returns the validation evidence with a published event', async () => {
    const result = await handlePublishEvent(ctx, pool as any, {
      kind: 0,
      content: '{"name":"agent"}',
      tags: [],
    })
    expect(result.validation.status).toBe('known-valid')
    expect(result.event.kind).toBe(0)
    expect(pool.publish).toHaveBeenCalledOnce()
  })

  it('validates publish-raw and rejects invalid pre-signed events', async () => {
    await expect(handlePublishRaw(ctx, pool as any, {
      noSign: true,
      event: {
        id: '0'.repeat(64),
        pubkey: '0'.repeat(64),
        sig: '0'.repeat(128),
        kind: 0,
        created_at: 1,
        content: '{}',
        tags: [],
      },
    })).rejects.toThrow('invalid event ID or signature')
    expect(pool.publish).not.toHaveBeenCalled()
  })
})
