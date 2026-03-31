import type { Event as NostrEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface CommunityInfo {
  name: string
  description: string
  image?: string
  rules?: string
  moderators: string[]
  pubkey: string
}

export interface CommunityPost {
  id: string
  pubkey: string
  content: string
  createdAt: number
  approvedBy: string
}

/** Create a kind 34550 community definition */
export async function handleCommunityCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name: string
    description: string
    image?: string
    rules?: string
    moderators?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const tags: string[][] = [
    ['d', args.name],
    ['description', args.description],
  ]
  if (args.image) tags.push(['image', args.image])
  if (args.rules) tags.push(['rules', args.rules])
  if (args.moderators) {
    for (const mod of args.moderators) {
      tags.push(['p', mod, '', 'moderator'])
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 34550,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch approved posts (kind 4550) for a community */
export async function handleCommunityFeed(
  pool: RelayPool,
  npub: string,
  args: { community: string; limit?: number; since?: number },
): Promise<CommunityPost[]> {
  const coordinate = normaliseCoordinate(args.community)

  const filter: Record<string, unknown> = {
    kinds: [4550],
    '#a': [coordinate],
    limit: args.limit ?? 50,
  }
  if (args.since) filter.since = args.since

  const events = await pool.query(npub, filter as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map((e: NostrEvent) => {
      let content = ''
      let originalPubkey = ''
      let originalId = ''
      let originalCreatedAt = e.created_at

      try {
        const wrapped = JSON.parse(e.content)
        content = wrapped.content ?? ''
        originalPubkey = wrapped.pubkey ?? ''
        originalId = wrapped.id ?? ''
        originalCreatedAt = wrapped.created_at ?? e.created_at
      } catch {
        // If content is not valid JSON, fall back to raw content
        content = e.content
        const pTag = e.tags.find(t => t[0] === 'p')
        originalPubkey = pTag?.[1] ?? ''
        const eTag = e.tags.find(t => t[0] === 'e')
        originalId = eTag?.[1] ?? ''
      }

      return {
        id: originalId || e.id,
        pubkey: originalPubkey || e.pubkey,
        content,
        createdAt: originalCreatedAt,
        approvedBy: e.pubkey,
      }
    })
}

/** Post to a community (kind 1 with `a` tag) */
export async function handleCommunityPost(
  ctx: SigningContext,
  pool: RelayPool,
  args: { community: string; content: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const coordinate = normaliseCoordinate(args.community)

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['a', coordinate]],
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Moderator approves a post (kind 4550) */
export async function handleCommunityApprove(
  ctx: SigningContext,
  pool: RelayPool,
  args: { community: string; eventId: string; eventPubkey: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const coordinate = normaliseCoordinate(args.community)

  // Fetch the original event
  const originals = await pool.query(ctx.activeNpub, {
    ids: [args.eventId],
  } as any)

  const original = originals[0]
  if (!original) {
    throw new Error(`Event ${args.eventId} not found on relays`)
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 4550,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['a', coordinate],
      ['e', args.eventId],
      ['p', args.eventPubkey],
    ],
    content: JSON.stringify(original),
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Discover communities (kind 34550) */
export async function handleCommunityList(
  pool: RelayPool,
  npub: string,
  args: { limit?: number },
): Promise<CommunityInfo[]> {
  const events = await pool.query(npub, {
    kinds: [34550],
    limit: args.limit ?? 20,
  } as any)

  return events
    .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
    .map((e: NostrEvent) => {
      const dTag = e.tags.find(t => t[0] === 'd')
      const descTag = e.tags.find(t => t[0] === 'description')
      const imageTag = e.tags.find(t => t[0] === 'image')
      const rulesTag = e.tags.find(t => t[0] === 'rules')
      const moderators = e.tags
        .filter(t => t[0] === 'p' && t[3] === 'moderator')
        .map(t => t[1])

      return {
        name: dTag?.[1] ?? '',
        description: descTag?.[1] ?? '',
        image: imageTag?.[1] || undefined,
        rules: rulesTag?.[1] || undefined,
        moderators,
        pubkey: e.pubkey,
      }
    })
}

/** Normalise a community coordinate — accepts naddr or 34550:pubkey:name */
function normaliseCoordinate(input: string): string {
  // If already in coordinate form, return as-is
  if (input.startsWith('34550:')) return input

  // Attempt naddr decode
  try {
    if (input.startsWith('naddr')) {
      const decoded = nip19.decode(input)
      if (decoded.type === 'naddr') {
        const data = decoded.data as { kind: number; pubkey: string; identifier: string }
        return `${data.kind}:${data.pubkey}:${data.identifier}`
      }
    }
  } catch {
    // Fall through
  }

  return input
}
