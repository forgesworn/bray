import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
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

/**
 * Create and publish a kind 1 text note.
 *
 * @param args.content - The plain-text body of the note.
 * @param args.tags - Optional NIP-10 or custom tags to attach (e.g. `[['t', 'nostr']]`).
 * @param args.relays - Optional explicit relay URLs to publish to; falls back to the identity's write relays.
 * @returns The signed event and a publish result describing relay acceptance.
 * @example
 * const result = await handleSocialPost(ctx, pool, {
 *   content: 'Hello Nostr!',
 *   tags: [['t', 'introduction']],
 * })
 * console.log(result.event.id)
 */
export async function handleSocialPost(
  ctx: SigningContext,
  pool: RelayPool,
  args: { content: string; tags?: string[][]; relays?: string[] },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: args.tags ?? [],
    content: args.content,
  })
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Create and publish a reply (kind 1 with e-tag and p-tag).
 *
 * @param args.content - The reply text.
 * @param args.replyTo - Event ID (hex) of the note being replied to.
 * @param args.replyToPubkey - Pubkey (hex) of the note's author.
 * @param args.relay - Optional relay hint for the referenced event.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @param args._scoring - Optional Veil scoring engine; populates `trustWarning` / `authorTrustScore` when supplied.
 * @returns The signed event, publish result, and an optional trust annotation for the original author.
 * @example
 * const result = await handleSocialReply(ctx, pool, {
 *   content: 'Great post!',
 *   replyTo: 'abc123...',
 *   replyToPubkey: 'def456...',
 * })
 */
