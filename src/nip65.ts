import { decode } from 'nostr-tools/nip19'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from './relay-pool.js'
import type { RelaySet } from './types.js'

/** Validate relay URL scheme — must be wss:// or ws:// */
function isValidRelayUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url)
}

/** Parse NIP-65 r-tags into read/write relay sets, filtering invalid URLs */
export function parseRelayTags(tags: string[][]): RelaySet {
  const read: string[] = []
  const write: string[] = []

  for (const tag of tags) {
    if (tag[0] !== 'r' || !tag[1]) continue
    const url = tag[1]
    if (!isValidRelayUrl(url)) continue // reject non-wss/ws URLs
    const marker = tag[2]

    if (marker === 'read') {
      read.push(url)
    } else if (marker === 'write') {
      write.push(url)
    } else {
      read.push(url)
      write.push(url)
    }
  }

  return { read, write }
}

export class Nip65Manager {
  private pool: RelayPool
  private defaults: string[]
  private cache = new Map<string, { relays: RelaySet; fetchedAt: number }>()
  private readonly TTL = 3600_000 // 1 hour

  constructor(pool: RelayPool, defaultRelays: string[]) {
    this.pool = pool
    this.defaults = defaultRelays
  }

  /** Load relay list for an identity from kind 10002 events */
  async loadForIdentity(npub: string, pubkeyHex?: string): Promise<RelaySet> {
    // Return cached if still fresh
    const cached = this.cache.get(npub)
    if (cached && Date.now() - cached.fetchedAt < this.TTL) return cached.relays

    const hex = pubkeyHex ?? decode(npub).data as string

    const events = await this.pool.query(npub, {
      kinds: [10002],
      authors: [hex],
    })

    // Filter to verified events from the expected author
    const verified = events.filter(e =>
      e.pubkey === hex && verifyEvent(e)
    )

    if (verified.length === 0) {
      const fallback: RelaySet = {
        read: [...this.defaults],
        write: [...this.defaults],
      }
      this.cache.set(npub, { relays: fallback, fetchedAt: Date.now() })
      return fallback
    }

    // Take highest created_at from verified events
    const best = verified.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )

    const relaySet = parseRelayTags(best.tags)
    this.cache.set(npub, { relays: relaySet, fetchedAt: Date.now() })
    return relaySet
  }

  /** Get cached relay list for an identity */
  getCached(npub: string): RelaySet | undefined {
    return this.cache.get(npub)?.relays
  }
}
