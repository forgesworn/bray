import { decode } from 'nostr-tools/nip19'
import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { VeilScoring } from '../veil/scoring.js'
import type { TrustMode } from '../veil/filter.js'
import { filterByTrust } from '../veil/filter.js'
import type { TrustContext, TrustAnnotation } from '../trust-context.js'
import { toAnnotation } from '../trust-context.js'

export interface Notification {
  id: string
  type: 'reply' | 'reaction' | 'mention' | 'zap' | 'other'
  kind: number
  from: string
  content: string
  createdAt: number
  replyToEventId?: string
  amountMsats?: number
  zapSender?: string
  zapMessage?: string
  trustScore?: number
}

export interface FeedEntry {
  id: string
  pubkey: string
  content: string
  createdAt: number
  tags: string[][]
  trustScore?: number
  _trust?: TrustAnnotation
}

/** Fetch notifications (mentions, replies, reactions, zaps) for the active identity */
export async function handleNotifications(
  ctx: IdentityContext,
  pool: RelayPool,
  opts?: {
    since?: number
    limit?: number
    trust?: TrustMode
    _scoring?: VeilScoring
  },
): Promise<Notification[]> {
  const activeHex = decode(ctx.activeNpub).data as string
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1, 7, 9735],
    '#p': [activeHex],
    limit: opts?.limit ?? 50,
    ...(opts?.since ? { since: opts.since } : {}),
  })

  const filtered = events.filter(e => e.kind !== 3) // exclude follows

  if (opts?._scoring && opts.trust !== 'off') {
    const scored = await opts._scoring.scoreEvents(filtered)
    const trustFiltered = filterByTrust(scored, { mode: opts.trust ?? 'strict' })
    return trustFiltered
      .map(event => ({ ...classifyNotification(event, ctx.activeNpub), trustScore: event._trustScore }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  return filtered
    .map(event => classifyNotification(event, ctx.activeNpub))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Classify a single event into a notification type */
function classifyNotification(event: NostrEvent, activeNpub: string): Notification {
  const base = {
    id: event.id,
    kind: event.kind,
    from: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
  }

  if (event.kind === 7) {
    return { ...base, type: 'reaction' }
  }

  if (event.kind === 9735) {
    return parseZapReceipt(event, base)
  }

  if (event.kind === 1) {
    // Check if it's a reply (has e-tag with 'reply' marker) or just a mention
    const eTag = event.tags.find(t => t[0] === 'e')
    if (eTag) {
      return { ...base, type: 'reply', replyToEventId: eTag[1] }
    }
    return { ...base, type: 'mention' }
  }

  return { ...base, type: 'other' }
}

/** Parse zap receipt (kind 9735) for amount and sender */
function parseZapReceipt(event: NostrEvent, base: Omit<Notification, 'type'>): Notification {
  let amountMsats: number | undefined
  let zapSender: string | undefined
  let zapMessage: string | undefined

  const descTag = event.tags.find(t => t[0] === 'description')
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1])
      zapSender = zapRequest.pubkey
      zapMessage = zapRequest.content
      const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === 'amount')
      if (amountTag?.[1]) {
        amountMsats = parseInt(amountTag[1], 10)
      }
    } catch { /* ignore malformed zap request */ }
  }

  return { ...base, type: 'zap', amountMsats, zapSender, zapMessage }
}

/** Fetch feed (kind 1 events) */
export async function handleFeed(
  ctx: IdentityContext,
  pool: RelayPool,
  opts: {
    authors?: string[]
    since?: number
    limit?: number
    trust?: TrustMode
    _scoring?: VeilScoring
    _trustCtx?: TrustContext
  },
): Promise<FeedEntry[]> {
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1],
    ...(opts.authors ? { authors: opts.authors } : {}),
    ...(opts.since ? { since: opts.since } : {}),
    limit: opts.limit ?? 20,
  })

  let results: FeedEntry[]

  if (opts._scoring && opts.trust !== 'off') {
    const scored = await opts._scoring.scoreEvents(events)
    const filtered = filterByTrust(scored, { mode: opts.trust ?? 'strict' })
    results = filtered.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.created_at,
      tags: e.tags,
      trustScore: e._trustScore,
    }))
  } else {
    results = events.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.created_at,
      tags: e.tags,
    }))
  }

  if (opts._trustCtx && opts._trustCtx.mode !== 'off') {
    for (const item of results) {
      const assessment = await opts._trustCtx.assess(item.pubkey)
      item._trust = toAnnotation(assessment)
    }
  }

  return results
}
