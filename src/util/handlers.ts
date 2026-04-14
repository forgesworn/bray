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

/**
 * Decode any nip19 entity (npub, nsec, note, nevent, nprofile, naddr) to its components.
 *
 * @param input - A bech32 nip19 string, optionally prefixed with `nostr:`.
 * @returns An object with `type` (the entity kind) and `data` (decoded payload).
 *   For `nsec` inputs the private key is never returned; only the derived pubkey is included.
 * @example
 * handleDecode('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3s0yrs')
 * // { type: 'npub', data: '000...0' }
 */
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

/**
 * Encode a hex pubkey as npub.
 *
 * @param hex - 32-byte public key as a lowercase hex string.
 * @returns bech32-encoded `npub1…` string.
 * @example
 * handleEncodeNpub('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d')
 * // 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'
 */
export function handleEncodeNpub(hex: string): string {
  return npubEncode(hex)
}

/**
 * Encode a hex event ID as note.
 *
 * @param hex - 32-byte event ID as a lowercase hex string.
 * @returns bech32-encoded `note1…` string.
 * @example
 * handleEncodeNote('b3e392...')
 * // 'note1kdkqm...'
 */
export function handleEncodeNote(hex: string): string {
  return noteEncode(hex)
}

/**
 * Encode a hex pubkey + relay hints as nprofile.
 *
 * @param pubkey - 32-byte public key as a lowercase hex string.
 * @param relays - Optional list of relay WebSocket URLs to embed as hints.
 * @returns bech32-encoded `nprofile1…` string.
 * @example
 * handleEncodeNprofile('3bf0c6...', ['wss://relay.damus.io'])
 * // 'nprofile1qqsrhuxx8...'
 */
export function handleEncodeNprofile(pubkey: string, relays?: string[]): string {
  return nprofileEncode({ pubkey, relays })
}

/**
 * Encode event pointer as nevent.
 *
 * @param id - 32-byte event ID as a lowercase hex string.
 * @param relays - Optional relay WebSocket URLs to embed as fetch hints.
 * @param author - Optional hex pubkey of the event author.
 * @returns bech32-encoded `nevent1…` string.
 * @example
 * handleEncodeNevent('b3e392...', ['wss://nos.lol'], '3bf0c6...')
 * // 'nevent1qqsr9...'
 */
export function handleEncodeNevent(id: string, relays?: string[], author?: string): string {
  return neventEncode({ id, relays, author })
}

/**
 * Encode addressable event as naddr.
 *
 * @param pubkey - 32-byte public key of the event author as a lowercase hex string.
 * @param kind - Event kind number (must be in the addressable range 30000–39999).
 * @param identifier - The `d` tag value that uniquely identifies the event.
 * @param relays - Optional relay WebSocket URLs to embed as fetch hints.
 * @returns bech32-encoded `naddr1…` string.
 * @example
 * handleEncodeNaddr('3bf0c6...', 30023, 'my-article', ['wss://relay.nostr.band'])
 * // 'naddr1qqxnzdesxqmrs...'
 */
export function handleEncodeNaddr(pubkey: string, kind: number, identifier: string, relays?: string[]): string {
  return naddrEncode({ pubkey, kind, identifier, relays })
}

// --- Verify ---

/**
 * Verify an event's id hash and signature.
 *
 * @param event - A complete Nostr event object including `id`, `pubkey`, `sig`, `kind`, and `created_at`.
 * @returns `{ valid, errors }` — `valid` is `true` only when all required fields are present and
 *   the Schnorr signature checks out. `errors` lists every problem found.
 * @example
 * handleVerify({ id: 'abc...', pubkey: '3bf...', sig: 'def...', kind: 1, created_at: 1700000000, tags: [], content: 'hello' })
 * // { valid: true, errors: [] }
 */
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

/**
 * Encrypt a plaintext string using NIP-44.
 *
 * @param privateKeyHex - Sender's 32-byte private key as a lowercase hex string.
 * @param recipientPubkeyHex - Recipient's 32-byte public key as a lowercase hex string.
 * @param plaintext - The message to encrypt.
 * @returns NIP-44 versioned ciphertext string (base64 payload with version prefix).
 * @example
 * handleEncrypt('a1b2c3...', 'd4e5f6...', 'Hello!')
 * // 'AgA...'
 */
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

