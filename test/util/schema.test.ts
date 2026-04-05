import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { flatOrWrapped, mergeFlatAndWrapped } from '../../src/util/schema.js'

/**
 * Unit tests for the flat-or-wrapped schema helper.
 *
 * See src/util/schema.ts for the rationale. These tests pin the contract the
 * three filter-shaped tools (relay-count, count, social-profile-set) rely on:
 *
 *   - flat args only (backwards-compat with the canonical shape)
 *   - wrapped args only (the new shape real MCP clients naturally reach for)
 *   - both present (top-level wins on conflict, non-conflicting wrapper keys
 *     still reach the handler)
 *   - empty args (yields `{}`)
 *   - extra fields in the wrapper (passed through verbatim; the outer zod
 *     layer is responsible for validating what's allowed inside the wrapper)
 */
describe('flatOrWrapped schema builder', () => {
  it('returns every flat key plus the wrapper key', () => {
    const shape = flatOrWrapped({
      kinds: z.array(z.number()).optional(),
      authors: z.array(z.string()).optional(),
    }, 'filter')
    expect(Object.keys(shape).sort()).toEqual(['authors', 'filter', 'kinds'])
  })

  it('produces a schema a z.object() accepts (ActionCatalog inner-strip compat)', () => {
    // The ActionCatalog strips catalog-routed args a second time with
    // `z.object(entry.inputSchema).safeParse(params)`. This test pins that the
    // helper's output composes cleanly into z.object().
    const shape = flatOrWrapped({
      kinds: z.array(z.number()).optional(),
      authors: z.array(z.string()).optional(),
    }, 'filter')
    const schema = z.object(shape)
    const result = schema.safeParse({ filter: { kinds: [1], authors: ['abc'] } })
    expect(result.success).toBe(true)
  })

  it('accepts flat args', () => {
    const shape = flatOrWrapped({
      kinds: z.array(z.number()).optional(),
    }, 'filter')
    const parsed = z.object(shape).parse({ kinds: [1, 7] })
    expect(parsed.kinds).toEqual([1, 7])
  })

  it('accepts wrapped args', () => {
    const shape = flatOrWrapped({
      kinds: z.array(z.number()).optional(),
    }, 'filter')
    const parsed = z.object(shape).parse({ filter: { kinds: [1, 7] } })
    expect((parsed as Record<string, unknown>).filter).toEqual({ kinds: [1, 7] })
  })

  it('accepts both shapes at once', () => {
    const shape = flatOrWrapped({
      kinds: z.array(z.number()).optional(),
      authors: z.array(z.string()).optional(),
    }, 'filter')
    const parsed = z.object(shape).parse({
      kinds: [7],
      filter: { authors: ['abc'] },
    })
    expect(parsed.kinds).toEqual([7])
    expect((parsed as Record<string, unknown>).filter).toEqual({ authors: ['abc'] })
  })

  it('forces every wrapper field to be optional even when the flat field is required', () => {
    // A flat `required` field should still be acceptable when wrapped. Clients
    // may supply any subset inside the wrapper.
    const shape = flatOrWrapped({
      kinds: z.array(z.number()), // non-optional at top level
    }, 'filter')
    // Supplying only the wrapper with zero keys inside must still parse, since
    // the wrapper itself is optional and every wrapper field is optional.
    const parsed = z.object(shape).parse({ filter: {}, kinds: [1] })
    expect(parsed.kinds).toEqual([1])
  })
})

describe('mergeFlatAndWrapped', () => {
  it('returns an empty object for undefined args', () => {
    expect(mergeFlatAndWrapped(undefined, 'filter')).toEqual({})
  })

  it('returns an empty object for empty args', () => {
    expect(mergeFlatAndWrapped({}, 'filter')).toEqual({})
  })

  it('flat args only pass through (the wrapper key is stripped even when absent)', () => {
    expect(mergeFlatAndWrapped(
      { kinds: [1], authors: ['abc'] },
      'filter',
    )).toEqual({ kinds: [1], authors: ['abc'] })
  })

  it('wrapper-only args surface at the top level of the merged result', () => {
    expect(mergeFlatAndWrapped(
      { filter: { kinds: [1], authors: ['abc'] } },
      'filter',
    )).toEqual({ kinds: [1], authors: ['abc'] })
  })

  it('top-level wins on conflict, wrapper fields that do not conflict still surface', () => {
    // Precedence rule: canonical (top-level) shape is authoritative.
    expect(mergeFlatAndWrapped(
      {
        kinds: [7],
        filter: { kinds: [1], authors: ['abc'] },
      },
      'filter',
    )).toEqual({ kinds: [7], authors: ['abc'] })
  })

  it('undefined top-level values fall through to the wrapper value', () => {
    // An explicit `undefined` at the top level should not mask a wrapper value.
    expect(mergeFlatAndWrapped(
      {
        kinds: undefined,
        filter: { kinds: [1] },
      },
      'filter',
    )).toEqual({ kinds: [1] })
  })

  it('strips the wrapper key from the output', () => {
    const merged = mergeFlatAndWrapped(
      { filter: { kinds: [1] } },
      'filter',
    ) as Record<string, unknown>
    expect(merged.filter).toBeUndefined()
  })

  it('passes unknown wrapper-inner fields through verbatim', () => {
    // Unknown-field behaviour: the wrapper is a zod object at the schema layer
    // so anything reaching this helper has already been validated. The helper
    // itself does not re-check; it merges everything the wrapper contains.
    expect(mergeFlatAndWrapped(
      { filter: { kinds: [1], somethingExtra: 'hello' } },
      'filter',
    )).toEqual({ kinds: [1], somethingExtra: 'hello' })
  })

  it('non-object wrapper values are treated as empty', () => {
    // Defensive: if something weird makes it through (should never happen with
    // zod validation but worth pinning), don't throw.
    expect(mergeFlatAndWrapped(
      { filter: 'oops' as unknown, kinds: [1] },
      'filter',
    )).toEqual({ kinds: [1] })
  })
})
