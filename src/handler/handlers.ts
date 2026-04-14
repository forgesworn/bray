/**
 * NIP-XX Machine Application Handler tools.
 *
 * Publishes kind 31990 events with MCP transport tags, and discovers
 * MCP-capable handlers on Nostr.
 */

import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @experimental */
export interface HandlerTransport {
  endpoint: string
  transport: 'stdio' | 'http'
}

/** @experimental */
export interface HandlerCard {
  pubkey: string
  name: string
  about: string
  kinds: string[]
  transports: HandlerTransport[]
  dTag: string
  picture?: string
}

/** @experimental */
export interface HandlerPublishResult {
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

/** Parse a kind 31990 event into a HandlerCard, returning null if it has no mcp tags */
function parseHandlerEvent(event: NostrEvent): HandlerCard | null {
  try {
    const mcpTags = event.tags.filter(t => t[0] === 'mcp')
    if (mcpTags.length === 0) return null

    const content = JSON.parse(event.content)
    const dTag = event.tags.find(t => t[0] === 'd')
    const kTags = event.tags.filter(t => t[0] === 'k')

    const transports: HandlerTransport[] = mcpTags.map(t => ({
      endpoint: t[1] ?? '',
      transport: (t[2] ?? 'stdio') as 'stdio' | 'http',
    }))

    return {
      pubkey: event.pubkey,
      name: content.name ?? '',
      about: content.about ?? '',
      picture: content.picture,
      kinds: kTags.map(t => t[1]),
      transports,
      dTag: dTag?.[1] ?? '',
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// handleHandlerPublish
// ---------------------------------------------------------------------------

/**
 * Publish a kind 31990 event advertising MCP handler capabilities.
 *
 * At least one of stdioCommand or httpUrl must be provided.
 */
export async function handleHandlerPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name: string
    about: string
    kinds: string[]
    stdioCommand?: string
    httpUrl?: string
    picture?: string
    dTag?: string
  },
): Promise<HandlerPublishResult> {
  if (!args.stdioCommand && !args.httpUrl) {
    throw new Error('At least one of stdioCommand or httpUrl must be provided.')
  }

  const dTag = args.dTag ?? slugify(args.name)
  const now = Math.floor(Date.now() / 1000)

  const contentObj: Record<string, string> = {
    name: args.name,
    about: args.about,
  }
  if (args.picture) contentObj.picture = args.picture

  const content = JSON.stringify(contentObj)

  const kindList = args.kinds.join(', ')
  const tags: string[][] = [
    ['d', dTag],
    ...args.kinds.map(k => ['k', k]),
    ['alt', `MCP handler for kind ${kindList}`],
  ]

  if (args.stdioCommand) tags.push(['mcp', args.stdioCommand, 'stdio'])
  if (args.httpUrl) tags.push(['mcp', args.httpUrl, 'http'])

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
// handleHandlerDiscover
// ---------------------------------------------------------------------------

/**
 * Discover MCP-capable handlers on Nostr via kind 31990 events.
 *
 * Filters results to only include events that contain at least one mcp tag.
 */
export async function handleHandlerDiscover(
  pool: RelayPool,
  npub: string,
  args: {
    kind?: string
    limit?: number
  },
): Promise<HandlerCard[]> {
  const limit = args.limit ?? 20

  const filter: Record<string, unknown> = {
    kinds: [31990],
    limit,
  }

  if (args.kind) {
    filter['#k'] = [args.kind]
  }

  const events = await pool.query(npub, filter as any)

  const cards: HandlerCard[] = []
  for (const event of events) {
    const card = parseHandlerEvent(event)
    if (card) cards.push(card)
  }

  return cards
}
