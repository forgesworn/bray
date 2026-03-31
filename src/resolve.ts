/**
 * Universal recipient resolver.
 *
 * Accepts any human-friendly identifier (name, NIP-05, npub, nprofile, hex)
 * and resolves it to a hex pubkey. Used by dispatch tools and eventually
 * all tools that accept a recipient.
 */

import { decode } from 'nostr-tools/nip19'
import { handleNip05Lookup } from './identity/nip05.js'

const HEX_64 = /^[0-9a-f]{64}$/

export type ResolvedVia = 'hex' | 'npub' | 'nprofile' | 'nip05' | 'name'

export interface ResolvedRecipient {
  pubkeyHex: string
  resolvedVia: ResolvedVia
  displayName?: string
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
    return {
      pubkeyHex: hex,
      resolvedVia: decoded.type === 'npub' ? 'npub' : 'nprofile',
      displayName: name,
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

  // Nothing matched
  const known = knownNames ? [...knownNames.keys()].join(', ') : 'none'
  throw new Error(
    `Cannot resolve "${input}". Expected: 64-char hex, npub, nprofile, user@domain, or a known name (${known}).`,
  )
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

function reverseLookup(map: Map<string, string>, hex: string): string | undefined {
  for (const [name, value] of map) {
    if (value === hex) return name
  }
  return undefined
}
