import { validatePublicUrl } from '../validation.js'

export interface Nip05LookupResult {
  pubkey: string
  relays?: string[]
  identifier: string
}

export interface Nip05VerifyResult {
  verified: boolean
  identifier: string
  pubkey: string
}

export interface Nip05RelaysResult {
  identifier: string
  relays: Record<string, string[]>
}

interface Nip05Response {
  names?: Record<string, string>
  relays?: Record<string, string[]>
}

const NIP05_TIMEOUT = 5_000
const NIP05_MAX_SIZE = 256 * 1024 // 256 KB

async function fetchNostrJson(identifier: string): Promise<{ localPart: string; domain: string; json: Nip05Response }> {
  const [localPart, domain] = identifier.split('@')
  if (!localPart || !domain) {
    throw new Error('Invalid NIP-05 identifier: expected user@domain format')
  }

  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(localPart)}`
  validatePublicUrl(url)

  const resp = await fetch(url, { signal: AbortSignal.timeout(NIP05_TIMEOUT) })
  if (!resp.ok) {
    throw new Error(`NIP-05 fetch failed: ${resp.status} ${resp.statusText}`)
  }

  const text = await resp.text()
  if (text.length > NIP05_MAX_SIZE) {
    throw new Error('NIP-05 response too large')
  }

  const json = JSON.parse(text) as Nip05Response
  return { localPart, domain, json }
}

/** Look up a NIP-05 identifier and return the associated pubkey and relay hints */
export async function handleNip05Lookup(identifier: string): Promise<Nip05LookupResult> {
  const { localPart, json } = await fetchNostrJson(identifier)
  const pubkey = json.names?.[localPart]
  if (!pubkey) {
    throw new Error(`No pubkey found for ${identifier}`)
  }

  const relays = json.relays?.[pubkey]
  return {
    pubkey,
    relays: relays?.length ? relays : undefined,
    identifier,
  }
}

/** Verify that a NIP-05 identifier resolves to the expected pubkey */
export async function handleNip05Verify(pubkey: string, identifier: string): Promise<Nip05VerifyResult> {
  try {
    const { localPart, json } = await fetchNostrJson(identifier)
    const resolved = json.names?.[localPart]
    return { verified: resolved === pubkey, identifier, pubkey }
  } catch {
    return { verified: false, identifier, pubkey }
  }
}

/** Fetch relay hints from a NIP-05 identifier */
export async function handleNip05Relays(identifier: string): Promise<Nip05RelaysResult> {
  const { json } = await fetchNostrJson(identifier)
  return {
    identifier,
    relays: json.relays ?? {},
  }
}

/** Verify NIP-05 identifier against a pubkey (shared helper for workflow) */
export async function verifyNip05(pubkeyHex: string, nip05: string): Promise<boolean> {
  const result = await handleNip05Verify(pubkeyHex, nip05)
  return result.verified
}
