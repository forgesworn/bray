/**
 * Universal recipient resolver.
 *
 * Accepts any human-friendly identifier (name, NIP-05, npub, nprofile, hex)
 * and resolves it to a hex pubkey. Used by dispatch tools and eventually
 * all tools that accept a recipient.
 */

import { decode } from 'nostr-tools/nip19'
import type { RelayPool } from './relay-pool.js'
import { handleNip05Lookup } from './identity/nip05.js'

const HEX_64 = /^[0-9a-f]{64}$/

export type ResolvedVia = 'hex' | 'npub' | 'nprofile' | 'nip05' | 'name'

export interface ResolvedRecipient {
  pubkeyHex: string
  resolvedVia: ResolvedVia
  displayName?: string
  relayHints?: string[]
}

/**
 * Resolve a human-friendly identifier to a hex pubkey.
 *
 * Resolution order:
 * 1. 64-char hex string → direct passthrough
 * 2. npub1… / nprofile1… → NIP-19 decode
 * 3. contains @ → NIP-05 HTTP lookup
 * 4. Plain name → search the provided name map (e.g. dispatch identities)
 *
 * Throws if the identifier cannot be resolved.
 */
export async function resolveRecipient(
  input: string,
  knownNames?: Map<string, string>,
): Promise<ResolvedRecipient> {
  const trimmed = input.trim()

  // 1. Hex pubkey
  if (HEX_64.test(trimmed)) {
    const name = knownNames ? reverseLookup(knownNames, trimmed) : undefined
    return { pubkeyHex: trimmed, resolvedVia: 'hex', displayName: name }
  }

  // 2. NIP-19 (npub, nprofile — strip nostr: prefix if present)
  const cleaned = trimmed.replace(/^nostr:/, '')
  if (cleaned.startsWith('npub1') || cleaned.startsWith('nprofile1')) {
    const decoded = decode(cleaned)
    const hex = typeof decoded.data === 'string'
      ? decoded.data
      : (decoded.data as { pubkey: string }).pubkey
    const name = knownNames ? reverseLookup(knownNames, hex) : undefined
    const relayHints = typeof decoded.data !== 'string'
      ? (decoded.data as { pubkey: string; relays?: string[] }).relays?.filter(Boolean)
      : undefined
    return {
      pubkeyHex: hex,
      resolvedVia: decoded.type === 'npub' ? 'npub' : 'nprofile',
      displayName: name,
      relayHints: relayHints?.length ? relayHints : undefined,
    }
  }

  // 3. NIP-05 (contains @)
  if (trimmed.includes('@')) {
    const result = await handleNip05Lookup(trimmed)
    const name = knownNames ? reverseLookup(knownNames, result.pubkey) : undefined
    return { pubkeyHex: result.pubkey, resolvedVia: 'nip05', displayName: name ?? trimmed }
  }

  // 4. Name lookup
  if (knownNames) {
    const key = trimmed.toLowerCase()
    const hex = knownNames.get(key)
    if (hex) {
      return { pubkeyHex: hex, resolvedVia: 'name', displayName: trimmed }
    }
  }

  // Nothing matched.
  // Redact the input in the error message when it looks like private key
  // material — a mistyped nsec or ncryptsec sent through this resolver should
  // not end up echoed into logs. Also do not enumerate known contact names,
  // since that helps an attacker probe the identities file.
  const redacted = redactIdentifier(input)
  throw new Error(
    `Cannot resolve "${redacted}". Expected: 64-char hex, npub, nprofile, user@domain, or a known name.`,
  )
}

/** Redact identifiers that look like private key material. */
function redactIdentifier(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('nsec1')) {
    return `nsec1…<redacted>`
  }
  if (trimmed.startsWith('ncryptsec1')) {
    return `ncryptsec1…<redacted>`
  }
  if (trimmed.length > 128) {
    return `${trimmed.slice(0, 32)}…<${trimmed.length} chars>`
  }
  return trimmed
}

/**
 * Batch-resolve an array of human-friendly identifiers to hex pubkeys.
 *
 * Resolves all inputs in parallel via `resolveRecipient`.
 */
export async function resolveRecipients(
  inputs: string[],
  knownNames?: Map<string, string>,
): Promise<ResolvedRecipient[]> {
  return Promise.all(inputs.map(input => resolveRecipient(input, knownNames)))
}

export interface ResolvedWithProfile extends ResolvedRecipient {
  profile?: Record<string, unknown>
}

/**
 * Resolve a recipient and attempt to fetch their kind 0 profile using
 * relay hints embedded in nprofile or NIP-05 relay lists (NIP-65 chasing).
 *
 * If relay hints are available, queries those relays directly for the profile.
 * Falls back gracefully — the profile field will be undefined if no hints
 * are present or the query fails.
 */
export async function resolveWithProfile(
  input: string,
  pool: RelayPool,
  npub: string,
): Promise<ResolvedWithProfile> {
  const resolved = await resolveRecipient(input)

  // If we have relay hints (from nprofile), query them directly for the kind 0 profile
  if (resolved.relayHints && resolved.relayHints.length > 0) {
    try {
      const events = await pool.queryDirect(resolved.relayHints, {
        kinds: [0],
        authors: [resolved.pubkeyHex],
      })
      if (events.length > 0) {
        const best = events.reduce((a, b) => b.created_at > a.created_at ? b : a)
        try {
          const profile = JSON.parse(best.content)
          return { ...resolved, profile }
        } catch { /* fall through */ }
      }
    } catch { /* relay hint query failed, fall through */ }
  }

  // No relay hints or hint query failed — try standard pool query
  try {
    const events = await pool.query(npub, {
      kinds: [0],
      authors: [resolved.pubkeyHex],
    })
    if (events.length > 0) {
      const best = events.reduce((a, b) => b.created_at > a.created_at ? b : a)
      try {
        const profile = JSON.parse(best.content)
        return { ...resolved, profile }
      } catch { /* fall through */ }
    }
  } catch { /* profile fetch failed, return without profile */ }

  return { ...resolved }
}

function reverseLookup(map: Map<string, string>, hex: string): string | undefined {
  for (const [name, value] of map) {
    if (value === hex) return name
  }
  return undefined
}
