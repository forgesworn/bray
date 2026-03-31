import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface CalendarEvent {
  id: string
  pubkey: string
  kind: number
  slug: string
  title: string
  content: string
  start: string
  end?: string
  location?: string
  geohash?: string
  image?: string
  participants: string[]
  hashtags: string[]
  createdAt: number
}

export interface CalendarEventResult {
  event: NostrEvent
  publish: PublishResult
}

export interface CalendarRsvpResult {
  event: NostrEvent
  publish: PublishResult
}

/** Detect whether a start value is date-only (YYYY-MM-DD) or time-based */
function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Slugify a title into a URL-safe d-tag identifier */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Parse a calendar event (kind 31922 or 31923) into structured fields */
function parseCalendarEvent(event: NostrEvent): CalendarEvent {
  const dTag = event.tags.find(t => t[0] === 'd')
  const titleTag = event.tags.find(t => t[0] === 'title')
  const startTag = event.tags.find(t => t[0] === 'start')
  const endTag = event.tags.find(t => t[0] === 'end')
  const locationTag = event.tags.find(t => t[0] === 'location')
  const gTag = event.tags.find(t => t[0] === 'g')
  const imageTag = event.tags.find(t => t[0] === 'image')
  const pTags = event.tags.filter(t => t[0] === 'p')
  const tTags = event.tags.filter(t => t[0] === 't')

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    slug: dTag?.[1] ?? '',
    title: titleTag?.[1] ?? '',
    content: event.content,
    start: startTag?.[1] ?? '',
    end: endTag?.[1] ?? undefined,
    location: locationTag?.[1] ?? undefined,
    geohash: gTag?.[1] ?? undefined,
    image: imageTag?.[1] ?? undefined,
    participants: pTags.map(t => t[1]),
    hashtags: tTags.map(t => t[1]),
    createdAt: event.created_at,
  }
}

/** Get a sort key from a start value (Unix timestamp for time-based, date string for date-based) */
function startSortKey(event: CalendarEvent): number {
  // Time-based events store Unix timestamps
  const asNum = Number(event.start)
  if (!isNaN(asNum) && asNum > 0) return asNum
  // Date-based events store YYYY-MM-DD
  const d = new Date(event.start)
  if (!isNaN(d.getTime())) return d.getTime() / 1000
  return 0
}

/** Create and publish a calendar event (kind 31922 date-based or 31923 time-based) */
export async function handleCalendarCreate(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    title: string
    content: string
    start: string
    end?: string
    location?: string
    geohash?: string
    participants?: string[]
    hashtags?: string[]
    image?: string
    slug?: string
  },
): Promise<CalendarEventResult> {
  const slug = args.slug ?? slugify(args.title)
  const now = Math.floor(Date.now() / 1000)

  // Auto-detect date vs time format
  const dateOnly = isDateOnly(args.start)
  const kind = dateOnly ? 31922 : 31923

  // Convert start/end values
  let startValue: string
  let endValue: string | undefined

  if (dateOnly) {
    // Date-based: keep YYYY-MM-DD format
    startValue = args.start
    endValue = args.end
  } else {
    // Time-based: convert ISO strings to Unix timestamps
    startValue = String(Math.floor(new Date(args.start).getTime() / 1000))
    endValue = args.end
      ? String(Math.floor(new Date(args.end).getTime() / 1000))
      : undefined
  }

  const tags: string[][] = [
    ['d', slug],
    ['title', args.title],
    ['start', startValue],
  ]
  if (endValue) tags.push(['end', endValue])
  if (args.location) tags.push(['location', args.location])
  if (args.geohash) tags.push(['g', args.geohash])
  if (args.participants) {
    for (const pubkey of args.participants) {
      tags.push(['p', pubkey, '', ''])
    }
  }
  if (args.hashtags) {
    for (const hashtag of args.hashtags) {
      tags.push(['t', hashtag])
    }
  }
  if (args.image) tags.push(['image', args.image])

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind,
    created_at: now,
    tags,
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch calendar events by author and/or time range */
export async function handleCalendarRead(
  pool: RelayPool,
  npub: string,
  args: {
    author?: string
    since?: string
    until?: string
    limit?: number
  },
): Promise<CalendarEvent[]> {
  const limit = args.limit ?? 50
  const filter: Record<string, unknown> = {
    kinds: [31922, 31923],
    limit,
  }
  if (args.author) filter.authors = [args.author]

  const events = await pool.query(npub, filter as any)

  let parsed = events.map(parseCalendarEvent)

  // Filter by time range if specified
  if (args.since) {
    const sinceKey = isDateOnly(args.since)
      ? new Date(args.since).getTime() / 1000
      : new Date(args.since).getTime() / 1000
    parsed = parsed.filter(e => startSortKey(e) >= sinceKey)
  }
  if (args.until) {
    const untilKey = isDateOnly(args.until)
      ? new Date(args.until).getTime() / 1000
      : new Date(args.until).getTime() / 1000
    parsed = parsed.filter(e => startSortKey(e) <= untilKey)
  }

  // Sort by start date ascending
  parsed.sort((a, b) => startSortKey(a) - startSortKey(b))

  return parsed
}

/** Create and publish an RSVP (kind 31925) to a calendar event */
export async function handleCalendarRsvp(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    eventCoordinate: string
    status: 'accepted' | 'declined' | 'tentative'
  },
): Promise<CalendarRsvpResult> {
  const now = Math.floor(Date.now() / 1000)

  const tags: string[][] = [
    ['a', args.eventCoordinate],
    ['d', args.eventCoordinate],
    ['status', args.status],
    ['L', 'status'],
    ['l', args.status, 'status'],
  ]

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 31925,
    created_at: now,
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}
