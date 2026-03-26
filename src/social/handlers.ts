import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { VeilScoring } from '../veil/scoring.js'

export interface PostResult {
  event: NostrEvent
  publish: PublishResult
}

export interface ReplyResult extends PostResult {
  trustWarning?: string
  authorTrustScore?: number
}

export interface ContactGuardWarning {
  guarded: true
  warning: string
  previousCount: number
  proposedCount: number
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
  args: { content: string; replyTo: string; replyToPubkey: string; relay?: string; _scoring?: VeilScoring },
): Promise<ReplyResult> {
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
  const result: ReplyResult = { event, publish }

  if (args._scoring) {
    const score = await args._scoring.scorePubkey(args.replyToPubkey)
    if (score.score === 0) {
      result.trustWarning = 'This author has no trust endorsements in your network.'
    } else {
      result.authorTrustScore = score.score
    }
  }

  return result
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
    authors: [ctx.activePublicKeyHex], // simplified — in production, use hex pubkey
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

export interface EnrichedContact extends Contact {
  name?: string
  displayName?: string
  nip05?: string
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

/** Batch-fetch kind 0 profiles for a list of pubkeys, returning the newest per author */
async function batchFetchProfiles(
  pool: RelayPool,
  npub: string,
  pubkeys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  if (pubkeys.length === 0) return new Map()

  const events = await pool.query(npub, {
    kinds: [0],
    authors: pubkeys,
  })

  // Keep only the newest kind 0 per pubkey
  const best = new Map<string, NostrEvent>()
  for (const ev of events) {
    const prev = best.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) {
      best.set(ev.pubkey, ev)
    }
  }

  const profiles = new Map<string, Record<string, unknown>>()
  for (const [pk, ev] of best) {
    try {
      profiles.set(pk, JSON.parse(ev.content))
    } catch { /* skip unparseable */ }
  }
  return profiles
}

/** Search contacts by name/display_name/nip05 — resolves profiles in a single batch query */
export async function handleContactsSearch(
  pool: RelayPool,
  npub: string,
  pubkeyHex: string,
  query: string,
): Promise<EnrichedContact[]> {
  const contacts = await handleContactsGet(pool, npub, pubkeyHex)
  if (contacts.length === 0) return []

  const profiles = await batchFetchProfiles(
    pool,
    npub,
    contacts.map(c => c.pubkey),
  )

  const q = query.toLowerCase()
  const results: EnrichedContact[] = []

  for (const contact of contacts) {
    const profile = profiles.get(contact.pubkey)
    const name = (profile?.name as string) ?? ''
    const displayName = (profile?.display_name as string) ?? ''
    const nip05 = (profile?.nip05 as string) ?? ''
    const petname = contact.petname ?? ''

    if (
      name.toLowerCase().includes(q) ||
      displayName.toLowerCase().includes(q) ||
      nip05.toLowerCase().includes(q) ||
      petname.toLowerCase().includes(q)
    ) {
      results.push({
        ...contact,
        name: name || undefined,
        displayName: displayName || undefined,
        nip05: nip05 || undefined,
      })
    }
  }

  return results
}

/** Follow a pubkey — fetches current contacts, adds, publishes new kind 3 */
export async function handleContactsFollow(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkeyHex: string; relay?: string; petname?: string; confirm?: boolean },
): Promise<PostResult | ContactGuardWarning> {
  // Fetch existing contacts
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [ctx.activePublicKeyHex],
  })

  let tags: string[][] = []
  if (existing.length > 0) {
    const best = existing.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )
    tags = best.tags.filter(t => t[0] === 'p')
  }

  const oldList = tags.slice()

  // Don't duplicate
  if (!tags.some(t => t[1] === args.pubkeyHex)) {
    const newTag = ['p', args.pubkeyHex]
    if (args.relay) newTag.push(args.relay)
    if (args.petname) { if (!args.relay) newTag.push(''); newTag.push(args.petname) }
    tags.push(newTag)
  }

  const newList = tags

  if (oldList.length > 0) {
    const shrinkage = 1 - (newList.length / oldList.length)
    if (shrinkage > 0.2 && !args.confirm) {
      return {
        guarded: true,
        warning: `Contact list would shrink by ${Math.round(shrinkage * 100)}% (${oldList.length} → ${newList.length}). Pass confirm: true to proceed.`,
        previousCount: oldList.length,
        proposedCount: newList.length,
      }
    }
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
  args: { pubkeyHex: string; confirm?: boolean },
): Promise<PostResult | ContactGuardWarning> {
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [ctx.activePublicKeyHex],
  })

  let oldTags: string[][] = []
  if (existing.length > 0) {
    const best = existing.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )
    oldTags = best.tags.filter(t => t[0] === 'p')
  }

  const tags = oldTags.filter(t => t[1] !== args.pubkeyHex)
  const oldList = oldTags
  const newList = tags

  if (oldList.length > 0) {
    const shrinkage = 1 - (newList.length / oldList.length)
    if (shrinkage > 0.2 && !args.confirm) {
      return {
        guarded: true,
        warning: `Contact list would shrink by ${Math.round(shrinkage * 100)}% (${oldList.length} → ${newList.length}). Pass confirm: true to proceed.`,
        previousCount: oldList.length,
        proposedCount: newList.length,
      }
    }
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
