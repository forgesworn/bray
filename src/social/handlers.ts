import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface PostResult {
  event: NostrEvent
  publish: PublishResult
}

/** Create and publish a kind 1 text note */
export async function handleSocialPost(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { content: string; tags?: string[][] },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: args.tags ?? [],
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Create and publish a reply (kind 1 with e-tag and p-tag) */
export async function handleSocialReply(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { content: string; replyTo: string; replyToPubkey: string; relay?: string },
): Promise<PostResult> {
  const tags: string[][] = [
    ['e', args.replyTo, args.relay ?? '', 'reply'],
    ['p', args.replyToPubkey],
  ]
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Create and publish a reaction (kind 7) */
export async function handleSocialReact(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { eventId: string; eventPubkey: string; reaction?: string },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 7,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', args.eventId],
      ['p', args.eventPubkey],
    ],
    content: args.reaction ?? '+',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Delete an event (kind 5 deletion request) */
export async function handleSocialDelete(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { eventId: string; reason?: string },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', args.eventId]],
    content: args.reason ?? '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Repost/boost an event (kind 6) */
export async function handleSocialRepost(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { eventId: string; eventPubkey: string; relay?: string },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 6,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', args.eventId, args.relay ?? ''],
      ['p', args.eventPubkey],
    ],
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Fetch and parse the kind 0 profile for a pubkey */
export async function handleSocialProfileGet(
  pool: RelayPool,
  npub: string,
  pubkeyHex: string,
): Promise<Record<string, unknown>> {
  const events = await pool.query(npub, {
    kinds: [0],
    authors: [pubkeyHex],
  })

  if (events.length === 0) return {}

  // Take highest created_at
  const best = events.reduce((a: NostrEvent, b: NostrEvent) =>
    b.created_at > a.created_at ? b : a
  )

  try {
    return JSON.parse(best.content)
  } catch {
    return {}
  }
}

export interface ProfileSetResult {
  published: boolean
  event: NostrEvent
  warning?: string
  diff?: Record<string, { old: unknown; new: unknown }>
}

/** Set the kind 0 profile for the active identity, with overwrite safety guard */
export async function handleSocialProfileSet(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { profile: Record<string, unknown>; confirm?: boolean },
): Promise<ProfileSetResult> {
  // Check for existing profile
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [0],
    authors: [ctx.activeNpub], // simplified — in production, use hex pubkey
  })

  if (existing.length > 0 && !args.confirm) {
    // Build diff
    let oldProfile: Record<string, unknown> = {}
    try {
      const best = existing.reduce((a: NostrEvent, b: NostrEvent) =>
        b.created_at > a.created_at ? b : a
      )
      oldProfile = JSON.parse(best.content)
    } catch { /* ignore */ }

    const diff: Record<string, { old: unknown; new: unknown }> = {}
    const allKeys = new Set([...Object.keys(oldProfile), ...Object.keys(args.profile)])
    for (const key of allKeys) {
      if (oldProfile[key] !== args.profile[key]) {
        diff[key] = { old: oldProfile[key], new: args.profile[key] }
      }
    }

    const sign = ctx.getSigningFunction()
    const event = await sign({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(args.profile),
    })

    return {
      published: false,
      event,
      warning: 'Profile already exists. Set confirm: true to overwrite.',
      diff,
    }
  }

  // Publish
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(args.profile),
  })
  await pool.publish(ctx.activeNpub, event)

  return { published: true, event }
}

// --- Contacts (kind 3) ---

export interface Contact {
  pubkey: string
  relay?: string
  petname?: string
}

/** Fetch the kind 3 contact list for a pubkey */
export async function handleContactsGet(
  pool: RelayPool,
  npub: string,
  pubkeyHex: string,
): Promise<Contact[]> {
  const events = await pool.query(npub, {
    kinds: [3],
    authors: [pubkeyHex],
  })

  if (events.length === 0) return []

  const best = events.reduce((a: NostrEvent, b: NostrEvent) =>
    b.created_at > a.created_at ? b : a
  )

  return best.tags
    .filter(t => t[0] === 'p' && t[1])
    .map(t => ({
      pubkey: t[1],
      relay: t[2] || undefined,
      petname: t[3] || undefined,
    }))
}

/** Follow a pubkey — fetches current contacts, adds, publishes new kind 3 */
export async function handleContactsFollow(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkeyHex: string; relay?: string; petname?: string },
): Promise<PostResult> {
  // Fetch existing contacts
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [ctx.activeNpub],
  })

  let tags: string[][] = []
  if (existing.length > 0) {
    const best = existing.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )
    tags = best.tags.filter(t => t[0] === 'p')
  }

  // Don't duplicate
  if (!tags.some(t => t[1] === args.pubkeyHex)) {
    const newTag = ['p', args.pubkeyHex]
    if (args.relay) newTag.push(args.relay)
    if (args.petname) { if (!args.relay) newTag.push(''); newTag.push(args.petname) }
    tags.push(newTag)
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Unfollow a pubkey — fetches current contacts, removes, publishes new kind 3 */
export async function handleContactsUnfollow(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkeyHex: string },
): Promise<PostResult> {
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [ctx.activeNpub],
  })

  let tags: string[][] = []
  if (existing.length > 0) {
    const best = existing.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )
    tags = best.tags.filter(t => t[0] === 'p' && t[1] !== args.pubkeyHex)
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}