export async function handleSocialReply(
  ctx: SigningContext,
  pool: RelayPool,
  args: { content: string; replyTo: string; replyToPubkey: string; relay?: string; relays?: string[]; _scoring?: VeilScoring },
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
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
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

/**
 * Create and publish a reaction (kind 7).
 *
 * @param args.eventId - ID (hex) of the event to react to.
 * @param args.eventPubkey - Pubkey (hex) of the event's author.
 * @param args.reaction - Reaction content; defaults to `'+'` (like). Use `'-'` for a dislike or an emoji.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed kind 7 event and publish result.
 * @example
 * const result = await handleSocialReact(ctx, pool, {
 *   eventId: 'abc123...',
 *   eventPubkey: 'def456...',
 *   reaction: '🤙',
 * })
 */
export async function handleSocialReact(
  ctx: SigningContext,
  pool: RelayPool,
  args: { eventId: string; eventPubkey: string; reaction?: string; relays?: string[] },
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
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Delete an event (kind 5 deletion request).
 *
 * @param args.eventId - ID (hex) of the event to request deletion of.
 * @param args.reason - Optional human-readable reason for deletion.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed kind 5 event and publish result.
 * @example
 * const result = await handleSocialDelete(ctx, pool, {
 *   eventId: 'abc123...',
 *   reason: 'Posted in error',
 * })
 */
export async function handleSocialDelete(
  ctx: SigningContext,
  pool: RelayPool,
  args: { eventId: string; reason?: string; relays?: string[] },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', args.eventId]],
    content: args.reason ?? '',
  })
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Repost/boost an event (kind 6).
 *
 * @param args.eventId - ID (hex) of the event to repost.
 * @param args.eventPubkey - Pubkey (hex) of the original event's author.
 * @param args.relay - Optional relay hint for the original event.
 * @param args.relays - Optional explicit relay URLs to publish the repost to.
 * @returns The signed kind 6 event and publish result.
 * @example
 * const result = await handleSocialRepost(ctx, pool, {
 *   eventId: 'abc123...',
 *   eventPubkey: 'def456...',
 *   relay: 'wss://relay.damus.io',
 * })
 */
export async function handleSocialRepost(
  ctx: SigningContext,
  pool: RelayPool,
  args: { eventId: string; eventPubkey: string; relay?: string; relays?: string[] },
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
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Fetch and parse the kind 0 profile for a pubkey.
 *
 * @param npub - The npub of the identity whose relay list is used for querying.
 * @param pubkeyHex - Pubkey (hex) of the profile to fetch.
 * @returns Parsed profile fields (e.g. `name`, `about`, `picture`, `nip05`), or an empty object if not found.
 * @example
 * const profile = await handleSocialProfileGet(pool, 'npub1...', 'abc123...')
 * console.log(profile.name) // 'Alice'
 */
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
  event?: NostrEvent
  warning?: string
  diff?: Record<string, { old: unknown; new: unknown }>
}

/**
 * Set the kind 0 profile for the active identity, with overwrite safety guard.
 *
 * @param args.profile - Profile fields to publish (e.g. `{ name, about, picture, nip05 }`).
 * @param args.confirm - Set to `true` to overwrite an existing profile; omit to receive a diff preview instead.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns An object indicating whether the profile was published, the signed event, an optional overwrite warning, and a diff of changed fields.
 * @example
 * // Preview changes first
 * const preview = await handleSocialProfileSet(ctx, pool, {
 *   profile: { name: 'Alice', about: 'Nostr dev' },
 * })
 * if (!preview.published) {
 *   console.log('Changes:', preview.diff)
 *   // Then confirm
 *   await handleSocialProfileSet(ctx, pool, {
 *     profile: { name: 'Alice', about: 'Nostr dev' },
 *     confirm: true,
 *   })
 * }
 */
export async function handleSocialProfileSet(
  ctx: SigningContext,
  pool: RelayPool,
  args: { profile: Record<string, unknown>; confirm?: boolean; relays?: string[] },
): Promise<ProfileSetResult> {
  // Check for existing profile
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [0],
    authors: [ctx.activePublicKeyHex],
  })

  // Relays SHOULD honour the authors filter, but a hostile or buggy relay can
  // return events from any pubkey. Filtering here prevents another identity's
  // kind-0 being surfaced in the diff preview (cross-identity content leak).
  const ownEvents = existing.filter(e => e.pubkey === ctx.activePublicKeyHex)

  if (ownEvents.length > 0 && !args.confirm) {
    // Build diff
    let oldProfile: Record<string, unknown> = {}
    try {
      const best = ownEvents.reduce((a: NostrEvent, b: NostrEvent) =>
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

    // Do not sign during preview. A signed kind-0 leak in the response payload
    // would reveal the active persona's intent to overwrite, and any MCP log
    // capturing the response could replay it. The caller must re-invoke with
    // confirm: true to produce and publish a real event.
    return {
      published: false,
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
  if (args.relays?.length) {
    await pool.publishDirect(args.relays, event)
  } else {
    await pool.publish(ctx.activeNpub, event)
  }

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

/**
 * Fetch the kind 3 contact list for a pubkey.
 *
 * @param npub - The npub of the identity whose relay list is used for querying.
 * @param pubkeyHex - Pubkey (hex) of the account whose contacts to fetch.
 * @returns Array of contacts, each with `pubkey`, optional `relay` hint, and optional `petname`.
 * @example
 * const contacts = await handleContactsGet(pool, 'npub1...', 'abc123...')
 * console.log(contacts.length) // 42
 */
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

/**
 * Search contacts by name/display_name/nip05 — resolves profiles in a single batch query.
 *
 * @param npub - The npub of the identity whose relay list is used for querying.
 * @param pubkeyHex - Pubkey (hex) of the account whose contact list to search.
 * @param query - Case-insensitive substring to match against `name`, `display_name`, `nip05`, or `petname`.
 * @returns Matching contacts enriched with profile metadata (`name`, `displayName`, `nip05`).
 * @example
 * const results = await handleContactsSearch(pool, 'npub1...', 'abc123...', 'alice')
 * results.forEach(c => console.log(c.name, c.pubkey))
 */
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

/**
 * Follow a pubkey — fetches current contacts, adds, publishes new kind 3.
 *
 * @param args.pubkeyHex - Pubkey (hex) to follow.
 * @param args.relay - Optional relay hint to include in the contact tag.
 * @param args.petname - Optional local nickname for this contact.
 * @param args.confirm - Set to `true` to bypass the shrinkage safety guard.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed kind 3 event and publish result, or a `ContactGuardWarning` if the list would shrink by more than 20 %.
 * @example
 * const result = await handleContactsFollow(ctx, pool, {
 *   pubkeyHex: 'abc123...',
 *   petname: 'alice',
 * })
 * if ('guarded' in result) {
 *   console.warn(result.warning)
 * }
 */
export async function handleContactsFollow(
  ctx: SigningContext,
  pool: RelayPool,
  args: { pubkeyHex: string; relay?: string; petname?: string; confirm?: boolean; relays?: string[] },
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
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Unfollow a pubkey — fetches current contacts, removes, publishes new kind 3.
 *
 * @param args.pubkeyHex - Pubkey (hex) to remove from the contact list.
 * @param args.confirm - Set to `true` to bypass the shrinkage safety guard.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed kind 3 event and publish result, or a `ContactGuardWarning` if the list would shrink by more than 20 %.
 * @example
 * const result = await handleContactsUnfollow(ctx, pool, {
 *   pubkeyHex: 'abc123...',
 *   confirm: true,
 * })
 */
export async function handleContactsUnfollow(
  ctx: SigningContext,
  pool: RelayPool,
  args: { pubkeyHex: string; confirm?: boolean; relays?: string[] },
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
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Sign and publish an event with arbitrary kind, content, and tags.
 *
 * @param args.kind - Nostr event kind number.
 * @param args.content - Raw content string for the event.
 * @param args.tags - Optional tag array (e.g. `[['d', 'my-identifier']]`).
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed event and publish result.
 * @example
 * const result = await handlePublishEvent(ctx, pool, {
 *   kind: 30023,
 *   content: '# My Article\n\nBody text here.',
 *   tags: [['d', 'my-article'], ['title', 'My Article']],
 * })
 */
export async function handlePublishEvent(
  ctx: SigningContext,
  pool: RelayPool,
  args: { kind: number; content: string; tags?: string[][]; relays?: string[] },
): Promise<PostResult> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: args.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: args.tags ?? [],
    content: args.content,
  })
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}
