import { finalizeEvent } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { TrustContext } from '../trust-context.js'

// ---------------------------------------------------------------------------
// NIP-32 Labels (kind 1985)
// ---------------------------------------------------------------------------

export interface LabelCreateResult {
  event: NostrEvent
  publish: PublishResult
}

/** Create and publish a NIP-32 label event (kind 1985) */
export async function handleLabelCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    namespace: string
    label: string
    targetEventId?: string
    targetPubkey?: string
    targetAddress?: string
    content?: string
  },
): Promise<LabelCreateResult> {
  if (!args.targetEventId && !args.targetPubkey && !args.targetAddress) {
    throw new Error('At least one target must be provided: targetEventId, targetPubkey, or targetAddress')
  }

  const tags: string[][] = [
    ['L', args.namespace],
    ['l', args.label, args.namespace],
  ]

  if (args.targetEventId) tags.push(['e', args.targetEventId])
  if (args.targetPubkey) tags.push(['p', args.targetPubkey])
  if (args.targetAddress) tags.push(['a', args.targetAddress])

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1985,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.content ?? '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Create a self-label on your own content (kind 1985 with L/l tags) */
export async function handleLabelSelf(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    namespace: string
    label: string
    eventId: string
    content?: string
  },
): Promise<LabelCreateResult> {
  const tags: string[][] = [
    ['L', args.namespace],
    ['l', args.label, args.namespace],
    ['e', args.eventId],
  ]

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 1985,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.content ?? '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

export interface LabelEvent {
  id: string
  pubkey: string
  namespace: string
  label: string
  targets: { type: 'event' | 'pubkey' | 'address'; value: string }[]
  content: string
  created_at: number
}

/** Parse a kind 1985 event into a structured label */
function parseLabel(event: NostrEvent): LabelEvent | null {
  if (event.kind !== 1985) return null
  const lTag = event.tags.find(t => t[0] === 'L')
  const labelTag = event.tags.find(t => t[0] === 'l')
  if (!lTag || !labelTag) return null

  const targets: LabelEvent['targets'] = []
  for (const tag of event.tags) {
    if (tag[0] === 'e') targets.push({ type: 'event', value: tag[1] })
    if (tag[0] === 'p') targets.push({ type: 'pubkey', value: tag[1] })
    if (tag[0] === 'a') targets.push({ type: 'address', value: tag[1] })
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    namespace: lTag[1],
    label: labelTag[1],
    targets,
    content: event.content,
    created_at: event.created_at,
  }
}

/** Query labels for a specific target, optionally filtered by namespace/labeller */
export async function handleLabelRead(
  pool: RelayPool,
  npub: string,
  args: {
    targetEventId?: string
    targetPubkey?: string
    targetAddress?: string
    namespace?: string
    labeller?: string
  },
): Promise<LabelEvent[]> {
  const filter: Filter = { kinds: [1985] }

  // NIP-32 uses #e, #p, #a for target filtering and #L for namespace
  if (args.targetEventId) (filter as any)['#e'] = [args.targetEventId]
  if (args.targetPubkey) (filter as any)['#p'] = [args.targetPubkey]
  if (args.targetAddress) (filter as any)['#a'] = [args.targetAddress]
  if (args.namespace) (filter as any)['#L'] = [args.namespace]
  if (args.labeller) filter.authors = [args.labeller]

  const events = await pool.query(npub, filter)
  return events.map(parseLabel).filter((l): l is LabelEvent => l !== null)
}

/** Search for all events/pubkeys with a specific label value */
export async function handleLabelSearch(
  pool: RelayPool,
  npub: string,
  args: {
    namespace: string
    label: string
    labeller?: string
  },
): Promise<LabelEvent[]> {
  const filter: Filter = {
    kinds: [1985],
    ...(args.labeller ? { authors: [args.labeller] } : {}),
  }
  ;(filter as any)['#L'] = [args.namespace]
  ;(filter as any)['#l'] = [args.label]

  const events = await pool.query(npub, filter)
  return events.map(parseLabel).filter((l): l is LabelEvent => l !== null)
}

/** Delete a label via kind 5 deletion event */
export async function handleLabelRemove(
  ctx: SigningContext,
  pool: RelayPool,
  args: { labelEventId: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', args.labelEventId], ['k', '1985']],
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// ---------------------------------------------------------------------------
// NIP-51 Lists
// ---------------------------------------------------------------------------

/** Kind numbers for NIP-51 list types */
const LIST_KINDS = {
  mute: 10000,
  pin: 10001,
  bookmarks: 10003,
  followSet: 30000,
  bookmarkSet: 30001,
} as const

type MuteAction = 'add' | 'remove'

interface MuteEntry {
  type: 'pubkey' | 'event' | 'keyword' | 'hashtag'
  value: string
}

/** Convert a mute entry to the appropriate Nostr tag */
function muteEntryToTag(entry: MuteEntry): string[] {
  switch (entry.type) {
    case 'pubkey': return ['p', entry.value]
    case 'event': return ['e', entry.value]
    case 'keyword': return ['word', entry.value]
    case 'hashtag': return ['t', entry.value]
  }
}

/** Parse tags back into mute entries */
function tagToMuteEntry(tag: string[]): MuteEntry | null {
  switch (tag[0]) {
    case 'p': return { type: 'pubkey', value: tag[1] }
    case 'e': return { type: 'event', value: tag[1] }
    case 'word': return { type: 'keyword', value: tag[1] }
    case 't': return { type: 'hashtag', value: tag[1] }
    default: return null
  }
}

/** Fetch the latest version of a replaceable list by kind */
async function fetchLatestList(
  pool: RelayPool,
  npub: string,
  kind: number,
  dTag?: string,
): Promise<NostrEvent | null> {
  const pubkeyHex = (decode(npub).data as string)
  const filter: Filter = { kinds: [kind], authors: [pubkeyHex], limit: 1 }
  if (dTag !== undefined) (filter as any)['#d'] = [dTag]

  const events = await pool.query(npub, filter)
  if (events.length === 0) return null

  // Return the most recent
  return events.sort((a, b) => b.created_at - a.created_at)[0]
}

/** Manage mute list (kind 10000): add or remove entries */
export async function handleListMute(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    action: MuteAction
    entries: MuteEntry[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult; entries: MuteEntry[] }> {
  const existing = await fetchLatestList(pool, ctx.activeNpub, LIST_KINDS.mute)
  let currentTags: string[][] = existing?.tags ?? []

  if (args.action === 'add') {
    const newTags = args.entries.map(muteEntryToTag)
    // Deduplicate: skip entries already present
    for (const newTag of newTags) {
      const alreadyExists = currentTags.some(
        t => t[0] === newTag[0] && t[1] === newTag[1],
      )
      if (!alreadyExists) currentTags.push(newTag)
    }
  } else {
    // Remove matching entries
    for (const entry of args.entries) {
      const tag = muteEntryToTag(entry)
      currentTags = currentTags.filter(
        t => !(t[0] === tag[0] && t[1] === tag[1]),
      )
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: LIST_KINDS.mute,
    created_at: Math.floor(Date.now() / 1000),
    tags: currentTags,
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  const finalEntries = currentTags
    .map(tagToMuteEntry)
    .filter((e): e is MuteEntry => e !== null)

  return { event, publish, entries: finalEntries }
}

/** Read mute list */
export async function handleListMuteRead(
  pool: RelayPool,
  npub: string,
): Promise<{ entries: MuteEntry[]; eventId?: string }> {
  const existing = await fetchLatestList(pool, npub, LIST_KINDS.mute)
  if (!existing) return { entries: [] }

  const entries = existing.tags
    .map(tagToMuteEntry)
    .filter((e): e is MuteEntry => e !== null)

  return { entries, eventId: existing.id }
}

/** Check if a pubkey, event, or keyword is muted */
export async function handleListCheckMuted(
  pool: RelayPool,
  npub: string,
  args: {
    pubkey?: string
    eventId?: string
    keyword?: string
    hashtag?: string
  },
): Promise<{ muted: boolean; matchType?: string; matchValue?: string }> {
  const { entries } = await handleListMuteRead(pool, npub)

  for (const entry of entries) {
    if (args.pubkey && entry.type === 'pubkey' && entry.value === args.pubkey) {
      return { muted: true, matchType: 'pubkey', matchValue: entry.value }
    }
    if (args.eventId && entry.type === 'event' && entry.value === args.eventId) {
      return { muted: true, matchType: 'event', matchValue: entry.value }
    }
    if (args.keyword && entry.type === 'keyword' && entry.value.toLowerCase() === args.keyword.toLowerCase()) {
      return { muted: true, matchType: 'keyword', matchValue: entry.value }
    }
    if (args.hashtag && entry.type === 'hashtag' && entry.value.toLowerCase() === args.hashtag.toLowerCase()) {
      return { muted: true, matchType: 'hashtag', matchValue: entry.value }
    }
  }

  return { muted: false }
}

/** Manage pinned events (kind 10001): add or remove event IDs */
export async function handleListPin(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    action: 'add' | 'remove'
    eventIds: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult; pinned: string[] }> {
  const existing = await fetchLatestList(pool, ctx.activeNpub, LIST_KINDS.pin)
  let currentTags: string[][] = existing?.tags ?? []

  if (args.action === 'add') {
    for (const id of args.eventIds) {
      if (!currentTags.some(t => t[0] === 'e' && t[1] === id)) {
        currentTags.push(['e', id])
      }
    }
  } else {
    currentTags = currentTags.filter(
      t => !(t[0] === 'e' && args.eventIds.includes(t[1])),
    )
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: LIST_KINDS.pin,
    created_at: Math.floor(Date.now() / 1000),
    tags: currentTags,
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  const pinned = currentTags.filter(t => t[0] === 'e').map(t => t[1])

  return { event, publish, pinned }
}

/** Read pinned events */
export async function handleListPinRead(
  pool: RelayPool,
  npub: string,
): Promise<{ pinned: string[]; eventId?: string }> {
  const existing = await fetchLatestList(pool, npub, LIST_KINDS.pin)
  if (!existing) return { pinned: [] }

  const pinned = existing.tags.filter(t => t[0] === 'e').map(t => t[1])
  return { pinned, eventId: existing.id }
}

/** Create a named follow set (kind 30000) */
export async function handleListFollowSetCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name: string
    description?: string
    pubkeys: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const tags: string[][] = [
    ['d', args.name],
  ]
  if (args.description) tags.push(['description', args.description])
  for (const pk of args.pubkeys) {
    tags.push(['p', pk])
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: LIST_KINDS.followSet,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Add or remove pubkeys from a follow set (kind 30000) */
export async function handleListFollowSetManage(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name: string
    action: 'add' | 'remove'
    pubkeys: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult; members: string[] }> {
  const existing = await fetchLatestList(pool, ctx.activeNpub, LIST_KINDS.followSet, args.name)
  let currentTags: string[][] = existing?.tags ?? [['d', args.name]]

  if (args.action === 'add') {
    for (const pk of args.pubkeys) {
      if (!currentTags.some(t => t[0] === 'p' && t[1] === pk)) {
        currentTags.push(['p', pk])
      }
    }
  } else {
    currentTags = currentTags.filter(
      t => !(t[0] === 'p' && args.pubkeys.includes(t[1])),
    )
  }

  // Ensure d-tag is preserved
  if (!currentTags.some(t => t[0] === 'd')) {
    currentTags.unshift(['d', args.name])
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: LIST_KINDS.followSet,
    created_at: Math.floor(Date.now() / 1000),
    tags: currentTags,
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  const members = currentTags.filter(t => t[0] === 'p').map(t => t[1])

  return { event, publish, members }
}

/** Read a follow set by name */
export async function handleListFollowSetRead(
  pool: RelayPool,
  npub: string,
  args: { name: string },
): Promise<{ members: string[]; description?: string; eventId?: string }> {
  const existing = await fetchLatestList(pool, npub, LIST_KINDS.followSet, args.name)
  if (!existing) return { members: [] }

  const members = existing.tags.filter(t => t[0] === 'p').map(t => t[1])
  const descTag = existing.tags.find(t => t[0] === 'description')

  return {
    members,
    description: descTag?.[1],
    eventId: existing.id,
  }
}

/** Manage bookmarks (kind 30001): add or remove event IDs, links, or a-tags */
export async function handleListBookmark(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    name?: string
    action: 'add' | 'remove'
    eventIds?: string[]
    addresses?: string[]
    urls?: string[]
    hashtags?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const dTag = args.name ?? ''
  const kind = args.name ? LIST_KINDS.bookmarkSet : LIST_KINDS.bookmarks
  const existing = await fetchLatestList(pool, ctx.activeNpub, kind, args.name ? dTag : undefined)
  let currentTags: string[][] = existing?.tags ?? []

  // For bookmark sets, ensure d-tag
  if (args.name && !currentTags.some(t => t[0] === 'd')) {
    currentTags.unshift(['d', dTag])
  }

  const toAdd: string[][] = []
  if (args.eventIds) {
    for (const id of args.eventIds) toAdd.push(['e', id])
  }
  if (args.addresses) {
    for (const addr of args.addresses) toAdd.push(['a', addr])
  }
  if (args.urls) {
    for (const url of args.urls) toAdd.push(['r', url])
  }
  if (args.hashtags) {
    for (const ht of args.hashtags) toAdd.push(['t', ht])
  }

  if (args.action === 'add') {
    for (const tag of toAdd) {
      if (!currentTags.some(t => t[0] === tag[0] && t[1] === tag[1])) {
        currentTags.push(tag)
      }
    }
  } else {
    for (const tag of toAdd) {
      currentTags = currentTags.filter(
        t => !(t[0] === tag[0] && t[1] === tag[1]),
      )
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: currentTags,
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Read bookmarks — general (kind 10003) or named set (kind 30001) */
export async function handleListBookmarkRead(
  pool: RelayPool,
  npub: string,
  args: { name?: string },
): Promise<{
  eventIds: string[]
  addresses: string[]
  urls: string[]
  hashtags: string[]
  eventId?: string
}> {
  const kind = args.name ? LIST_KINDS.bookmarkSet : LIST_KINDS.bookmarks
  const existing = await fetchLatestList(pool, npub, kind, args.name)
  if (!existing) return { eventIds: [], addresses: [], urls: [], hashtags: [] }

  return {
    eventIds: existing.tags.filter(t => t[0] === 'e').map(t => t[1]),
    addresses: existing.tags.filter(t => t[0] === 'a').map(t => t[1]),
    urls: existing.tags.filter(t => t[0] === 'r').map(t => t[1]),
    hashtags: existing.tags.filter(t => t[0] === 't').map(t => t[1]),
    eventId: existing.id,
  }
}

// ---------------------------------------------------------------------------
// Moderation filter — apply mute list to a set of events
// ---------------------------------------------------------------------------

/** Filter events against the active identity's mute list */
export async function handleModerationFilter(
  pool: RelayPool,
  npub: string,
  args: { events: Array<{ id: string; pubkey: string; content: string; tags: string[][] }>; trust?: TrustContext },
): Promise<{
  allowed: typeof args.events
  blocked: Array<{ id: string; reason: string }>
}> {
  const { entries } = await handleListMuteRead(pool, npub)

  const mutedPubkeys = new Set(entries.filter(e => e.type === 'pubkey').map(e => e.value))
  const mutedEvents = new Set(entries.filter(e => e.type === 'event').map(e => e.value))
  const mutedKeywords = entries.filter(e => e.type === 'keyword').map(e => e.value.toLowerCase())
  const mutedHashtags = new Set(entries.filter(e => e.type === 'hashtag').map(e => e.value.toLowerCase()))

  let allowed: typeof args.events = []
  const blocked: Array<{ id: string; reason: string }> = []

  for (const ev of args.events) {
    if (mutedPubkeys.has(ev.pubkey)) {
      blocked.push({ id: ev.id, reason: `muted pubkey: ${ev.pubkey}` })
      continue
    }
    if (mutedEvents.has(ev.id)) {
      blocked.push({ id: ev.id, reason: `muted event: ${ev.id}` })
      continue
    }

    const contentLower = ev.content.toLowerCase()
    const matchedKeyword = mutedKeywords.find(kw => contentLower.includes(kw))
    if (matchedKeyword) {
      blocked.push({ id: ev.id, reason: `muted keyword: ${matchedKeyword}` })
      continue
    }

    const eventHashtags = ev.tags
      .filter(t => t[0] === 't')
      .map(t => t[1].toLowerCase())
    const matchedHashtag = eventHashtags.find(ht => mutedHashtags.has(ht))
    if (matchedHashtag) {
      blocked.push({ id: ev.id, reason: `muted hashtag: ${matchedHashtag}` })
      continue
    }

    allowed.push(ev)
  }

  if (args.trust && args.trust.mode === 'strict') {
    const strictAllowed: typeof args.events = []
    for (const ev of allowed) {
      const assessment = await args.trust.assess(ev.pubkey)
      if (assessment.composite.level !== 'unknown') {
        strictAllowed.push(ev)
      } else {
        blocked.push({ id: ev.id, reason: `unknown trust level: ${ev.pubkey}` })
      }
    }
    allowed = strictAllowed
  }

  return { allowed, blocked }
}
