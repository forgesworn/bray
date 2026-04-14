import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { RelaySet, PublishResult } from '../types.js'
import { validatePublicUrl } from '../validation.js'

export interface RelayHealthEntry {
  url: string
  reachable: boolean
  responseTime: number
}

export interface RelayListResult {
  read: string[]
  write: string[]
  sharedWarning?: string
  health?: RelayHealthEntry[]
}

export interface RelayEntry {
  url: string
  mode?: 'read' | 'write' // undefined means both
}

/**
 * Get relay list for the active identity, optionally checking for shared relays with another identity.
 *
 * @param compareWithNpub - Optional npub to compare against; if provided, any relays shared with
 *   this identity are reported in `sharedWarning` as a privacy notice.
 * @returns An object containing separate `read` and `write` relay URL arrays, an optional
 *   `sharedWarning` string, and a `health` array with reachability and response-time data for
 *   every unique relay.
 * @example
 * const result = await handleRelayList(ctx, pool, 'npub1abc...')
 * console.log(result.read)          // ['wss://relay.damus.io']
 * console.log(result.sharedWarning) // 'Shared relays with npub1abc...: ...'
 * result.health.forEach(h => console.log(h.url, h.reachable, h.responseTime))
 */
export async function handleRelayList(
  ctx: SigningContext,
  pool: RelayPool,
  compareWithNpub?: string,
): Promise<RelayListResult> {
  const relays = pool.getRelays(ctx.activeNpub)
  const result: RelayListResult = {
    read: relays.read,
    write: relays.write,
  }

  if (compareWithNpub) {
    const shared = pool.checkSharedRelays(ctx.activeNpub, compareWithNpub)
    if (shared.length > 0) {
      result.sharedWarning = `Shared relays with ${compareWithNpub}: ${shared.join(', ')}. This may link identities.`
    }
  }

  const health = await Promise.all(
    [...new Set([...relays.read, ...relays.write])].map(async (url) => {
      try {
        const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
        const start = Date.now()
        const resp = await fetch(httpUrl, {
          headers: { Accept: 'application/nostr+json' },
          signal: AbortSignal.timeout(3000),
        })
        return { url, reachable: resp.ok, responseTime: Date.now() - start }
      } catch {
        return { url, reachable: false, responseTime: -1 }
      }
    }),
  )
  result.health = health

  return result
}

/**
 * Publish a kind 10002 relay list.
 *
 * @param args - Configuration for the relay list.
 * @param args.relays - Array of relay entries, each with a URL and an optional `mode`
 *   (`'read'` | `'write'`; omit for both).
 * @param args.confirm - Set to `true` to overwrite an existing relay list. When `false` (default)
 *   and a list already exists, the event is built but not published and `warning` is populated.
 * @returns An object containing the signed `event`, a `published` boolean, the raw `publish`
 *   result from the pool (when published), and an optional `warning` string when a pre-existing
 *   list was found and `confirm` was not set.
 * @example
 * const { event, published, warning } = await handleRelaySet(ctx, pool, {
 *   relays: [
 *     { url: 'wss://relay.damus.io' },
 *     { url: 'wss://nos.lol', mode: 'read' },
 *   ],
 *   confirm: true,
 * })
 * console.log(published, event.id)
 */
export async function handleRelaySet(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relays: RelayEntry[]; confirm?: boolean },
): Promise<{ event: NostrEvent; published: boolean; publish?: PublishResult; warning?: string }> {
  // Reject malformed or private-network URLs before publishing or reconfiguring
  for (const r of args.relays) validateRelayUrl(r.url)

  // Check for existing relay list
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [10002],
    authors: [ctx.activePublicKeyHex],
  })

  // Build r-tags
  const tags: string[][] = args.relays.map(r => {
    if (r.mode) return ['r', r.url, r.mode]
    return ['r', r.url]
  })

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })

  if (existing.length > 0 && !args.confirm) {
    return {
      event,
      published: false,
      warning: 'Relay list already exists. Set confirm: true to overwrite.',
    }
  }

  const publish = await pool.publish(ctx.activeNpub, event)

  // Reconfigure the pool with the new relay set
  const read = args.relays.filter(r => !r.mode || r.mode === 'read').map(r => r.url)
  const write = args.relays.filter(r => !r.mode || r.mode === 'write').map(r => r.url)
  pool.reconfigure(ctx.activeNpub, { read, write })

  return { event, published: true, publish }
}

