import { npubEncode } from 'nostr-tools/nip19'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import {
  buildBadgeFilters,
  parseCredential,
  isCredentialExpired,
  createVouch,
  parsePolicy,
  checkPolicyCompliance,
  createPolicy,
  parseVerifier,
  createChallenge,
  SIGNET_KINDS,
} from 'signet-protocol'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { TrustAssessment } from '../trust-context.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrustContextLike {
  assess(pubkey: string): Promise<TrustAssessment>
  mode: string
}

export interface SignetBadgeResult {
  pubkey: string
  npub: string
  tier: number | null
  score: number
  summary: string
  composite: {
    level: string
    flags: string[]
  }
}

export interface SignetCredential {
  attestorPubkey: string
  tier: number
  type: string
  method: string
  profession?: string
  jurisdiction?: string
  ageRange?: string
  expiresAt?: number
  expired: boolean
}

export interface SignetPolicyCheckResult {
  pubkey: string
  npub: string
  communityId: string
  allowed: boolean
  reason?: string
  requiredTier: number
  actualTier: number | null
  requiredScore?: number
  actualScore?: number
}

export interface SignetVerifierResult {
  pubkey: string
  npub: string
  profession: string
  jurisdiction: string
  professionalBody: string
}

// ─── handleSignetBadge ────────────────────────────────────────────────────────

/** Quick "who is this?" — returns tier, score, summary, and composite trust level. */
export async function handleSignetBadge(
  trust: TrustContextLike,
  args: { pubkey: string },
): Promise<SignetBadgeResult> {
  const assessment = await trust.assess(args.pubkey)

  return {
    pubkey: args.pubkey,
    npub: npubEncode(args.pubkey),
    tier: assessment.verification.tier,
    score: assessment.verification.score,
    summary: assessment.composite.summary,
    composite: {
      level: assessment.composite.level,
      flags: assessment.composite.flags,
    },
  }
}

// ─── handleSignetVouch ────────────────────────────────────────────────────────

/** Create and publish a kind 31000 type:vouch event for another user. */
export async function handleSignetVouch(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkey: string; method?: 'in-person' | 'online'; comment?: string },
): Promise<NostrEvent> {
  const privkeyHex = Buffer.from(ctx.activePrivateKey).toString('hex')

  const event = await createVouch(privkeyHex, {
    subjectPubkey: args.pubkey,
    method: args.method ?? 'in-person',
    context: args.comment,
    voucherTier: 1,
    voucherScore: 0,
  })

  await pool.publish(ctx.activeNpub, event as unknown as NostrEvent)

  return event as unknown as NostrEvent
}

// ─── handleSignetCredentials ──────────────────────────────────────────────────

/** Query relays for kind 31000 credential events for a pubkey. */
export async function handleSignetCredentials(
  pool: RelayPool,
  callerNpub: string,
  args: { pubkey: string },
): Promise<SignetCredential[]> {
  const filters = buildBadgeFilters([args.pubkey]) as any[]
  const events: NostrEvent[] = []
  for (const filter of filters) {
    const batch = await pool.query(callerNpub, filter)
    events.push(...(batch as NostrEvent[]))
  }

  const credentials: SignetCredential[] = []

  for (const event of events) {
    const parsed = parseCredential(event as any)
    if (!parsed) continue

    const expired = isCredentialExpired(event as any)

    credentials.push({
      attestorPubkey: event.pubkey,
      tier: parsed.tier,
      type: parsed.type,
      method: parsed.method,
      profession: parsed.profession,
      jurisdiction: parsed.jurisdiction,
      ageRange: parsed.ageRange,
      expiresAt: parsed.expiresAt,
      expired,
    })
  }

  return credentials
}

// ─── handleSignetPolicyCheck ──────────────────────────────────────────────────

