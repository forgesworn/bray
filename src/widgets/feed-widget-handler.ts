/**
 * Widget handler for the social feed. Calls existing handleFeed,
 * enriches entries with profile images fetched server-side.
 */

import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import { handleFeed } from '../social/notifications.js'
import { handleSocialProfileGet } from '../social/handlers.js'
import { fetchProfileImage } from './profile-images.js'

export interface FeedWidgetEntry {
  id: string
  pubkey: string
  content: string
  createdAt: number
  authorName?: string
  authorPictureDataUri?: string
  note?: string
}

export interface FeedWidgetResult {
  entries: FeedWidgetEntry[]
  pagination: { nextSince?: number }
}

export async function handleFeedWidget(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { authors?: string[]; since?: number; limit?: number },
): Promise<FeedWidgetResult> {
  const limit = Math.min(args.limit ?? 20, 100)
  const feed = await handleFeed(ctx, pool, {
    authors: args.authors,
    since: args.since,
    limit,
  })

  // Collect unique pubkeys and batch-fetch profiles
  const uniquePubkeys = [...new Set(feed.map(e => e.pubkey))]
  const profiles = new Map<string, Record<string, unknown>>()

  for (const pk of uniquePubkeys) {
    try {
      const profile = await handleSocialProfileGet(pool, ctx.activeNpub, pk)
      profiles.set(pk, profile)
    } catch { /* skip failed profile lookups */ }
  }

  // Fetch profile images server-side
  const imageUrls = new Map<string, string>()
  for (const [pk, profile] of profiles) {
    const picture = profile.picture as string | undefined
    if (picture) imageUrls.set(pk, picture)
  }

  const imageDataUris = new Map<string, string>()
  const urlEntries = [...imageUrls.entries()]
  const fetched = await Promise.all(urlEntries.map(([, url]) => fetchProfileImage(url)))
  for (let i = 0; i < urlEntries.length; i++) {
    imageDataUris.set(urlEntries[i][0], fetched[i])
  }

  const entries: FeedWidgetEntry[] = feed.map(e => {
    const profile = profiles.get(e.pubkey)
    return {
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.createdAt,
      authorName: (profile?.display_name as string) || (profile?.name as string) || undefined,
      authorPictureDataUri: imageDataUris.get(e.pubkey),
    }
  })

  // Pagination: if we got a full page, the oldest entry's timestamp is the cursor
  const nextSince = entries.length >= limit
    ? entries[entries.length - 1]?.createdAt
    : undefined

  return { entries, pagination: { nextSince } }
}
