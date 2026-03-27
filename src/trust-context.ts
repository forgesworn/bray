import { npubEncode } from 'nostr-tools/nip19'
import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from './context.js'
import type { RelayPool } from './relay-pool.js'
import { SignetAssessor } from './signet/assessor.js'
import { VaultResolver } from './vault/resolver.js'
import { VeilScoring } from './veil/scoring.js'
import { TrustCache } from './veil/cache.js'
import type { SignetAssessment } from './signet/assessor.js'
import type { VaultAccess } from './vault/resolver.js'
import type { TrustScoreResult } from './veil/scoring.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type TrustLevel = 'trusted' | 'known' | 'verified-stranger' | 'stranger' | 'unknown'
export type TrustMode = 'annotate' | 'strict' | 'off'

export interface TrustContextOptions {
  cacheTtl: number
  cacheMax: number
  trustMode: TrustMode
}

export interface ProximityInfo {
  distance: number          // -1 = unknown, 0 = self, 1 = direct follow, 2 = contact-of-contact, etc.
  wotScore: number
  endorsements: number
  ringEndorsements: number
  mutualFollows: boolean
}

export interface CompositeLevel {
  level: TrustLevel
  summary: string
  flags: string[]
}

export interface TrustAssessment {
  pubkey: string
  npub: string
  verification: SignetAssessment
  proximity: ProximityInfo
  access: VaultAccess
  composite: CompositeLevel
}

export interface TrustAnnotation {
  level: TrustLevel
  tier: number | null
  distance: number
  vaultTiers: string[]
  flags: string[]
}

// ─── Pure function ────────────────────────────────────────────────────────────

export function computeCompositeLevel(
  tier: number | null,
  distance: number,
  vaultTiers: string[],
): TrustLevel {
  const verified = tier !== null && tier >= 2
  const close = distance >= 0 && distance <= 2
  const inVault = vaultTiers.length > 0
  if (verified && close && inVault) return 'trusted'
  if (close || inVault) return 'known'
  if (verified) return 'verified-stranger'
  if (distance >= 0 && distance <= 3) return 'stranger'
  return 'unknown'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(level: TrustLevel, distance: number, tier: number | null, vaultTiers: string[]): string {
  switch (level) {
    case 'trusted':
      return `Verified (tier ${tier}) direct contact in vault (${vaultTiers.join(', ')})`
    case 'known':
      if (distance >= 0 && distance <= 2) return `Within ${distance} hop${distance === 1 ? '' : 's'} in follow graph`
      return `Member of vault tier${vaultTiers.length > 1 ? 's' : ''}: ${vaultTiers.join(', ')}`
    case 'verified-stranger':
      return `Signet-verified (tier ${tier}) but outside follow graph`
    case 'stranger':
      return `Within ${distance} hop${distance === 1 ? '' : 's'} — unverified`
    case 'unknown':
      return 'No trust signals found'
  }
}

/** Resolve social distance by traversing kind 3 follow graph.
 *  Returns -1 if target not found within maxHops. */
async function resolveDistance(
  pool: RelayPool,
  callerNpub: string,
  myPubkeyHex: string,
  targetPubkeyHex: string,
  maxHops = 3,
): Promise<number> {
  if (myPubkeyHex === targetPubkeyHex) return 0

  // Hop 1: fetch my kind 3 contacts
  const myContactEvents = await pool.query(callerNpub, {
    kinds: [3],
    authors: [myPubkeyHex],
    limit: 1,
  } as any)

  const hop1 = extractFollows(myContactEvents)

  if (hop1.has(targetPubkeyHex)) return 1
  if (maxHops < 2) return -1

  // Hop 2: contacts-of-contacts (sample up to 50 contacts to limit relay load)
  const hop1Slice = [...hop1].slice(0, 50)
  if (hop1Slice.length === 0) return -1

  const hop2Events = await pool.query(callerNpub, {
    kinds: [3],
    authors: hop1Slice,
    limit: hop1Slice.length,
  } as any)

  const hop2 = extractFollows(hop2Events)
  if (hop2.has(targetPubkeyHex)) return 2
  if (maxHops < 3) return -1

  // Hop 3: contacts-of-contacts-of-contacts (sample up to 50)
  const hop2Slice = [...hop2].slice(0, 50)
  if (hop2Slice.length === 0) return -1

  const hop3Events = await pool.query(callerNpub, {
    kinds: [3],
    authors: hop2Slice,
    limit: hop2Slice.length,
  } as any)

  const hop3 = extractFollows(hop3Events)
  if (hop3.has(targetPubkeyHex)) return 3

  return -1
}

function extractFollows(events: NostrEvent[]): Set<string> {
  const follows = new Set<string>()
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] === 'p' && typeof tag[1] === 'string') {
        follows.add(tag[1])
      }
    }
  }
  return follows
}

