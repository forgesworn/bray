import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { RelaySet, PublishResult } from '../types.js'

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

/** Get relay list for the active identity, optionally checking for shared relays with another identity */
export async function handleRelayList(
  ctx: IdentityContext,
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

/** Publish a kind 10002 relay list */
export async function handleRelaySet(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { relays: RelayEntry[]; confirm?: boolean },
): Promise<{ event: NostrEvent; published: boolean; publish?: PublishResult; warning?: string }> {
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

/** Add a single relay to the active identity's relay set */
export function handleRelayAdd(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { url: string; mode?: 'read' | 'write' },
): { reconfigured: boolean } {
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
  kinds?: number[]
  authors?: string[]
  tags?: Record<string, string[]>
  since?: number
  until?: number
  limit?: number
  relays?: string[]
  search?: string
}

/** Query events from relays by arbitrary filter. Uses explicit relays if provided, otherwise the active identity's read relays. */
export async function handleRelayQuery(
  pool: RelayPool,
  npub: string,
  args: RelayQueryArgs,
): Promise<NostrEvent[]> {
  const filter: Filter = {}
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

/** Validate a relay URL — must be wss:// or ws://, no private networks */
export function validateRelayUrl(url: string): void {
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error('Relay URL must use wss:// or ws:// scheme')
  }
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' || host === '[::1]' ||
    host.startsWith('127.') || host.startsWith('10.') ||
    host.startsWith('192.168.') || host === '169.254.169.254' ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Relay URL must not point to private network addresses')
  }
}

/** Fetch NIP-11 relay information document */
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
