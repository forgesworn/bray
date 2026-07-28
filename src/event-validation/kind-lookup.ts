/**
 * Kind lookup over the pinned Registry of Kinds snapshot.
 *
 * The validator answers "is this event well formed?". This answers the question
 * that comes before it: "what does this kind expect?" — description, storage
 * class, required and repeatable tags, and the value type at each tag position.
 *
 * Reads the same `PINNED_KIND_REGISTRY` the validator uses, so lookup and
 * validation can never disagree about what a kind requires.
 */

import { PINNED_KIND_REGISTRY } from './registry.generated.js'
import type { RegistryContentSpec, RegistryTagSpec } from './registry-types.js'

/** NIP-01 storage class, derived from the kind number alone. */
export type KindClass = 'regular' | 'replaceable' | 'ephemeral' | 'addressable'

/** Addressable (parameterised replaceable) kinds require a `d` tag. */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30_000 && kind < 40_000
}

/** Replaceable kinds: relays keep only the latest event per (pubkey, kind). */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000)
}

/** Ephemeral kinds are not stored by relays. */
export function isEphemeralKind(kind: number): boolean {
  return kind >= 20_000 && kind < 30_000
}

/** Storage class for a kind number. */
export function kindClass(kind: number): KindClass {
  if (isAddressableKind(kind)) return 'addressable'
  if (isEphemeralKind(kind)) return 'ephemeral'
  if (isReplaceableKind(kind)) return 'replaceable'
  return 'regular'
}

export interface KindInfo {
  kind: number
  description?: string
  inUse: boolean
  class: KindClass
  content?: RegistryContentSpec
  requiredTags: string[]
  repeatableTags: string[]
  tags: RegistryTagSpec[]
  /** False when the kind is absent from the registry; the class is still known. */
  known: boolean
}

/**
 * Look up a kind by number.
 *
 * Unknown kinds still report their storage class, since that follows from the
 * number rather than the registry — useful for experimental kinds.
 */
export function lookupKind(kind: number): KindInfo {
  const schema = PINNED_KIND_REGISTRY.kinds[String(kind)]
  const required = [...(schema?.required ?? [])]
  // Addressable kinds always need a `d` tag, whether or not the schema says so
  if (isAddressableKind(kind) && !required.includes('d')) required.push('d')

  return {
    kind,
    description: schema?.description,
    inUse: schema?.in_use ?? false,
    class: kindClass(kind),
    content: schema?.content,
    requiredTags: required,
    repeatableTags: schema?.multiple ?? [],
    tags: schema?.tags ?? [],
    known: schema !== undefined,
  }
}

/**
 * Find kinds whose description matches a query, case-insensitively.
 *
 * Exact matches rank first, then prefixes, then substrings, so searching
 * "short text note" puts kind 1 at the top rather than burying it among the
 * dozens of kinds whose descriptions merely contain "note".
 */
export function searchKinds(query: string, limit = 20): KindInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const scored: Array<{ kind: number; score: number }> = []
  for (const [k, schema] of Object.entries(PINNED_KIND_REGISTRY.kinds)) {
    const desc = (schema.description ?? '').toLowerCase()
    if (!desc) continue
    let score = -1
    if (desc === q) score = 0
    else if (desc.startsWith(q)) score = 1
    else if (desc.includes(q)) score = 2
    if (score >= 0) scored.push({ kind: Number(k), score })
  }

  scored.sort((a, b) => a.score - b.score || a.kind - b.kind)
  return scored.slice(0, limit).map(s => lookupKind(s.kind))
}