/** Check whether a pubkey complies with a community's Signet policy. */
export async function handleSignetPolicyCheck(
  pool: RelayPool,
  trust: TrustContextLike,
  callerNpub: string,
  args: { pubkey: string; communityId: string },
): Promise<SignetPolicyCheckResult> {
  // Fetch the community policy (kind 30078, d-tag signet:policy:<communityId>)
  const policyEvents = await pool.query(callerNpub, {
    kinds: [30078],
    '#d': [`signet:policy:${args.communityId}`],
    limit: 1,
  } as any) as NostrEvent[]

  const policyEvent = policyEvents[0]
  const policy = policyEvent ? parsePolicy(policyEvent as any) : null

  // Assess the subject's trust level
  const assessment = await trust.assess(args.pubkey)
  const tier = assessment.verification.tier
  const score = assessment.verification.score

  if (!policy) {
    return {
      pubkey: args.pubkey,
      npub: npubEncode(args.pubkey),
      communityId: args.communityId,
      allowed: false,
      reason: 'No policy found for this community',
      requiredTier: 1,
      actualTier: tier,
      actualScore: score,
    }
  }

  const result = checkPolicyCompliance(policy, tier as any ?? 1, score)

  return {
    pubkey: args.pubkey,
    npub: npubEncode(args.pubkey),
    communityId: args.communityId,
    allowed: result.allowed,
    reason: result.reason,
    requiredTier: result.requiredTier,
    actualTier: tier,
    requiredScore: result.requiredScore,
    actualScore: result.actualScore,
  }
}

// ─── handleSignetPolicySet ────────────────────────────────────────────────────

/** Sign and publish a kind 30078 community policy event. */
export async function handleSignetPolicySet(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    communityId: string
    adultMinTier?: 1 | 2 | 3 | 4
    childMinTier?: 1 | 2 | 3 | 4
    minScore?: number
    enforcement?: 'client' | 'relay' | 'both'
    description?: string
  },
): Promise<NostrEvent> {
  const privkeyHex = Buffer.from(ctx.activePrivateKey).toString('hex')

  const event = await createPolicy(privkeyHex, {
    communityId: args.communityId,
    adultMinTier: args.adultMinTier ?? 1,
    childMinTier: args.childMinTier ?? 2,
    enforcement: args.enforcement ?? 'client',
    minScore: args.minScore,
    description: args.description,
  })

  await pool.publish(ctx.activeNpub, event as unknown as NostrEvent)

  return event as unknown as NostrEvent
}

// ─── handleSignetVerifiers ────────────────────────────────────────────────────

/** Query relays for kind 31000 type:verifier events, filtered by jurisdiction/profession. */
export async function handleSignetVerifiers(
  pool: RelayPool,
  callerNpub: string,
  args: { jurisdiction?: string; profession?: string },
): Promise<SignetVerifierResult[]> {
  const events = await pool.query(callerNpub, {
    kinds: [SIGNET_KINDS.VERIFIER],
    '#type': ['verifier'],
    limit: 50,
  } as any) as NostrEvent[]

  const results: SignetVerifierResult[] = []

  for (const event of events) {
    const parsed = parseVerifier(event as any)
    if (!parsed) continue

    if (args.jurisdiction && parsed.jurisdiction !== args.jurisdiction) continue
    if (args.profession && parsed.profession !== args.profession) continue

    results.push({
      pubkey: event.pubkey,
      npub: npubEncode(event.pubkey),
      profession: parsed.profession,
      jurisdiction: parsed.jurisdiction,
      professionalBody: parsed.professionalBody,
    })
  }

  return results
}

// ─── handleSignetChallenge ────────────────────────────────────────────────────

/** Sign and publish a kind 31000 type:challenge event against a verifier. */
export async function handleSignetChallenge(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    verifierPubkey: string
    reason: 'anomalous-volume' | 'registry-mismatch' | 'fraudulent-attestation' | 'licence-revoked' | 'other'
    evidence?: string
  },
): Promise<NostrEvent> {
  const privkeyHex = Buffer.from(ctx.activePrivateKey).toString('hex')

  const event = await createChallenge(privkeyHex, {
    verifierPubkey: args.verifierPubkey,
    reason: args.reason,
    evidenceType: 'text',
    reporterTier: 1,
    evidence: args.evidence ?? '',
  })

  await pool.publish(ctx.activeNpub, event as unknown as NostrEvent)

  return event as unknown as NostrEvent
}
