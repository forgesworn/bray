import { z } from 'zod'

/**
 * Helpers for tools whose MCP clients send arguments in either a flat shape or
 * a single nested wrapper object.
 *
 * Background
 * ----------
 * The MCP SDK normalises every tool's inputSchema into a strict `z.object` with
 * default strip behaviour, which silently drops unknown top-level keys. For
 * filter-like or options-like tools, real clients routinely reach for a natural
 * wrapper name ("filter", "profile", "options") even when the tool exposes the
 * underlying fields at the top level. Without an explicit alias, the wrapper is
 * stripped and the handler runs against an empty argument set.
 *
 * Two bugs in this class (`execute-action` at catalog.ts and `relay-query` at
 * relay/tools.ts) have already been fixed by hand with ad-hoc alias declarations
 * and merge logic. This module factors that pattern out so every new filter- or
 * options-shaped tool can opt in with one line at the schema and one line at the
 * top of the handler.
 *
 * Usage
 * -----
 *   server.registerTool('my-tool', {
 *     inputSchema: {
 *       // Any non-wrapper fields (required or optional) declared as normal:
 *       relays: z.array(z.string()),
 *       // Then spread the wrapped subset alongside them:
 *       ...flatOrWrapped({
 *         kinds: z.array(z.number()).optional(),
 *         authors: z.array(z.string()).optional(),
 *       }, 'filter'),
 *     },
 *   }, async (args) => {
 *     const merged = mergeFlatAndWrapped<{
 *       kinds?: number[]; authors?: string[];
 *     }>(args, 'filter')
 *     // Use merged.kinds, merged.authors as normal.
 *   })
 */

/**
 * Build a zod input-schema fragment declaring a set of flat fields plus a
 * single wrapper-object alias carrying the same fields.
 *
 * The returned object is a `ZodRawShape` ready to spread into an MCP tool's
 * inputSchema. Every flat field is forwarded as-is so any required/optional
 * semantics declared by the caller are preserved at the top level. The wrapper
 * field is always optional and contains every flat field with `.optional()`
 * applied, so a caller can supply any subset inside the wrapper.
 *
 * The wrapper is emitted as a named zod field, which means it survives both
 * the MCP SDK's outer schema strip **and** the ActionCatalog's inner strip at
 * `src/catalog.ts` (for catalog-routed tools).
 */
export function flatOrWrapped<F extends z.ZodRawShape>(
  flat: F,
  wrapperName: string,
): F & Record<string, z.ZodOptional<z.ZodObject<z.ZodRawShape>>> {
  const wrappedShape: Record<string, z.ZodTypeAny> = {}
  for (const [key, type] of Object.entries(flat)) {
    // Each wrapper field is always optional so the caller can send any subset.
    // `.optional()` on an already-optional zod type is idempotent, so this is
    // safe whether the flat schema marked the field optional or not.
    wrappedShape[key] = (type as z.ZodTypeAny).optional()
  }
  const wrapper = z.object(wrappedShape).optional().describe(
    `Alias: all ${wrapperName} fields wrapped in a single object. Merged with any ` +
    'top-level fields; top-level values win on conflict.',
  )
  return {
    ...flat,
    [wrapperName]: wrapper,
  } as F & Record<string, z.ZodOptional<z.ZodObject<z.ZodRawShape>>>
}

/**
 * Merge the wrapper object with the top-level fields of an MCP tool's args.
 *
 * Precedence: top-level values win on conflict. This preserves the canonical
 * shape as authoritative while letting clients that only supplied the wrapper
 * still have every field reach the handler. Fields present only in the wrapper
 * fall through to the merged result, and the wrapper key itself is removed
 * from the output.
 *
 * Unknown fields inside the wrapper are passed through verbatim -- zod has
 * already validated them against the wrapper schema at the SDK boundary, so
 * anything the handler sees in the wrapper was declared by the caller.
 *
 * Empty args or a missing wrapper both yield a copy of the original top-level
 * fields with the wrapper key stripped, so callers can blindly pass the
 * merged object into their existing handler shape.
 */
export function mergeFlatAndWrapped<T extends Record<string, unknown>>(
  args: Record<string, unknown> | undefined,
  wrapperName: string,
): T {
  if (!args) return {} as T
  const { [wrapperName]: wrapper, ...flat } = args
  const wrapperObj = (wrapper && typeof wrapper === 'object' ? wrapper as Record<string, unknown> : {})
  const merged: Record<string, unknown> = { ...wrapperObj }
  for (const [key, value] of Object.entries(flat)) {
    // Top-level values win on conflict. Undefined counts as "not supplied"
    // so a wrapper value can still surface through an unset top-level key.
    if (value !== undefined) merged[key] = value
  }
  return merged as T
}