/**
 * Add a single relay to the active identity's relay set.
 *
 * @param args - Details of the relay to add.
 * @param args.url - WebSocket URL of the relay (must use `wss://` or `ws://`).
 * @param args.mode - Optional mode: `'read'` adds only to the read list, `'write'` adds only to
 *   the write list. Omit to add to both.
 * @returns `{ reconfigured: true }` once the pool has been updated in-memory.
 * @example
 * const result = handleRelayAdd(ctx, pool, { url: 'wss://relay.snort.social', mode: 'read' })
 * console.log(result.reconfigured) // true
 */
export function handleRelayAdd(
  ctx: SigningContext,
  pool: RelayPool,
  args: { url: string; mode?: 'read' | 'write' },
): { reconfigured: boolean } {
  validateRelayUrl(args.url)
  const current = pool.getRelays(ctx.activeNpub)
  const read = [...current.read]
  const write = [...current.write]

  if (!args.mode || args.mode === 'read') {
    if (!read.includes(args.url)) read.push(args.url)
  }
  if (!args.mode || args.mode === 'write') {
    if (!write.includes(args.url)) write.push(args.url)
  }

  pool.reconfigure(ctx.activeNpub, { read, write })
  return { reconfigured: true }
}

export interface RelayQueryArgs {
  ids?: string[]
  kinds?: number[]
  authors?: string[]
  tags?: Record<string, string[]>
  since?: number
  until?: number
  limit?: number
  relays?: string[]
  search?: string
}

/**
 * Query events from relays by arbitrary filter. Uses explicit relays if provided, otherwise the active identity's read relays.
 *
 * @param npub - The npub whose configured read relays are used when `args.relays` is not supplied.
 * @param args - Filter parameters for the query.
 * @param args.ids - Restrict to specific event IDs.
 * @param args.kinds - Restrict to specific event kinds.
 * @param args.authors - Restrict to specific author public keys (hex).
 * @param args.tags - Tag filters keyed by tag name (with or without leading `#`),
 *   e.g. `{ p: ['<hex>'] }` or `{ '#d': ['<identifier>'] }`.
 * @param args.since - Unix timestamp lower bound (inclusive).
 * @param args.until - Unix timestamp upper bound (inclusive).
 * @param args.limit - Maximum number of events to return (default `50`).
 * @param args.relays - Explicit relay URLs to query instead of the identity's read relays.
 *   Each URL is validated before use.
 * @param args.search - NIP-50 full-text search string (only effective on supporting relays).
 * @returns Array of matching Nostr events, ordered as returned by the relay(s).
 * @example
 * const events = await handleRelayQuery(pool, 'npub1abc...', {
 *   kinds: [1],
 *   authors: ['deadbeef...'],
 *   limit: 20,
 * })
 * events.forEach(e => console.log(e.id, e.content))
 */
export async function handleRelayQuery(
  pool: RelayPool,
  npub: string,
  args: RelayQueryArgs,
): Promise<NostrEvent[]> {
  const filter: Filter = {}
  if (args.ids?.length) filter.ids = args.ids
  if (args.kinds?.length) filter.kinds = args.kinds
  if (args.authors?.length) filter.authors = args.authors
  if (args.since) filter.since = args.since
  if (args.until) filter.until = args.until
  filter.limit = args.limit ?? 50

  // Map tag filters (e.g. { "#p": ["abc"], "#d": ["xyz"] })
  if (args.tags) {
    for (const [key, values] of Object.entries(args.tags)) {
      const tagKey = key.startsWith('#') ? key : `#${key}`
      ;(filter as Record<string, unknown>)[tagKey] = values
    }
  }

  // NIP-50 full-text search (only works on relays that support it)
  if (args.search) {
    ;(filter as Record<string, unknown>).search = args.search
  }

  if (args.relays?.length) {
    for (const url of args.relays) validateRelayUrl(url)
    return pool.queryDirect(args.relays, filter)
  }

  return pool.query(npub, filter)
}

