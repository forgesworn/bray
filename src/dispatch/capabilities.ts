/**
 * NIP-89 capability card handlers for dispatch discovery.
 *
 * Publishes kind 31990 replaceable events advertising dispatch capabilities,
 * and discovers other dispatch-capable agents on Nostr.
 */

import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapabilityCard {
  pubkey: string
  name: string
  description: string
  taskTypes: string[]
  repos: string[]
  availability: string
  maxDepth?: number
  slug: string
}

export interface CapabilityPublishResult {
  event: NostrEvent
  publish: PublishResult
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a name into a URL-safe d-tag identifier */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Parse a kind 31990 event into a CapabilityCard */
function parseCapabilityEvent(event: NostrEvent): CapabilityCard | null {
  try {
    const content = JSON.parse(event.content)
    if (content.protocol !== 'dispatch-v1') return null

    const dTag = event.tags.find(t => t[0] === 'd')

    return {
      pubkey: event.pubkey,
      name: content.name ?? '',
      description: content.description ?? '',
      taskTypes: Array.isArray(content.taskTypes) ? content.taskTypes : [],
      repos: Array.isArray(content.repos) ? content.repos : [],
      availability: content.availability ?? 'available',
      maxDepth: content.maxDepth,
      slug: dTag?.[1] ?? '',
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// handleCapabilityPublish
// ---------------------------------------------------------------------------

/**
 * Publish a kind 31990 event advertising dispatch capabilities.
 */
export async function handleCapabilityPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name: string
    description: string
    taskTypes: string[]
    repos?: string[]
    availability?: string
    maxDepth?: number
    slug?: string
  },
): Promise<CapabilityPublishResult> {
  const slug = args.slug ?? slugify(args.name)
  const ownPubkeyHex = ctx.activePublicKeyHex
  const now = Math.floor(Date.now() / 1000)

  const content = JSON.stringify({
    name: args.name,
    description: args.description,
    taskTypes: args.taskTypes,
    repos: args.repos ?? [],
    availability: args.availability ?? 'available',
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    protocol: 'dispatch-v1',
  })

  const tags: string[][] = [
    ['d', slug],
    ['k', '14'],
    ['t', 'dispatch'],
    ['p', ownPubkeyHex],
  ]
  for (const taskType of args.taskTypes) {
    tags.push(['t', taskType])
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 31990,
    created_at: now,
    tags,
    content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// ---------------------------------------------------------------------------
// handleCapabilityDiscover
// ---------------------------------------------------------------------------

/**
 * Discover dispatch-capable agents on Nostr via kind 31990 events.
 */
export async function handleCapabilityDiscover(
  pool: RelayPool,
  npub: string,
  args: {
    taskType?: string
    limit?: number
  },
): Promise<CapabilityCard[]> {
  const limit = args.limit ?? 20

  const tFilter = args.taskType
    ? ['dispatch', args.taskType]
    : ['dispatch']

  const filter: Record<string, unknown> = {
    kinds: [31990],
    '#t': tFilter,
    limit,
  }

  const events = await pool.query(npub, filter as any)

  const cards: CapabilityCard[] = []
  for (const event of events) {
    const card = parseCapabilityEvent(event)
    if (card) cards.push(card)
  }

  return cards
}

// ---------------------------------------------------------------------------
// handleCapabilityRead
// ---------------------------------------------------------------------------

/**
 * Fetch a specific agent's dispatch capability card by pubkey.
 */
export async function handleCapabilityRead(
  pool: RelayPool,
  npub: string,
  args: {
    pubkey: string
  },
): Promise<CapabilityCard | null> {
  const filter: Record<string, unknown> = {
    kinds: [31990],
    authors: [args.pubkey],
    '#t': ['dispatch'],
  }

  const events = await pool.query(npub, filter as any)

  if (events.length === 0) return null

  // Take the most recent
  const sorted = events.sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at)
  return parseCapabilityEvent(sorted[0])
}
