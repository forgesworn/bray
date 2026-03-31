import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'

export interface SearchNote {
  id: string
  pubkey: string
  content: string
  createdAt: number
  hashtags: string[]
}

export interface SearchProfile {
  pubkey: string
  name?: string
  display_name?: string
  about?: string
  nip05?: string
  picture?: string
}

/** Full-text search for kind 1 notes (NIP-50). Requires relay support. */
export async function handleSearchNotes(
  pool: RelayPool,
  npub: string,
  args: { query: string; limit?: number; since?: number; relays?: string[] },
): Promise<SearchNote[]> {
  const filter: Filter = {
    kinds: [1],
    limit: args.limit ?? 50,
    ...(args.since ? { since: args.since } : {}),
  }
  ;(filter as Record<string, unknown>).search = args.query

  const events: NostrEvent[] = args.relays?.length
    ? await pool.queryDirect(args.relays, filter)
    : await pool.query(npub, filter)

  return events.map(e => ({
    id: e.id,
    pubkey: e.pubkey,
    content: e.content,
    createdAt: e.created_at,
    hashtags: e.tags.filter(t => t[0] === 't').map(t => t[1]),
  }))
}

/** Full-text search for kind 0 profiles (NIP-50). Requires relay support. */
export async function handleSearchProfiles(
  pool: RelayPool,
  npub: string,
  args: { query: string; limit?: number },
): Promise<SearchProfile[]> {
  const filter: Filter = {
    kinds: [0],
    limit: args.limit ?? 20,
  }
  ;(filter as Record<string, unknown>).search = args.query

  const events = await pool.query(npub, filter)

  // Keep only the newest kind 0 per pubkey
  const best = new Map<string, NostrEvent>()
  for (const ev of events) {
    const prev = best.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) {
      best.set(ev.pubkey, ev)
    }
  }

  const results: SearchProfile[] = []
  for (const [pubkey, ev] of best) {
    try {
      const profile = JSON.parse(ev.content)
      results.push({
        pubkey,
        name: profile.name || undefined,
        display_name: profile.display_name || undefined,
        about: profile.about || undefined,
        nip05: profile.nip05 || undefined,
        picture: profile.picture || undefined,
      })
    } catch {
      // Skip unparseable profile content
    }
  }

  return results
}

/** Fetch kind 1 notes with a specific hashtag (t-tag). Works on all relays. */
export async function handleHashtagFeed(
  pool: RelayPool,
  npub: string,
  args: { hashtag: string; limit?: number; since?: number },
): Promise<SearchNote[]> {
  const filter: Filter = {
    kinds: [1],
    '#t': [args.hashtag.toLowerCase()],
    limit: args.limit ?? 50,
    ...(args.since ? { since: args.since } : {}),
  }

  const events = await pool.query(npub, filter)

  return events.map(e => ({
    id: e.id,
    pubkey: e.pubkey,
    content: e.content,
    createdAt: e.created_at,
    hashtags: e.tags.filter(t => t[0] === 't').map(t => t[1]),
  }))
}