/**
 * Validate a relay URL — must be wss:// or ws://, no private networks.
 *
 * @param url - The relay WebSocket URL to validate.
 * @returns `void` if the URL is acceptable.
 * @throws {Error} If the scheme is not `wss://` or `ws://`, or if the host resolves to a private
 *   or loopback address (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, 169.254.169.254, ::1).
 * @example
 * validateRelayUrl('wss://relay.damus.io')       // passes silently
 * validateRelayUrl('wss://localhost')            // throws — private address
 * validateRelayUrl('http://relay.damus.io')      // throws — wrong scheme
 */
export function validateRelayUrl(url: string): void {
  if (typeof url !== 'string') {
    throw new Error('Relay URL must be a string')
  }
  if (url.length > 512) {
    throw new Error('Relay URL too long (max 512 characters)')
  }
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error('Relay URL must use wss:// or ws:// scheme')
  }
  validatePublicUrl(url)
}

/**
 * Fetch NIP-11 relay information document.
 *
 * @param url - WebSocket URL of the relay (`wss://` or `ws://`). The URL is validated before
 *   the HTTP request is made.
 * @returns Parsed JSON object from the relay's NIP-11 information document. Shape varies per relay
 *   but typically includes `name`, `description`, `pubkey`, `supported_nips`, and `software`.
 * @throws {Error} If the URL is invalid, the HTTP response is not OK, the document exceeds 1 MiB,
 *   or the response body is not valid JSON.
 * @example
 * const info = await handleRelayInfo('wss://relay.damus.io')
 * console.log(info.name, info.supported_nips)
 */
export async function handleRelayInfo(
  url: string,
): Promise<Record<string, unknown>> {
  validateRelayUrl(url)

  const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  const response = await fetch(httpUrl, {
    headers: { Accept: 'application/nostr+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`NIP-11 fetch failed: ${response.status} ${response.statusText}`)
  }
  const text = await response.text()
  if (text.length > 1_048_576) {
    throw new Error('Relay info document too large')
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Relay info document is not valid JSON')
  }
}

export interface SubscribeResult {
  /** Resolved once the subscription is closed (SIGINT or manual close). */
  closed: boolean
}

/**
 * Subscribe to live Nostr events matching a filter and emit each event to a callback.
 *
 * The subscription runs until the returned `unsubscribe` function is called.
 * Relays are resolved from the active identity's relay set; pass `relayOverrides`
 * to target a specific list of relays instead.
 *
 * @param pool - Relay pool instance.
 * @param npub - Active identity npub (used for relay resolution when no overrides provided).
 * @param filter - Nostr filter object.
 * @param onEvent - Callback invoked for each matching event.
 * @param relayOverrides - Optional explicit relay URLs.
 * @returns Async cleanup function.
 * @example
 * const stop = await handleSubscribe(pool, npub, { kinds: [1] }, ev => console.log(ev))
 * // later:
 * stop()
 */
export async function handleSubscribe(
  pool: RelayPool,
  npub: string | undefined,
  filter: Filter,
  onEvent: (event: NostrEvent) => void,
  relayOverrides?: string[],
): Promise<() => void> {
  const relays = relayOverrides?.length
    ? relayOverrides
    : (npub ? pool.getRelays(npub).read : [])

  if (relays.length === 0) {
    throw new Error('No relays available. Set NOSTR_RELAYS or pass --relay <url>.')
  }

  return pool.subscribe(relays, filter, onEvent)
}
