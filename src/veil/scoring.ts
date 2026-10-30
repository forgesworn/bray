import { parseAssertion } from 'nostr-veil/nip85'
import { verifyProof, computeCircleId } from 'nostr-veil/proof'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import type { SigningContext } from '../signing-context.js'
import type { TrustCache, TrustCacheEntry } from './cache.js'

export interface TrustScoreResult extends TrustCacheEntry {
  pubkey: string
  flags: string[]
}

export interface ScoredEvent extends NostrEvent {
  _trustScore: number
}

export interface VeilScoringOptions {
  /** Circle IDs (computeCircleId of the exact member set) whose ring proofs count. */
  trustedCircles?: string[]
  /** Hex pubkeys whose assertions and ring proofs count, as if the caller followed them. */
  trustedPublishers?: string[]
  /** How long the caller's follow list is reused, in milliseconds. Default 5 minutes. */
  followsTtl?: number
}

const DEFAULT_FOLLOWS_TTL = 300_000
const HEX64_RE = /^[0-9a-f]{64}$/

interface Follows {
  set: Set<string>
  /** Whether a follow list was found; false means only the caller is trusted. */
  found: boolean
}

interface FollowsItem {
  promise: Promise<Follows>
  storedAt: number
}

/** Key images collected for one scope (election ID), split by trust. */
interface ScopeGroup {
  trusted: Set<string>
  trustedSubjectInRing: boolean
  untrusted: Set<string>
  untrustedSubjectInRing: boolean
}

/** The scope a key image belongs to: the electionId inside the signature JSON,
 *  or the raw tag value when that cannot be read. */
function scopeOf(sigTag: string[]): string {
  const raw = sigTag[1] ?? ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      const eid = (parsed as { electionId?: unknown }).electionId
      if (typeof eid === 'string') return eid
    }
  } catch { /* fall back to the raw tag value */ }
  return raw
}

export class VeilScoring {
  private readonly trustedCircles: Set<string>
  private readonly trustedPublishers: Set<string>
  private readonly followsTtl: number
  private readonly followsCache = new Map<string, FollowsItem>()

  constructor(
    private readonly pool: RelayPool,
    private readonly cache: TrustCache,
    // Read on every query, never captured: a bunker-backed identity has no
    // npub or pubkey until the bunker has answered, the trust layer is built
    // before that, and an identity switch changes both.
    private readonly ctx: Pick<SigningContext, 'activeNpub' | 'activePublicKeyHex'>,
    opts: VeilScoringOptions = {},
  ) {
    this.trustedCircles = new Set((opts.trustedCircles ?? []).map(c => c.toLowerCase()))
    this.trustedPublishers = new Set((opts.trustedPublishers ?? []).map(p => p.toLowerCase()))
    this.followsTtl = opts.followsTtl ?? DEFAULT_FOLLOWS_TTL
  }

  /**
   * The caller's own follow list (latest kind 3) plus the caller's own pubkey.
   * Cached per caller pubkey for the configured TTL, so an identity switch
   * reads its own list.
   */
  private async follows(): Promise<Follows> {
    const npub = this.ctx.activeNpub
    // Read-only mode without a pubkey has no identity: nobody is followed and
    // the public key is never read (it throws).
    if (npub === '') return { set: new Set(), found: true }
    const self = this.ctx.activePublicKeyHex
    const hit = this.followsCache.get(self)
    if (hit && Date.now() - hit.storedAt <= this.followsTtl) return hit.promise

    const promise = this.loadFollows(npub, self)
    this.followsCache.set(self, { promise, storedAt: Date.now() })
    // A failed fetch must not be remembered for the whole TTL.
    promise.catch(() => {
      if (this.followsCache.get(self)?.promise === promise) this.followsCache.delete(self)
    })
    return promise
  }

  private async loadFollows(npub: string, self: string): Promise<Follows> {
    const events = await this.pool.query(npub, {
      authors: [self],
      kinds: [3],
      limit: 1,
    } as any)
    let latest: NostrEvent | undefined
    for (const event of events) {
      // The relay may return anything: only the caller's own list counts.
      if (event.kind !== 3 || event.pubkey !== self) continue
      if (!latest || event.created_at > latest.created_at) latest = event
    }
    const follows = new Set<string>([self])
    for (const tag of latest?.tags ?? []) {
      if (tag[0] === 'p' && typeof tag[1] === 'string' && HEX64_RE.test(tag[1])) follows.add(tag[1])
    }
    return { set: follows, found: latest !== undefined }
  }

  /** Pubkeys whose content a strict filter lets through without endorsements:
   *  the caller, the caller's follows and the configured trusted publishers. */
  async trustedAuthors(): Promise<Set<string>> {
    const follows = await this.follows()
    return new Set<string>([...follows.set, ...this.trustedPublishers])
  }

  async scorePubkey(pubkey: string): Promise<TrustScoreResult> {
    pubkey = pubkey.toLowerCase()
    // The npub is read first so a bunker identity that is not ready fails here.
    const npub = this.ctx.activeNpub
    // The result depends on who is asking (their follows), so the score cache
    // is keyed by caller as well as subject. An empty npub is the anonymous
    // read-only caller, whose public key must not be read.
    const cacheKey = npub === '' ? `anon:${pubkey}` : `${this.ctx.activePublicKeyHex}:${pubkey}`

    // 1. Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return { pubkey, ...cached, flags: [] }
    }

