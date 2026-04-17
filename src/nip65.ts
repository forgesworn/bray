import { decode } from 'nostr-tools/nip19'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from './relay-pool.js'
import type { RelaySet } from './types.js'
import { isOnionUrl, validatePublicUrl } from './validation.js'

// NIP-65 tag-list bounds. Keeps a compromised or hostile kind-10002 publisher
// from flooding the pool with thousands of huge URLs or with loopback/metadata
// addresses that would give them SSRF on a non-Tor deployment.
const MAX_RELAY_TAGS = 50
const MAX_URL_LENGTH = 512

/**
 * Validate relay URL scheme — must be wss:// or ws://. Plaintext ws:// is only
 * accepted when host is a Tor onion service (.onion provides its own encryption);
 * everything else must be wss:// to avoid relaying signed events in cleartext.
 */
function isValidRelayUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return false
  if (!/^wss?:\/\//i.test(url)) return false
  if (/^ws:\/\//i.test(url) && !isOnionUrl(url)) return false
  try {
    validatePublicUrl(url)
  } catch {
    return false
  }
  return true
}

/**
 * Parse NIP-65 r-tags into read/write relay sets. Silently drops invalid,
 * private-network, oversized, or excess entries to preserve fallback behaviour
 * when a NIP-65 event is partially malformed.
 */
export function parseRelayTags(tags: string[][]): RelaySet {
  const read: string[] = []
  const write: string[] = []

  let processed = 0
  for (const tag of tags) {
    if (processed >= MAX_RELAY_TAGS) break
    if (tag[0] !== 'r' || !tag[1]) continue
    const url = tag[1]
    if (!isValidRelayUrl(url)) continue
    processed++
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
      // Fail-open: no signed kind-10002 from this author means we cannot
      // resolve their declared outbox. Fall back to default relays so the
      // call doesn't fail outright, but warn loudly so operators notice when
      // recipient-targeted publishes are silently going to defaults.
      console.warn(
        `[nip65] no verified relay list for ${npub} — falling back to default relays. ` +
        `Recipient may not see this content if their outbox differs.`,
      )
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
