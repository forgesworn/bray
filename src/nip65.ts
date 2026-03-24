import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from './relay-pool.js'
import type { RelaySet } from './types.js'

/** Parse NIP-65 r-tags into read/write relay sets */
export function parseRelayTags(tags: string[][]): RelaySet {
  const read: string[] = []
  const write: string[] = []

  for (const tag of tags) {
    if (tag[0] !== 'r' || !tag[1]) continue
    const url = tag[1]
    const marker = tag[2] // 'read', 'write', or undefined (both)

    if (marker === 'read') {
      read.push(url)
    } else if (marker === 'write') {
      write.push(url)
    } else {
      // No marker means both read and write
      read.push(url)
      write.push(url)
    }
  }

  return { read, write }
}

export class Nip65Manager {
  private pool: RelayPool
  private defaults: string[]
  private cache = new Map<string, RelaySet>()

  constructor(pool: RelayPool, defaultRelays: string[]) {
    this.pool = pool
    this.defaults = defaultRelays
  }

  /** Load relay list for an identity from kind 10002 events */
  async loadForIdentity(npub: string, pubkeyHex: string): Promise<RelaySet> {
    // Return cached if available
    const cached = this.cache.get(npub)
    if (cached) return cached

    // Query default relays for kind 10002
    const events = await this.pool.query(npub, {
      kinds: [10002],
      authors: [pubkeyHex],
    })

    if (events.length === 0) {
      // Fall back to defaults
      const fallback: RelaySet = {
        read: [...this.defaults],
        write: [...this.defaults],
      }
      this.cache.set(npub, fallback)
      return fallback
    }

    // Take highest created_at (event injection defence)
    const best = events.reduce((a: NostrEvent, b: NostrEvent) =>
      b.created_at > a.created_at ? b : a
    )

    const relaySet = parseRelayTags(best.tags)
    this.cache.set(npub, relaySet)
    return relaySet
  }

  /** Get cached relay list for an identity */
  getCached(npub: string): RelaySet | undefined {
    return this.cache.get(npub)
  }
}
