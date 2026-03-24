import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

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
}

export interface FeedEntry {
  id: string
  pubkey: string
  content: string
  createdAt: number
  tags: string[][]
}

/** Fetch notifications (mentions, replies, reactions, zaps) for the active identity */
export async function handleNotifications(
  ctx: IdentityContext,
  pool: RelayPool,
  opts?: { since?: number; limit?: number },
): Promise<Notification[]> {
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1, 7, 9735],
    '#p': [ctx.activeNpub],
    limit: opts?.limit ?? 50,
    ...(opts?.since ? { since: opts.since } : {}),
  })

  return events
    .filter(e => e.kind !== 3) // exclude follows
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
  opts: { authors?: string[]; since?: number; limit?: number },
): Promise<FeedEntry[]> {
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1],
    ...(opts.authors ? { authors: opts.authors } : {}),
    ...(opts.since ? { since: opts.since } : {}),
    limit: opts.limit ?? 20,
  })

  return events.map(e => ({
    id: e.id,
    pubkey: e.pubkey,
    content: e.content,
    createdAt: e.created_at,
    tags: e.tags,
  }))
}