/**
 * Decrypt a NIP-44 ciphertext.
 *
 * @param privateKeyHex - Recipient's 32-byte private key as a lowercase hex string.
 * @param senderPubkeyHex - Sender's 32-byte public key as a lowercase hex string.
 * @param ciphertext - NIP-44 versioned ciphertext string as produced by `handleEncrypt`.
 * @returns The decrypted plaintext string.
 * @example
 * handleDecrypt('a1b2c3...', 'd4e5f6...', 'AgA...')
 * // 'Hello!'
 */
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

/**
 * Query relay for event count matching a filter.
 *
 * @param filter - A Nostr filter object (kinds, authors, since, until, etc.).
 * @returns `{ count }` — number of matching events found on the relay set.
 * @example
 * await handleCount(pool, 'npub1...', { authors: ['3bf0c6...'], kinds: [1] })
 * // { count: 42 }
 */
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

/**
 * Fetch an event by its nip19 code (nevent, nprofile, naddr, note).
 *
 * @param nip19Code - A bech32 nip19 string: `note1…`, `nevent1…`, `nprofile1…`, `npub1…`, or `naddr1…`.
 *   A `nostr:` URI prefix is accepted and stripped automatically.
 * @returns Array of matching Nostr events (may be empty if nothing was found).
 * @example
 * await handleFetch(pool, 'npub1...', 'note1kdkqm...')
 * // [{ id: 'b3e392...', kind: 1, content: 'hello', ... }]
 */
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

/**
 * Derive a public key from a secret key (nsec, hex, or raw bytes).
 *
 * @param secret - The private key as a `nsec1…` bech32 string or a 64-character lowercase hex string.
 * @returns `{ pubkeyHex, npub }` — the derived public key in both hex and bech32 form.
 * @example
 * handleKeyPublic('nsec1...')
 * // { pubkeyHex: '3bf0c6...', npub: 'npub180cvv...' }
 */
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

/**
 * Encode a hex private key as bech32 nsec.
 *
 * @param hex - 32-byte private key as a lowercase hex string.
 * @returns bech32-encoded `nsec1…` string.
 * @example
 * handleEncodeNsec('a1b2c3...')
 * // 'nsec1...'
 */
export function handleEncodeNsec(hex: string): string {
  return nsecEncode(Buffer.from(hex, 'hex'))
}

// --- Filter match ---

/**
 * Test if an event matches a Nostr filter.
 *
 * @param event - A complete Nostr event object.
 * @param filter - A Nostr filter object to test against.
 * @returns `{ matches: true }` if the event satisfies all filter conditions, `{ matches: false }` otherwise.
 * @example
 * handleFilter({ kind: 1, pubkey: '3bf0c6...', ...rest }, { kinds: [1], authors: ['3bf0c6...'] })
 * // { matches: true }
 */
export function handleFilter(event: NostrEvent, filter: Filter): { matches: boolean } {
  return { matches: matchFilter(filter, event) }
}

// --- NIP list/show ---

/**
 * Fetch the list of official NIPs from GitHub.
 *
 * @returns Array of `{ number, title }` objects parsed from the NIP repository README.
 * @example
 * await handleNipList()
 * // [{ number: 1, title: 'Basic protocol flow description' }, ...]
 */
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
 *
 * @param args - `{ kind, dTag }` — the kind number and `d` tag value identifying the event to tombstone.
 * @returns A `TombstoneResult` describing whether the empty replacement event was published.
 * @example
 * await handleTombstone(ctx, pool, { kind: 30023, dTag: 'my-article' })
 * // { kind: 30023, dTag: 'my-article', published: true, eventId: 'abc...', message: 'Tombstoned...' }
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

/**
 * Fetch a specific NIP's content from GitHub.
 *
 * @param number - The NIP number (e.g. `44` for NIP-44).
 * @returns `{ number, content }` — the raw Markdown text of the NIP document.
 * @example
 * await handleNipShow(44)
 * // { number: 44, content: '# NIP-44\n\nVersioned Encryption...' }
 */
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
