import { parseAssertion } from 'nostr-veil/nip85'
import { verifyProof } from 'nostr-veil/proof'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import type { TrustCache, TrustCacheEntry } from './cache.js'

export interface TrustScoreResult extends TrustCacheEntry {
  pubkey: string
  flags: string[]
}

export interface ScoredEvent extends NostrEvent {
  _trustScore: number
}

export class VeilScoring {
  constructor(
    private readonly pool: RelayPool,
    private readonly cache: TrustCache,
    // A string is captured now; a function is read on every query, which is
    // what a bunker-backed identity needs: its npub is not known until the
    // bunker has answered, and the trust layer is built before that.
    private readonly npub: string | (() => string),
  ) {}

  private get selfNpub(): string {
    return typeof this.npub === 'function' ? this.npub() : this.npub
  }

  async scorePubkey(pubkey: string): Promise<TrustScoreResult> {
    // 1. Check cache first
    const cached = this.cache.get(pubkey)
    if (cached) {
      return { pubkey, ...cached, flags: [] }
    }

    // 2. Query kind 30382 (NIP-85) assertions from relays
    const events = await this.pool.query(this.selfNpub, {
      kinds: [30382],
      '#d': [pubkey],
    } as any)

    // 3. If no events, return score 0 with 'no endorsements found' flag
    if (events.length === 0) {
      const entry: TrustCacheEntry = { score: 0, endorsements: 0, ringEndorsements: 0 }
      this.cache.set(pubkey, entry)
      return { pubkey, ...entry, flags: ['no endorsements found'] }
    }

    const flags: string[] = []
    // One endorsement per author, and one ring endorsement per key image: the
    // same assertion or ring proof published several times counts once. This
    // stops replays, not Sybils: a key image is per circle scope and subject,
    // so one key that joins several circles (rings need no consent) still
    // counts once per circle. Weighting rings by trusted circles would need an
    // allowlist of circles or publishers.
    const endorsers = new Set<string>()
    const ringKeyImages = new Set<string>()

    // 4. Parse assertions and count endorsements
    for (const event of events) {
      // The relay may return anything; count only kind 30382 assertions about
      // this pubkey, so a valid proof about someone else adds nothing.
      if (event.kind !== 30382) continue
      const parsed = parseAssertion(event)
      if (parsed.subject !== pubkey) continue
      endorsers.add(event.pubkey)

      // 5. Check for veil-sig tags and verify ring proofs
      const hasVeilSig = event.tags.some((t: string[]) => t[0] === 'veil-sig')
      if (hasVeilSig) {
        const verification = verifyProof(event, { expectedKind: 30382 })
        if (verification.valid) {
          for (const tag of event.tags) {
            if (tag[0] === 'veil-sig' && typeof tag[2] === 'string') ringKeyImages.add(tag[2])
          }
          if (!flags.includes('ring proof verified')) {
            flags.push('ring proof verified')
          }
        } else {
          if (!flags.includes('ring proof invalid')) {
            flags.push('ring proof invalid')
          }
        }
      }
    }

    const endorsements = endorsers.size
    const ringEndorsements = ringKeyImages.size

    // 6. Compute score: endorsements + ring endorsements weighted higher
    const score = endorsements + (ringEndorsements * 3)

    // 7. Cache result and return
    const entry: TrustCacheEntry = { score, endorsements, ringEndorsements }
    this.cache.set(pubkey, entry)

    return { pubkey, score, endorsements, ringEndorsements, flags }
  }

  async scoreEvents(events: NostrEvent[]): Promise<ScoredEvent[]> {
    // 1. Get unique authors
    const uniqueAuthors = [...new Set(events.map(e => e.pubkey))]

    // 2. Score each author (uses cache)
    const scoreMap = new Map<string, number>()
    for (const author of uniqueAuthors) {
      const result = await this.scorePubkey(author)
      scoreMap.set(author, result.score)
    }

    // 3. Return events annotated with _trustScore
    return events.map(event => ({
      ...event,
      _trustScore: scoreMap.get(event.pubkey) ?? 0,
    }))
  }
}
