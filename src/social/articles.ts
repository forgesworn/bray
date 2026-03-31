import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface Article {
  id: string
  pubkey: string
  slug: string
  title: string
  summary: string
  image: string
  publishedAt: number
  createdAt: number
  hashtags: string[]
  content: string
}

export interface ArticleMeta {
  slug: string
  title: string
  summary: string
  publishedAt: number
  createdAt: number
}

export interface ArticlePublishResult {
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

/** Parse a kind 30023 event into a structured Article */
function parseArticle(event: NostrEvent): Article {
  const dTag = event.tags.find(t => t[0] === 'd')
  const titleTag = event.tags.find(t => t[0] === 'title')
  const summaryTag = event.tags.find(t => t[0] === 'summary')
  const imageTag = event.tags.find(t => t[0] === 'image')
  const publishedAtTag = event.tags.find(t => t[0] === 'published_at')
  const tTags = event.tags.filter(t => t[0] === 't')

  return {
    id: event.id,
    pubkey: event.pubkey,
    slug: dTag?.[1] ?? '',
    title: titleTag?.[1] ?? '',
    summary: summaryTag?.[1] ?? '',
    image: imageTag?.[1] ?? '',
    publishedAt: publishedAtTag?.[1] ? parseInt(publishedAtTag[1], 10) : event.created_at,
    createdAt: event.created_at,
    hashtags: tTags.map(t => t[1]),
    content: event.content,
  }
}

/** Create and publish a kind 30023 long-form article */
export async function handleArticlePublish(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    title: string
    content: string
    summary?: string
    image?: string
    published_at?: string
    hashtags?: string[]
    slug?: string
  },
): Promise<ArticlePublishResult> {
  const slug = args.slug ?? slugify(args.title)
  const now = Math.floor(Date.now() / 1000)
  const publishedAt = args.published_at
    ? Math.floor(new Date(args.published_at).getTime() / 1000)
    : now

  const tags: string[][] = [
    ['d', slug],
    ['title', args.title],
  ]
  if (args.summary) tags.push(['summary', args.summary])
  if (args.image) tags.push(['image', args.image])
  tags.push(['published_at', String(publishedAt)])
  if (args.hashtags) {
    for (const hashtag of args.hashtags) {
      tags.push(['t', hashtag])
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 30023,
    created_at: now,
    tags,
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch kind 30023 articles by author and optional slug */
export async function handleArticleRead(
  pool: RelayPool,
  npub: string,
  args: { author: string; slug?: string },
): Promise<Article[]> {
  const filter: Record<string, unknown> = {
    kinds: [30023],
    authors: [args.author],
  }
  if (args.slug) filter['#d'] = [args.slug]

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map(parseArticle)
}

/** Fetch kind 30023 article metadata by author (no full content) */
export async function handleArticleList(
  pool: RelayPool,
  npub: string,
  args: { author: string; limit?: number },
): Promise<ArticleMeta[]> {
  const filter: Record<string, unknown> = {
    kinds: [30023],
    authors: [args.author],
  }
  if (args.limit) filter.limit = args.limit

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map((event: NostrEvent) => {
      const dTag = event.tags.find(t => t[0] === 'd')
      const titleTag = event.tags.find(t => t[0] === 'title')
      const summaryTag = event.tags.find(t => t[0] === 'summary')
      const publishedAtTag = event.tags.find(t => t[0] === 'published_at')
      return {
        slug: dTag?.[1] ?? '',
        title: titleTag?.[1] ?? '',
        summary: summaryTag?.[1] ?? '',
        publishedAt: publishedAtTag?.[1] ? parseInt(publishedAtTag[1], 10) : event.created_at,
        createdAt: event.created_at,
      }
    })
}
