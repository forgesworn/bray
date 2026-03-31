import { decode, nprofileEncode, neventEncode, npubEncode, nsecEncode, naddrEncode, noteEncode } from 'nostr-tools/nip19'
import { verifyEvent, getPublicKey } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'

// --- Decode ---

export interface DecodeResult {
  type: string
  data: unknown
}

/** Decode any nip19 entity (npub, nsec, note, nevent, nprofile, naddr) to its components */
export function handleDecode(input: string): DecodeResult {
  // Strip nostr: prefix if present
  const cleaned = input.replace(/^nostr:/, '')
  const decoded = decode(cleaned)

  if (decoded.type === 'nsec') {
    // Never return private key — derive pubkey instead
    const pubkey = getPublicKey(decoded.data as Uint8Array)
    return { type: 'nsec', data: { pubkeyHex: pubkey, npub: npubEncode(pubkey), warning: 'Private key not returned for safety' } }
  }

  return { type: decoded.type, data: decoded.data }
}

// --- Encode ---

/** Encode a hex pubkey as npub */
export function handleEncodeNpub(hex: string): string {
  return npubEncode(hex)
}

/** Encode a hex event ID as note */
export function handleEncodeNote(hex: string): string {
  return noteEncode(hex)
}

/** Encode a hex pubkey + relay hints as nprofile */
export function handleEncodeNprofile(pubkey: string, relays?: string[]): string {
  return nprofileEncode({ pubkey, relays })
}

/** Encode event pointer as nevent */
export function handleEncodeNevent(id: string, relays?: string[], author?: string): string {
  return neventEncode({ id, relays, author })
}

/** Encode addressable event as naddr */
export function handleEncodeNaddr(pubkey: string, kind: number, identifier: string, relays?: string[]): string {
  return naddrEncode({ pubkey, kind, identifier, relays })
}

// --- Verify ---

/** Verify an event's id hash and signature */
export function handleVerify(event: NostrEvent): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required fields
  if (!event.id) errors.push('missing id')
  if (!event.pubkey) errors.push('missing pubkey')
  if (!event.sig) errors.push('missing sig')
  if (event.kind === undefined) errors.push('missing kind')
  if (!event.created_at) errors.push('missing created_at')

  if (errors.length > 0) return { valid: false, errors }

  const valid = verifyEvent(event)
  if (!valid) errors.push('signature verification failed')

  return { valid, errors }
}

// --- NIP-44 Encrypt/Decrypt ---

/** Encrypt a plaintext string using NIP-44 */
export function handleEncrypt(
  privateKeyHex: string,
  recipientPubkeyHex: string,
  plaintext: string,
): string {
  const secretBytes = Buffer.from(privateKeyHex, 'hex')
  try {
    const conversationKey = getConversationKey(secretBytes, recipientPubkeyHex)
    return encrypt(plaintext, conversationKey)
  } finally {
    secretBytes.fill(0)
  }
}

/** Decrypt a NIP-44 ciphertext */
export function handleDecrypt(
  privateKeyHex: string,
  senderPubkeyHex: string,
  ciphertext: string,
): string {
  const secretBytes = Buffer.from(privateKeyHex, 'hex')
  try {
    const conversationKey = getConversationKey(secretBytes, senderPubkeyHex)
    return decrypt(ciphertext, conversationKey)
  } finally {
    secretBytes.fill(0)
  }
}

// --- Count ---

/** Query relay for event count matching a filter */
export async function handleCount(
  pool: RelayPool,
  npub: string,
  filter: Filter,
): Promise<{ count: number }> {
  // SimplePool doesn't expose COUNT directly, so we fetch and count
  const events = await pool.query(npub, filter)
  return { count: events.length }
}

// --- Fetch by nip19 ---

