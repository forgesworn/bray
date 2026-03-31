import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export const WIKI_KIND = 30818

export interface WikiArticle {
  topic: string
  title: string
  content: string
  summary: string
  pubkey: string
  created_at: number
  hashtags: string[]
}

export interface WikiTopic {
  topic: string
  title: string
  summary: string
  pubkey: string
  created_at: number
}

export interface WikiPublishResult {
  event: NostrEvent
  publish: PublishResult
}

/** Parse a kind 30818 event into a structured WikiArticle */
function parseWikiArticle(event: NostrEvent): WikiArticle {
  const dTag = event.tags.find(t => t[0] === 'd')
  const titleTag = event.tags.find(t => t[0] === 'title')
  const summaryTag = event.tags.find(t => t[0] === 'summary')
  const tTags = event.tags.filter(t => t[0] === 't')

  return {
    topic: dTag?.[1] ?? '',
    title: titleTag?.[1] ?? '',
    content: event.content,
    summary: summaryTag?.[1] ?? '',
    pubkey: event.pubkey,
    created_at: event.created_at,
    hashtags: tTags.map(t => t[1]),
  }
}

/** Create and publish a kind 30818 wiki article (NIP-54) */
export async function handleWikiPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    topic: string
    title: string
    content: string
    summary?: string
    hashtags?: string[]
  },
): Promise<WikiPublishResult> {
  const now = Math.floor(Date.now() / 1000)

  const tags: string[][] = [
    ['d', args.topic],
    ['title', args.title],
  ]
  if (args.summary) tags.push(['summary', args.summary])
  tags.push(['published_at', String(now)])
  if (args.hashtags) {
    for (const hashtag of args.hashtags) {
      tags.push(['t', hashtag])
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: WIKI_KIND,
    created_at: now,
    tags,
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch wiki articles for a topic, optionally by specific author */
export async function handleWikiRead(
  pool: RelayPool,
  npub: string,
  args: { topic: string; author?: string; limit?: number },
): Promise<WikiArticle[]> {
  const limit = args.limit ?? 10
  const filter: Record<string, unknown> = {
    kinds: [WIKI_KIND],
    '#d': [args.topic],
  }
  if (args.author) {
    filter.authors = [args.author]
  } else {
    filter.limit = limit
  }

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map(parseWikiArticle)
}

/** List wiki topics (unique d-tags) with latest title/summary */
export async function handleWikiList(
  pool: RelayPool,
  npub: string,
  args: { author?: string; limit?: number },
): Promise<WikiTopic[]> {
  const limit = args.limit ?? 50
  const filter: Record<string, unknown> = {
    kinds: [WIKI_KIND],
    limit,
  }
  if (args.author) filter.authors = [args.author]

  const events = await pool.query(npub, filter as any)

  // Sort newest first, then deduplicate by topic (keeping newest)
  const sorted = events.sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
  const seen = new Set<string>()
  const topics: WikiTopic[] = []

  for (const event of sorted) {
    const dTag = event.tags.find(t => t[0] === 'd')
    const topic = dTag?.[1] ?? ''
    if (!topic || seen.has(topic)) continue
    seen.add(topic)

    const titleTag = event.tags.find(t => t[0] === 'title')
    const summaryTag = event.tags.find(t => t[0] === 'summary')

    topics.push({
      topic,
      title: titleTag?.[1] ?? '',
      summary: summaryTag?.[1] ?? '',
      pubkey: event.pubkey,
      created_at: event.created_at,
    })
  }

  return topics
}
