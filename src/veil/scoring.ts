import { buildTrustGraph, computeTrustRank } from 'nostr-veil/graph'
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
    private readonly npub: string, // Captured at call time — create new instance per tool call
  ) {}

  async scorePubkey(pubkey: string): Promise<TrustScoreResult> {
    // 1. Check cache first
    const cached = this.cache.get(pubkey)
    if (cached) {
      return { pubkey, ...cached, flags: [] }
    }

    // 2. Query kind 30382 (NIP-85) assertions from relays
    const events = await this.pool.query(this.npub, {
      kinds: [30382],
      '#d': [pubkey],
    } as any)

    // 3. If no events, return score 0 with 'no endorsements found' flag
    if (events.length === 0) {
      const entry: TrustCacheEntry = { score: 0, endorsements: 0, ringEndorsements: 0 }
      this.cache.set(pubkey, entry)
      return { pubkey, ...entry, flags: ['no endorsements found'] }
    }

    // 4. Build trust graph via buildTrustGraph + computeTrustRank
    const graph = buildTrustGraph(events as any[])
    const ranks = computeTrustRank(graph)

    const flags: string[] = []

    // 5. Check for veil-sig tags and verify ring proofs via verifyProof
    for (const event of events) {
      const hasVeilSig = event.tags.some(t => t[0] === 'veil-sig')
      if (hasVeilSig) {
        const verification = verifyProof(event)
        if (verification.valid) {
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

    // Find rank entry for the target pubkey
    const rankEntry = ranks.find(r => r.pubkey === pubkey)
    const score = rankEntry?.rank ?? 0
    const endorsements = rankEntry?.endorsements ?? 0
    const ringEndorsements = rankEntry?.ringEndorsements ?? 0

    // 6. Cache result and return
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