    // 2. Query kind 30382 (NIP-85) assertions from relays
    const events = await this.pool.query(npub, {
      kinds: [30382],
      '#d': [pubkey],
    } as any)

    // 3. If no events, return score 0 with 'no endorsements found' flag
    if (events.length === 0) {
      const entry: TrustCacheEntry = {
        score: 0, endorsements: 0, ringEndorsements: 0,
        untrustedEndorsements: 0, untrustedRingEndorsements: 0,
      }
      this.cache.set(cacheKey, entry)
      return { pubkey, ...entry, flags: ['no endorsements found'] }
    }

    const followList = await this.follows()
    const follows = followList.set
    const flags: string[] = []
    const addFlag = (flag: string): void => {
      if (!flags.includes(flag)) flags.push(flag)
    }
    // Without a follow list only the caller is trusted, so say so rather than
    // let follows' endorsements look untrusted for no visible reason.
    if (!followList.found) addFlag('follow list not found')

    // One endorsement per author, and one ring endorsement per key image: the
    // same assertion or ring proof published several times counts once.
    const trustedEndorsers = new Set<string>()
    const untrustedEndorsers = new Set<string>()
    const groups = new Map<string, ScopeGroup>()
    const groupFor = (scope: string): ScopeGroup => {
      let group = groups.get(scope)
      if (!group) {
        group = { trusted: new Set(), trustedSubjectInRing: false, untrusted: new Set(), untrustedSubjectInRing: false }
        groups.set(scope, group)
      }
      return group
    }

    // 4. Parse assertions and ring proofs
    for (const event of events) {
      // The relay may return anything; count only kind 30382 assertions about
      // this pubkey, so a valid proof about someone else adds nothing.
      if (event.kind !== 30382) continue
      const parsed = parseAssertion(event)
      if (parsed.subject !== pubkey) continue

      const sigTags = event.tags.filter((t: string[]) => t[0] === 'veil-sig')

      if (sigTags.length === 0) {
        // Plain assertion. Vouching for yourself proves nothing.
        if (event.pubkey === pubkey) {
          addFlag('self-endorsement ignored')
        } else if (follows.has(event.pubkey) || this.trustedPublishers.has(event.pubkey)) {
          trustedEndorsers.add(event.pubkey)
        } else {
          untrustedEndorsers.add(event.pubkey)
        }
        continue
      }

      // 5. Ring proof
      const verification = verifyProof(event, { expectedKind: 30382 })
      if (!verification.valid) {
        addFlag('ring proof invalid')
        continue
      }

      const ringTag = event.tags.find((t: string[]) => t[0] === 'veil-ring')
      const members = ringTag ? ringTag.slice(1) : []
      const trusted = this.isTrustedRing(event, members, follows)
      const subjectInRing = members.includes(pubkey)

      for (const tag of sigTags) {
        if (typeof tag[2] !== 'string') continue
        const group = groupFor(scopeOf(tag))
        if (trusted) {
          group.trusted.add(tag[2])
          if (subjectInRing) group.trustedSubjectInRing = true
        } else {
          group.untrusted.add(tag[2])
          if (subjectInRing) group.untrustedSubjectInRing = true
        }
      }
      addFlag(trusted ? 'ring proof verified' : 'ring proof untrusted')
    }

    // 6. Count key images per scope. The ring signature hides which member
    // signed, so when the subject is in a ring one signature per scope may be
    // their own (key images stop a member signing twice per scope).
    const trustedImages = new Set<string>()
    for (const group of groups.values()) for (const image of group.trusted) trustedImages.add(image)

    let ringEndorsements = 0
    let untrustedRingEndorsements = 0
    for (const group of groups.values()) {
      const trustedCount = group.trusted.size
      if (group.trustedSubjectInRing) {
        ringEndorsements += Math.max(0, trustedCount - 1)
        addFlag('subject is a ring member')
      } else {
        ringEndorsements += trustedCount
      }
      // A key image already counted as trusted is not also reported as untrusted.
      let untrustedCount = 0
      for (const image of group.untrusted) if (!trustedImages.has(image)) untrustedCount++
      untrustedRingEndorsements += group.untrustedSubjectInRing ? Math.max(0, untrustedCount - 1) : untrustedCount
    }

    const endorsements = trustedEndorsers.size
    const untrustedEndorsements = untrustedEndorsers.size

    // 7. Score from trusted counts only: endorsements + ring endorsements weighted higher
    const score = endorsements + (ringEndorsements * 3)

    // 8. Cache result and return
    const entry: TrustCacheEntry = {
      score, endorsements, ringEndorsements, untrustedEndorsements, untrustedRingEndorsements,
    }
    this.cache.set(cacheKey, entry)

    return { pubkey, ...entry, flags }
  }

  /**
   * A ring proof counts when its exact circle is configured, its publisher is
   * a trusted publisher, or every member is in the caller's follows. A
   * fraction of trusted members is not enough: an attacker inside an otherwise
   * trusted ring can sign, and the proof cannot tell them apart.
   */
  private isTrustedRing(event: NostrEvent, members: string[], follows: Set<string>): boolean {
    if (this.trustedCircles.has(computeCircleId(members))) return true
    if (this.trustedPublishers.has(event.pubkey)) return true
    return members.length > 0 && members.every(m => follows.has(m))
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