/** Fetch an event by its nip19 code (nevent, nprofile, naddr, note) */
export async function handleFetch(
  pool: RelayPool,
  npub: string,
  nip19Code: string,
): Promise<NostrEvent[]> {
  const cleaned = nip19Code.replace(/^nostr:/, '')
  const decoded = decode(cleaned)

  let filter: Filter

  switch (decoded.type) {
    case 'note':
      filter = { ids: [decoded.data as string] }
      break
    case 'nevent': {
      const d = decoded.data as { id: string; relays?: string[]; author?: string }
      filter = { ids: [d.id] }
      break
    }
    case 'nprofile': {
      const d = decoded.data as { pubkey: string; relays?: string[] }
      filter = { authors: [d.pubkey], kinds: [0], limit: 1 }
      break
    }
    case 'npub':
      filter = { authors: [decoded.data as string], kinds: [0], limit: 1 }
      break
    case 'naddr': {
      const d = decoded.data as { pubkey: string; kind: number; identifier: string }
      filter = { authors: [d.pubkey], kinds: [d.kind], '#d': [d.identifier], limit: 1 }
      break
    }
    default:
      throw new Error(`Cannot fetch type: ${decoded.type}`)
  }

  return pool.query(npub, filter)
}

// --- Key Public ---

/** Derive a public key from a secret key (nsec, hex, or raw bytes) */
export function handleKeyPublic(secret: string): { pubkeyHex: string; npub: string } {
  let bytes: Uint8Array
  if (secret.startsWith('nsec1')) {
    const decoded = decode(secret)
    bytes = decoded.data as Uint8Array
  } else {
    bytes = Buffer.from(secret, 'hex')
  }
  try {
    const pubkeyHex = getPublicKey(bytes)
    return { pubkeyHex, npub: npubEncode(pubkeyHex) }
  } finally {
    bytes.fill(0)
  }
}

// --- Encode nsec ---

/** Encode a hex private key as bech32 nsec */
export function handleEncodeNsec(hex: string): string {
  return nsecEncode(Buffer.from(hex, 'hex'))
}

// --- Filter match ---

/** Test if an event matches a Nostr filter */
export function handleFilter(event: NostrEvent, filter: Filter): { matches: boolean } {
  return { matches: matchFilter(filter, event) }
}

// --- NIP list/show ---

/** Fetch the list of official NIPs from GitHub */
export async function handleNipList(): Promise<Array<{ number: number; title: string }>> {
  const response = await fetch('https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md', {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Failed to fetch NIP list: ${response.status}`)
  const text = await response.text()
  if (text.length > 1_048_576) throw new Error('NIP list response too large')

  const nips: Array<{ number: number; title: string }> = []
  const re = /- \[NIP-(\d+)\]\([^)]+\)\s*[-—:]+\s*(.+)/g
  let match
  while ((match = re.exec(text)) !== null) {
    nips.push({ number: parseInt(match[1], 10), title: match[2].trim() })
  }
  return nips
}

/** Fetch a specific NIP's content from GitHub */
// --- Tombstone ---

export interface TombstoneResult {
  kind: number
  dTag: string
  published: boolean
  eventId?: string
  message: string
}

/**
 * Overwrite an addressable event (kind 30000-39999) with empty content.
 * This effectively deletes it from relays that support NIP-01 replaceable semantics.
 */
export async function handleTombstone(
  ctx: SigningContext,
  pool: RelayPool,
  args: { kind: number; dTag: string },
): Promise<TombstoneResult> {
  if (args.kind < 30000 || args.kind > 39999) {
    throw new Error(`Tombstone only works for addressable events (kind 30000-39999), got ${args.kind}`)
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: args.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', args.dTag]],
    content: '',
  })

  const result = await pool.publish(ctx.activeNpub, event)

  return {
    kind: args.kind,
    dTag: args.dTag,
    published: result.success,
    eventId: event.id,
    message: result.success
      ? `Tombstoned kind ${args.kind} d:${args.dTag} -- relays will replace the old event with empty content`
      : `Failed to publish tombstone: ${result.errors.join(', ')}`,
  }
}

// --- NIP Show ---

export async function handleNipShow(number: number): Promise<{ number: number; content: string }> {
  const padded = String(number).padStart(2, '0')
  const response = await fetch(`https://raw.githubusercontent.com/nostr-protocol/nips/master/${padded}.md`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`NIP-${padded} not found: ${response.status}`)
  const text = await response.text()
  if (text.length > 1_048_576) throw new Error('NIP content too large')
  return { number, content: text }
}