/** Check if target follows us back (mutual follow). */
async function checkMutual(
  pool: RelayPool,
  callerNpub: string,
  myPubkeyHex: string,
  targetPubkeyHex: string,
): Promise<boolean> {
  const events = await pool.query(callerNpub, {
    kinds: [3],
    authors: [targetPubkeyHex],
    limit: 1,
  } as any)
  const theirFollows = extractFollows(events)
  return theirFollows.has(myPubkeyHex)
}

// ─── TrustContext class ───────────────────────────────────────────────────────

export class TrustContext {
  private readonly ctx: IdentityContext
  private readonly pool: RelayPool
  readonly mode: TrustMode
  private readonly signet: SignetAssessor
  private readonly vault: VaultResolver
  private readonly veil: VeilScoring
  private readonly veilCache: TrustCache

  constructor(ctx: IdentityContext, pool: RelayPool, opts: TrustContextOptions) {
    this.ctx = ctx
    this.pool = pool
    this.mode = opts.trustMode
    this.signet = new SignetAssessor(pool, { ttl: opts.cacheTtl, maxEntries: opts.cacheMax })
    this.vault = new VaultResolver(pool, { ttl: opts.cacheTtl, maxEntries: opts.cacheMax })
    this.veilCache = new TrustCache({ ttl: opts.cacheTtl, maxEntries: opts.cacheMax })
    this.veil = new VeilScoring(pool, this.veilCache, ctx.activeNpub)
  }

  /** Assess trust for a target pubkey across all three dimensions in parallel. */
  async assess(targetPubkeyHex: string): Promise<TrustAssessment> {
    if (this.mode === 'off') {
      return this.emptyAssessment(targetPubkeyHex)
    }

    const myPubkeyHex = this.ctx.activePublicKeyHex
    const myNpub = this.ctx.activeNpub
    const myPrivkeyHex = Buffer.from(this.ctx.activePrivateKey).toString('hex')

    const [verification, veilResult, access, distance, mutual] = await Promise.all([
      this.signet.assess(myNpub, targetPubkeyHex),
      this.veil.scorePubkey(targetPubkeyHex),
      this.vault.resolve(myPubkeyHex, targetPubkeyHex, myPrivkeyHex),
      resolveDistance(this.pool, myNpub, myPubkeyHex, targetPubkeyHex),
      checkMutual(this.pool, myNpub, myPubkeyHex, targetPubkeyHex),
    ])

    const proximity: ProximityInfo = {
      distance,
      wotScore: veilResult.score,
      endorsements: veilResult.endorsements,
      ringEndorsements: veilResult.ringEndorsements,
      mutualFollows: mutual,
    }

    const level = computeCompositeLevel(verification.tier, distance, access.vaultTiers)
    const composite: CompositeLevel = {
      level,
      summary: buildSummary(level, distance, verification.tier, access.vaultTiers),
      flags: veilResult.flags,
    }

    return {
      pubkey: targetPubkeyHex,
      npub: npubEncode(targetPubkeyHex),
      verification,
      proximity,
      access,
      composite,
    }
  }

  /** Clear all internal caches — call after an identity switch. */
  invalidate(): void {
    this.signet.clear()
    this.vault.clear()
    this.veilCache.clear()
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private emptyAssessment(pubkey: string): TrustAssessment {
    return {
      pubkey,
      npub: npubEncode(pubkey),
      verification: { tier: null, score: 0, credentials: 0, expired: false },
      proximity: { distance: -1, wotScore: 0, endorsements: 0, ringEndorsements: 0, mutualFollows: false },
      access: { vaultTiers: [], theirVaultTiers: [], canDecrypt: false, currentEpoch: '', revoked: false },
      composite: { level: 'unknown', summary: 'Trust assessment disabled', flags: [] },
    }
  }
}

// ─── toAnnotation helper ──────────────────────────────────────────────────────

/** Produce a compact TrustAnnotation suitable for embedding in tool responses. */
export function toAnnotation(assessment: TrustAssessment): TrustAnnotation {
  return {
    level: assessment.composite.level,
    tier: assessment.verification.tier,
    distance: assessment.proximity.distance,
    vaultTiers: assessment.access.vaultTiers,
    flags: assessment.composite.flags,
  }
}
