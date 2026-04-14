import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

/** Kind 30402 — parameterised replaceable event for classified listings (NIP-99) */
export const CLASSIFIED_LISTING_KIND = 30402

// --- Parsed types ---

/** @experimental */
export interface ListingPrice {
  amount: string
  currency: string
  frequency: string
}

/** @experimental */
export interface ParsedListing {
  id: string
  pubkey: string
  slug: string
  title: string
  summary: string
  content: string
  price: ListingPrice | null
  location: string
  geohash: string
  image: string
  hashtags: string[]
  publishedAt: number
  createdAt: number
  status: string
}

/** @experimental */
export interface ListingPublishResult {
  event: NostrEvent
  publish: PublishResult
}

/** Slugify a title into a URL-safe d-tag identifier */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Parse a kind 30402 event into a structured listing */
function parseListing(event: NostrEvent): ParsedListing {
  const getTag = (key: string): string | undefined =>
    event.tags.find(t => t[0] === key)?.[1]

  const priceTag = event.tags.find(t => t[0] === 'price')
  const tTags = event.tags.filter(t => t[0] === 't')
  const statusTag = event.tags.find(t => t[0] === 'status')
  const publishedAtTag = event.tags.find(t => t[0] === 'published_at')

  return {
    id: event.id,
    pubkey: event.pubkey,
    slug: getTag('d') ?? '',
    title: getTag('title') ?? '',
    summary: getTag('summary') ?? '',
    content: event.content,
    price: priceTag
      ? { amount: priceTag[1] ?? '', currency: priceTag[2] ?? '', frequency: priceTag[3] ?? '' }
      : null,
    location: getTag('location') ?? '',
    geohash: getTag('g') ?? '',
    image: getTag('image') ?? '',
    hashtags: tTags.map(t => t[1]),
    publishedAt: publishedAtTag?.[1] ? parseInt(publishedAtTag[1], 10) : event.created_at,
    createdAt: event.created_at,
    status: statusTag?.[1] ?? '',
  }
}

/** Create and publish a kind 30402 classified listing */
export async function handleListingCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    title: string
    content: string
    price: { amount: string; currency: string; frequency?: string }
    summary?: string
    location?: string
    geohash?: string
    hashtags?: string[]
    image?: string
    slug?: string
  },
): Promise<ListingPublishResult> {
  const slug = args.slug ?? slugify(args.title)
  const now = Math.floor(Date.now() / 1000)

  const tags: string[][] = [
    ['d', slug],
    ['title', args.title],
    ['published_at', String(now)],
    ['price', args.price.amount, args.price.currency, args.price.frequency ?? ''],
  ]
  if (args.summary) tags.push(['summary', args.summary])
  if (args.location) tags.push(['location', args.location])
  if (args.geohash) tags.push(['g', args.geohash])
  if (args.image) tags.push(['image', args.image])
  if (args.hashtags) {
    for (const hashtag of args.hashtags) {
      tags.push(['t', hashtag])
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: CLASSIFIED_LISTING_KIND,
    created_at: now,
    tags,
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch kind 30402 listings by author and optional slug */
export async function handleListingRead(
  pool: RelayPool,
  npub: string,
  args: { author?: string; slug?: string; limit?: number },
): Promise<ParsedListing[]> {
  const filter: Record<string, unknown> = {
    kinds: [CLASSIFIED_LISTING_KIND],
    limit: args.limit ?? 50,
  }
  if (args.author) filter.authors = [args.author]
  if (args.slug) filter['#d'] = [args.slug]

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map(parseListing)
}

/** Search kind 30402 listings by hashtag or geohash */
export async function handleListingSearch(
  pool: RelayPool,
  npub: string,
  args: { hashtag?: string; geohash?: string; limit?: number },
): Promise<ParsedListing[]> {
  if (!args.hashtag && !args.geohash) {
    throw new Error('Provide at least one of hashtag or geohash to search')
  }

  const filter: Record<string, unknown> = {
    kinds: [CLASSIFIED_LISTING_KIND],
    limit: args.limit ?? 50,
  }
  if (args.hashtag) filter['#t'] = [args.hashtag]
  if (args.geohash) filter['#g'] = [args.geohash]

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map(parseListing)
}

/** Close a listing by adding a status tag (sold or closed) */
export async function handleListingClose(
  ctx: SigningContext,
  pool: RelayPool,
  args: { slug: string; status: 'sold' | 'closed' },
): Promise<ListingPublishResult> {
  // Fetch existing listing
  const filter: Record<string, unknown> = {
    kinds: [CLASSIFIED_LISTING_KIND],
    authors: [ctx.activePublicKeyHex],
    '#d': [args.slug],
  }
  const events = await pool.query(ctx.activeNpub, filter as any)

  if (events.length === 0) {
    throw new Error(`No listing found with slug "${args.slug}"`)
  }

  // Take the most recent version
  const existing = [...events].sort((a, b) => b.created_at - a.created_at)[0]

  // Preserve all existing tags, remove any old status tag, add the new one
  const tags = existing.tags.filter((t: string[]) => t[0] !== 'status')
  tags.push(['status', args.status])

  const now = Math.floor(Date.now() / 1000)
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: CLASSIFIED_LISTING_KIND,
    created_at: now,
    tags,
    content: existing.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}
