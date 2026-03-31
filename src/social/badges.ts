import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BadgeDefinition {
  id: string
  pubkey: string
  slug: string
  name: string
  description: string
  image?: string
  thumb?: string
  createdAt: number
}

export interface ProfileBadgePair {
  definitionCoord: string
  awardEventId: string
}

export interface BadgePublishResult {
  event: NostrEvent
  publish: PublishResult
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/** Parse a kind 30009 badge definition event */
function parseBadgeDefinition(event: NostrEvent): BadgeDefinition {
  const dTag = event.tags.find(t => t[0] === 'd')
  const nameTag = event.tags.find(t => t[0] === 'name')
  const descTag = event.tags.find(t => t[0] === 'description')
  const imageTag = event.tags.find(t => t[0] === 'image')
  const thumbTag = event.tags.find(t => t[0] === 'thumb')

  return {
    id: event.id,
    pubkey: event.pubkey,
    slug: dTag?.[1] ?? '',
    name: nameTag?.[1] ?? '',
    description: descTag?.[1] ?? '',
    image: imageTag?.[1] || undefined,
    thumb: thumbTag?.[1] || undefined,
    createdAt: event.created_at,
  }
}

/** Parse profile badge pairs from a kind 30008 event */
function parseProfileBadgePairs(event: NostrEvent): ProfileBadgePair[] {
  const pairs: ProfileBadgePair[] = []
  const tags = event.tags

  for (let i = 0; i < tags.length; i++) {
    if (tags[i][0] === 'a' && i + 1 < tags.length && tags[i + 1][0] === 'e') {
      pairs.push({
        definitionCoord: tags[i][1],
        awardEventId: tags[i + 1][1],
      })
    }
  }

  return pairs
}

// ─── handleBadgeCreate ────────────────────────────────────────────────────────

/** Create and publish a kind 30009 badge definition */
export async function handleBadgeCreate(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    slug: string
    name: string
    description: string
    image?: string
    thumb?: string
  },
): Promise<BadgePublishResult> {
  const now = Math.floor(Date.now() / 1000)

  const tags: string[][] = [
    ['d', args.slug],
    ['name', args.name],
    ['description', args.description],
  ]
  if (args.image) tags.push(['image', args.image])
  if (args.thumb) tags.push(['thumb', args.thumb])

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 30009,
    created_at: now,
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// ─── handleBadgeAward ─────────────────────────────────────────────────────────

/** Award a badge to one or more recipients (kind 8) */
export async function handleBadgeAward(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    badgeSlug: string
    recipients: string[]
  },
): Promise<BadgePublishResult> {
  const now = Math.floor(Date.now() / 1000)
  const coordinate = `30009:${ctx.activePublicKeyHex}:${args.badgeSlug}`

  const tags: string[][] = [
    ['a', coordinate],
  ]
  for (const hex of args.recipients) {
    tags.push(['p', hex])
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 8,
    created_at: now,
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// ─── handleBadgeAccept ────────────────────────────────────────────────────────

/** Add a badge to the user's profile badges (updates kind 30008) */
export async function handleBadgeAccept(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    badgeDefinitionCoord: string
    awardEventId: string
  },
): Promise<BadgePublishResult> {
  const now = Math.floor(Date.now() / 1000)

  // Fetch existing profile badges event
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [30008],
    authors: [ctx.activePublicKeyHex],
    '#d': ['profile_badges'],
  } as any) as NostrEvent[]

  // Preserve existing badge pairs
  const tags: string[][] = [['d', 'profile_badges']]

  if (existing.length > 0) {
    const existingTags = existing[0].tags
    for (let i = 0; i < existingTags.length; i++) {
      if (existingTags[i][0] === 'a' && i + 1 < existingTags.length && existingTags[i + 1][0] === 'e') {
        tags.push(existingTags[i])
        tags.push(existingTags[i + 1])
        i++ // skip the e tag we already added
      }
    }
  }

  // Append the new badge pair
  tags.push(['a', args.badgeDefinitionCoord])
  tags.push(['e', args.awardEventId])

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 30008,
    created_at: now,
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// ─── handleBadgeList ──────────────────────────────────────────────────────────

/** List badges defined by an author or badges displayed on a profile */
export async function handleBadgeList(
  pool: RelayPool,
  npub: string,
  args: {
    pubkey: string
    mode: 'defined' | 'profile'
  },
): Promise<BadgeDefinition[] | ProfileBadgePair[]> {
  if (args.mode === 'defined') {
    const events = await pool.query(npub, {
      kinds: [30009],
      authors: [args.pubkey],
    } as any) as NostrEvent[]

    return events
      .sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
      .map(parseBadgeDefinition)
  }

  // mode === 'profile'
  const events = await pool.query(npub, {
    kinds: [30008],
    authors: [args.pubkey],
    '#d': ['profile_badges'],
  } as any) as NostrEvent[]

  if (events.length === 0) return []
  return parseProfileBadgePairs(events[0])
}
