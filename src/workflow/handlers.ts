import { npubEncode } from 'nostr-tools/nip19'
import { parseAttestation, attestationFilter } from 'nostr-attestations'
import { verifyProof } from 'nostr-veil/proof'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { ProofVerification } from 'nostr-veil/proof'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { VeilScoring } from '../veil/scoring.js'
import type { TrustContext, TrustAssessment } from '../trust-context.js'

// ---------------------------------------------------------------------------
// 1. trust-score
// ---------------------------------------------------------------------------

export interface TrustScoreResponse {
  pubkey: string
  npub: string
  verification?: TrustAssessment['verification']
  proximity?: TrustAssessment['proximity']
  access?: TrustAssessment['access']
  composite?: TrustAssessment['composite']
  // Legacy VeilScoring fields (kept for backwards compatibility)
  score: number
  endorsements: number
  ringEndorsements: number
  attestations: Array<{ type: string; attestor: string; content: string; expires?: string }>
  socialDistance: number
  flags: string[]
}

export async function handleTrustScore(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { pubkey: string; depth?: number },
  trust?: TrustContext,
): Promise<TrustScoreResponse> {
  const maxDepth = Math.min(args.depth ?? 2, 3)

  // 1. WoT score via scoring module (always run for backwards compatibility)
  const wot = await scoring.scorePubkey(args.pubkey)

  // 2. Query kind 31000 attestations about this pubkey
  const attFilter = attestationFilter({ subject: args.pubkey }) as unknown as Filter
  const attEvents = await pool.query(ctx.activeNpub, attFilter)

  const attestations: TrustScoreResponse['attestations'] = []
  for (const ev of attEvents) {
    const parsed = parseAttestation(ev)
    if (!parsed) continue
    attestations.push({
      type: parsed.type,
      attestor: parsed.pubkey,
      content: parsed.summary ?? parsed.content,
      expires: parsed.expiration ? new Date(parsed.expiration * 1000).toISOString() : undefined,
    })
  }

  // 3. Social distance via follow graph traversal
  const socialDistance = await computeSocialDistance(ctx, pool, args.pubkey, maxDepth)

  // 4. Full three-dimensional assessment via TrustContext (if available)
  let assessment: TrustAssessment | undefined
  if (trust) {
    assessment = await trust.assess(args.pubkey)
  }

  return {
    pubkey: args.pubkey,
    npub: npubEncode(args.pubkey),
    ...(assessment && {
      verification: assessment.verification,
      proximity: assessment.proximity,
      access: assessment.access,
      composite: assessment.composite,
    }),
    score: wot.score,
    endorsements: wot.endorsements,
    ringEndorsements: wot.ringEndorsements,
    attestations,
    socialDistance,
    flags: wot.flags,
  }
}

/** Traverse kind 3 follow graph to find hop distance to a target pubkey */
async function computeSocialDistance(
  ctx: IdentityContext,
  pool: RelayPool,
  targetPubkey: string,
  maxDepth: number,
): Promise<number> {
  const myHex = ctx.activePublicKeyHex

  if (myHex === targetPubkey) return 0

  // Hop 1: my contacts
  const myContactEvents = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [myHex],
  })

  const myContacts = extractContactPubkeys(myContactEvents)

  if (myContacts.has(targetPubkey)) return 1
  if (maxDepth < 2) return -1

  // Hop 2: contacts-of-contacts (cap at 500 pubkeys)
  const contactBatch = [...myContacts].slice(0, 500)
  if (contactBatch.length === 0) return -1

  const hop2Events = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: contactBatch,
  })

  for (const ev of hop2Events) {
    const contacts = ev.tags.filter(t => t[0] === 'p' && t[1]).map(t => t[1])
    if (contacts.includes(targetPubkey)) return 2
  }

  return -1
}

/** Extract unique contact pubkeys from kind 3 events */
function extractContactPubkeys(events: NostrEvent[]): Set<string> {
  const pubkeys = new Set<string>()
  if (events.length === 0) return pubkeys

  // Take the newest kind 3
  const best = events.reduce((a, b) => b.created_at > a.created_at ? b : a)
  for (const tag of best.tags) {
    if (tag[0] === 'p' && tag[1]) pubkeys.add(tag[1])
  }
  return pubkeys
}

// ---------------------------------------------------------------------------
// 2. feed-discover
// ---------------------------------------------------------------------------

export interface FeedSuggestion {
  pubkey: string
  npub: string
  name?: string
  nip05?: string
  trustScore: number
  mutualFollows: number
  reason: string
}

export async function handleFeedDiscover(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { strategy?: 'trust-adjacent' | 'topic' | 'active'; limit?: number; query?: string },
  trust?: TrustContext,
): Promise<FeedSuggestion[]> {
  const strategy = args.strategy ?? 'trust-adjacent'
  const limit = args.limit ?? 20

  if (strategy === 'topic') {
    return discoverByTopic(ctx, pool, scoring, args.query ?? '', limit, trust)
  }

  // trust-adjacent and active share the same initial logic
  const candidates = await discoverTrustAdjacent(ctx, pool, scoring, limit, strategy === 'active', trust)
  return candidates
}

async function discoverTrustAdjacent(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  limit: number,
  activeOnly: boolean,
  trust?: TrustContext,
): Promise<FeedSuggestion[]> {
  const myHex = ctx.activePublicKeyHex

  // 1. Get my kind 3 contacts
  const myContactEvents = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [myHex],
  })
  const myContacts = extractContactPubkeys(myContactEvents)
  if (myContacts.size === 0) return []

  // 2. Get contacts-of-contacts (cap at 200 follows)
  const contactBatch = [...myContacts].slice(0, 200)
  const cocEvents = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: contactBatch,
  })

  // 3. Find pubkeys they follow that I don't
  const candidateMap = new Map<string, number>() // pubkey -> mutual follow count
  for (const ev of cocEvents) {
    const contacts = ev.tags.filter(t => t[0] === 'p' && t[1]).map(t => t[1])
    for (const pk of contacts) {
      if (pk === myHex || myContacts.has(pk)) continue
      candidateMap.set(pk, (candidateMap.get(pk) ?? 0) + 1)
    }
  }

  if (candidateMap.size === 0) return []

  // 4. If active strategy, filter to those with recent posts
  let filteredCandidates = [...candidateMap.entries()]

  if (activeOnly) {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400
    const candidatePubkeys = filteredCandidates.map(([pk]) => pk).slice(0, 200)
    const recentPosts = await pool.query(ctx.activeNpub, {
      kinds: [1],
      authors: candidatePubkeys,
      since: sevenDaysAgo,
      limit: 2000,
    })

    // Count posts per author
    const postCounts = new Map<string, number>()
    for (const ev of recentPosts) {
      postCounts.set(ev.pubkey, (postCounts.get(ev.pubkey) ?? 0) + 1)
    }

    filteredCandidates = filteredCandidates.filter(([pk]) => (postCounts.get(pk) ?? 0) >= 5)
  }

  // 5. Score each candidate
  const scored: FeedSuggestion[] = []
  // Take top candidates by mutual follows to limit scoring calls
  filteredCandidates.sort((a, b) => b[1] - a[1])
  const toScore = filteredCandidates.slice(0, limit * 2)

  // Batch-fetch profiles for enrichment
  const profilePubkeys = toScore.map(([pk]) => pk)
  const profiles = await batchFetchProfiles(pool, ctx.activeNpub, profilePubkeys)

  for (const [pk, mutualFollows] of toScore) {
    const wot = await scoring.scorePubkey(pk)
    const profile = profiles.get(pk)

    // Signet ranking boost: Tier 3+ adds +30 to the trust score for sorting
    let signetBoost = 0
    if (trust) {
      const assessment = await trust.assess(pk)
      const tier = assessment.verification.tier
      if (tier !== null && tier >= 3) signetBoost = 30
    }

    scored.push({
      pubkey: pk,
      npub: npubEncode(pk),
      name: profile?.name as string | undefined,
      nip05: profile?.nip05 as string | undefined,
      trustScore: wot.score + signetBoost,
      mutualFollows,
      reason: activeOnly ? 'active and trusted in your network' : 'followed by people you trust',
    })
  }

  // 6. Sort by trust score descending, return top N
  scored.sort((a, b) => b.trustScore - a.trustScore)
  return scored.slice(0, limit)
}

async function discoverByTopic(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  query: string,
  limit: number,
  trust?: TrustContext,
): Promise<FeedSuggestion[]> {
  if (!query) return []

  // Search kind 1 events by t-tag
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1],
    '#t': [query.toLowerCase()],
    limit: 200,
  } as any)

  // Unique authors
  const authorSet = new Map<string, number>()
  for (const ev of events) {
    authorSet.set(ev.pubkey, (authorSet.get(ev.pubkey) ?? 0) + 1)
  }

  const scored: FeedSuggestion[] = []
  const profilePubkeys = [...authorSet.keys()].slice(0, limit * 2)
  const profiles = await batchFetchProfiles(pool, ctx.activeNpub, profilePubkeys)

  for (const [pk, count] of authorSet) {
    const wot = await scoring.scorePubkey(pk)
    const profile = profiles.get(pk)

    // Signet ranking boost: Tier 3+ adds +30 to the trust score for sorting
    let signetBoost = 0
    if (trust) {
      const assessment = await trust.assess(pk)
      const tier = assessment.verification.tier
      if (tier !== null && tier >= 3) signetBoost = 30
    }

    scored.push({
      pubkey: pk,
      npub: npubEncode(pk),
      name: profile?.name as string | undefined,
      nip05: profile?.nip05 as string | undefined,
      trustScore: wot.score + signetBoost,
      mutualFollows: 0,
      reason: `${count} post${count > 1 ? 's' : ''} tagged #${query}`,
    })
  }

  scored.sort((a, b) => b.trustScore - a.trustScore)
  return scored.slice(0, limit)
}

/** Batch-fetch kind 0 profiles, returning the newest per pubkey */
async function batchFetchProfiles(
  pool: RelayPool,
  npub: string,
  pubkeys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  if (pubkeys.length === 0) return new Map()

  const events = await pool.query(npub, {
    kinds: [0],
    authors: pubkeys,
  })

  const best = new Map<string, NostrEvent>()
  for (const ev of events) {
    const prev = best.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) {
      best.set(ev.pubkey, ev)
    }
  }

  const profiles = new Map<string, Record<string, unknown>>()
  for (const [pk, ev] of best) {
    try { profiles.set(pk, JSON.parse(ev.content)) } catch { /* skip */ }
  }
  return profiles
}

// ---------------------------------------------------------------------------
// 3. verify-person
// ---------------------------------------------------------------------------

export interface VerificationResult {
  pubkey: string
  npub: string
  name?: string
  nip05: { verified: boolean; handle?: string }
  trustScore: number
  signetTier?: number | null
  signetScore?: number
  attestations: Array<{ type: string; by: string; content: string }>
  linkageProofs: Array<{ mode: string; linkedTo: string }>
  ringEndorsements: Array<{ circleSize: number; threshold: number; verified: boolean }>
  spokenChallenge?: { token: string; expiresIn: string; counter: number }
  confidence: 'high' | 'medium' | 'low' | 'unknown'
}

export async function handleVerifyPerson(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { pubkey: string; method?: 'quick' | 'full' },
  trust?: TrustContext,
): Promise<VerificationResult> {
  const method = args.method ?? 'quick'

  // Trust score
  const wot = await scoring.scorePubkey(args.pubkey)

  // Signet assessment (if TrustContext available)
  let signetTier: number | null | undefined
  let signetScore: number | undefined
  if (trust) {
    const assessment = await trust.assess(args.pubkey)
    signetTier = assessment.verification.tier
    signetScore = assessment.verification.score
  }

  // Profile and NIP-05
  const profileEvents = await pool.query(ctx.activeNpub, {
    kinds: [0],
    authors: [args.pubkey],
  })
  let name: string | undefined
  let nip05Handle: string | undefined
  let nip05Verified = false

  if (profileEvents.length > 0) {
    const best = profileEvents.reduce((a, b) => b.created_at > a.created_at ? b : a)
    try {
      const profile = JSON.parse(best.content)
      name = profile.name ?? profile.display_name
      nip05Handle = profile.nip05
    } catch { /* unparseable */ }
  }

  if (nip05Handle) {
    nip05Verified = await verifyNip05(args.pubkey, nip05Handle)
  }

  // Attestations
  const attFilter = attestationFilter({ subject: args.pubkey }) as unknown as Filter
  const attEvents = await pool.query(ctx.activeNpub, attFilter)

  const attestations: VerificationResult['attestations'] = []
  for (const ev of attEvents) {
    const parsed = parseAttestation(ev)
    if (!parsed || parsed.revoked) continue
    attestations.push({
      type: parsed.type,
      by: parsed.pubkey,
      content: parsed.summary ?? parsed.content,
    })
  }

  // Linkage proofs (kind 30078 events from the pubkey)
  const proofEvents = await pool.query(ctx.activeNpub, {
    kinds: [30078],
    authors: [args.pubkey],
  })

  const linkageProofs: VerificationResult['linkageProofs'] = []
  for (const ev of proofEvents) {
    const modeTag = ev.tags.find(t => t[0] === 'proof-mode')
    const rootTag = ev.tags.find(t => t[0] === 'master-pubkey' || t[0] === 'tree-root')
    if (rootTag) {
      linkageProofs.push({
        mode: modeTag?.[1] ?? 'unknown',
        linkedTo: rootTag[1],
      })
    }
  }

  // Ring endorsements and spoken challenge (full mode only)
  const ringEndorsements: VerificationResult['ringEndorsements'] = []
  let spokenChallenge: VerificationResult['spokenChallenge'] | undefined

  if (method === 'full') {
    // Verify ring endorsement proofs
    for (const ev of attEvents) {
      const hasVeilSig = ev.tags.some(t => t[0] === 'veil-sig')
      if (hasVeilSig) {
        const verification: ProofVerification = verifyProof(ev)
        ringEndorsements.push({
          circleSize: verification.circleSize,
          threshold: verification.threshold,
          verified: verification.valid,
        })
      }
    }

    // Generate spoken challenge
    try {
      const { getConversationKey } = await import('nostr-tools/nip44')
      const sharedSecret = getConversationKey(ctx.activePrivateKey, args.pubkey)
      const { deriveToken } = await import('spoken-token')
      const counter = Math.floor(Date.now() / 300_000)
      const token = deriveToken(
        Buffer.from(sharedSecret).toString('hex'),
        'verify-person',
        counter,
        { format: 'pin', digits: 6 },
      )
      spokenChallenge = { token, expiresIn: '5 minutes', counter }
    } catch { /* spoken-token or nip44 unavailable */ }
  }

  // Confidence
  const confidence = computeConfidence(wot.score, attestations.length, nip05Verified, signetTier)

  return {
    pubkey: args.pubkey,
    npub: npubEncode(args.pubkey),
    name,
    nip05: { verified: nip05Verified, handle: nip05Handle },
    trustScore: wot.score,
    ...(signetTier !== undefined && { signetTier }),
    ...(signetScore !== undefined && { signetScore }),
    attestations,
    linkageProofs,
    ringEndorsements,
    spokenChallenge,
    confidence,
  }
}

function computeConfidence(
  score: number,
  attestationCount: number,
  nip05Verified: boolean,
  signetTier?: number | null,
): 'high' | 'medium' | 'low' | 'unknown' {
  // Tier 3+ signet verification counts as high confidence on its own
  if (signetTier !== null && signetTier !== undefined && signetTier >= 3) return 'high'
  if (score >= 50 && attestationCount >= 1 && nip05Verified) return 'high'
  if (score >= 20 || attestationCount >= 1 || nip05Verified) return 'medium'
  if (score >= 1) return 'low'
  return 'unknown'
}

/** Verify NIP-05 identifier against a pubkey */
async function verifyNip05(pubkeyHex: string, nip05: string): Promise<boolean> {
  try {
    const [localPart, domain] = nip05.split('@')
    if (!localPart || !domain) return false

    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(localPart)}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!resp.ok) return false

    const json = await resp.json() as { names?: Record<string, string> }
    return json.names?.[localPart] === pubkeyHex
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 4. identity-setup
// ---------------------------------------------------------------------------

export interface IdentitySetupPreview {
  confirmed: false
  masterNpub: string
  personas: Array<{ name: string; index: number; npub: string }>
  shamirConfig?: { shares: number; threshold: number }
  message: string
}

export interface IdentitySetupResult {
  confirmed: true
  masterNpub: string
  personas: Array<{ name: string; index: number; npub: string }>
  shardFiles?: string[]
  relaysConfigured: boolean
}

export async function handleIdentitySetup(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    personas?: string[]
    shamirThreshold?: { shares: number; threshold: number }
    relays?: string[]
    confirm?: boolean
    _shardDir?: string
  },
): Promise<IdentitySetupPreview | IdentitySetupResult> {
  const personaNames = args.personas ?? ['social', 'commerce']
  const masterNpub = ctx.activeNpub

  // Derive each persona
  const personas = personaNames.map((name, index) => {
    const identity = ctx.derive(name, index)
    return { name, index, npub: identity.npub }
  })

  // Preview mode — no side effects
  if (!args.confirm) {
    return {
      confirmed: false,
      masterNpub,
      personas,
      shamirConfig: args.shamirThreshold,
      message: 'Review the identities above. Set confirm: true to create Shamir backup and configure relays.',
    }
  }

  // Confirmed — create Shamir shards
  let shardFiles: string[] | undefined
  if (args.shamirThreshold) {
    const { handleBackupShamir } = await import('../identity/shamir.js')
    const outputDir = args._shardDir ?? `${process.env.HOME ?? '/tmp'}/.bray/shards`

    // Ensure output directory exists
    const { mkdirSync } = await import('node:fs')
    mkdirSync(outputDir, { recursive: true, mode: 0o700 })

    const result = handleBackupShamir({
      secret: ctx.activePrivateKey,
      threshold: args.shamirThreshold.threshold,
      shares: args.shamirThreshold.shares,
      outputDir,
    })
    shardFiles = result.files
  }

  // Configure relays for each persona
  let relaysConfigured = false
  if (args.relays && args.relays.length > 0) {
    for (const persona of personas) {
      ctx.switch(persona.name, persona.index)
      const sign = ctx.getSigningFunction()
      const tags = args.relays.map(url => ['r', url])
      const event = await sign({
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
      })
      await pool.publish(ctx.activeNpub, event)
      pool.reconfigure(ctx.activeNpub, {
        read: [...args.relays],
        write: [...args.relays],
      })
    }
    relaysConfigured = true
    // Switch back to master
    ctx.switch('master')
  }

  return {
    confirmed: true,
    masterNpub,
    personas,
    shardFiles,
    relaysConfigured,
  }
}

// ---------------------------------------------------------------------------
// 5. identity-recover
// ---------------------------------------------------------------------------

export interface IdentityRecoverResult {
  masterNpub: string
  recovered: boolean
  relaysConfigured: boolean
}

export async function handleIdentityRecover(
  pool: RelayPool,
  args: { shardPaths: string[]; newRelays?: string[] },
): Promise<IdentityRecoverResult> {
  const { readFileSync } = await import('node:fs')
  const { wordsToShare, reconstructSecret } = await import('@forgesworn/shamir-words')

  // 1. Read shard files
  const shares = args.shardPaths.map(filePath => {
    const content = readFileSync(filePath, 'utf-8').trim()
    const words = content.split(' ')
    return wordsToShare(words)
  })

  if (shares.length === 0) {
    throw new Error('No shard files provided')
  }

  // Threshold is encoded in each share
  const threshold = shares[0].threshold
  if (shares.length < threshold) {
    throw new Error(`Insufficient shards: have ${shares.length}, need ${threshold}`)
  }

  // 2. Reconstruct secret
  const secret = reconstructSecret(shares, threshold)

  // 3. Create new context from recovered secret
  const { IdentityContext } = await import('../context.js')
  const hexSecret = Buffer.from(secret).toString('hex')
  const ctx = new IdentityContext(hexSecret, 'hex')
  const masterNpub = ctx.activeNpub

  // 4. Optionally configure relays
  let relaysConfigured = false
  if (args.newRelays && args.newRelays.length > 0) {
    pool.reconfigure(masterNpub, {
      read: [...args.newRelays],
      write: [...args.newRelays],
    })
    relaysConfigured = true
  }

  // Clean up
  secret.fill(0)
  ctx.destroy()

  return { masterNpub, recovered: true, relaysConfigured }
}

// ---------------------------------------------------------------------------
// 6. relay-health
// ---------------------------------------------------------------------------

export interface RelayHealthReport {
  url: string
  reachable: boolean
  responseTimeMs: number
  nip11?: Record<string, unknown>
  hasUserEvents: boolean
  writeAccess?: boolean
  error?: string
}

export async function handleRelayHealth(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkey?: string; checkWrite?: boolean },
): Promise<RelayHealthReport[]> {
  const relaySet = pool.getRelays(ctx.activeNpub)
  const allRelays = [...new Set([...relaySet.read, ...relaySet.write])]

  if (allRelays.length === 0) {
    return []
  }

  const pubkeyHex = args.pubkey ?? ctx.activePublicKeyHex

  const reports = await Promise.all(
    allRelays.map(url => checkRelayHealth(pool, ctx, url, pubkeyHex, args.checkWrite ?? false)),
  )

  return reports
}

async function checkRelayHealth(
  pool: RelayPool,
  ctx: IdentityContext,
  url: string,
  pubkeyHex: string,
  checkWrite: boolean,
): Promise<RelayHealthReport> {
  const report: RelayHealthReport = {
    url,
    reachable: false,
    responseTimeMs: -1,
    hasUserEvents: false,
  }

  // NIP-11 check
  try {
    const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
    const start = Date.now()
    const resp = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(3_000),
    })
    report.responseTimeMs = Date.now() - start
    report.reachable = resp.ok

    if (resp.ok) {
      try {
        report.nip11 = await resp.json() as Record<string, unknown>
      } catch { /* not valid JSON */ }
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : 'NIP-11 fetch failed'
  }

  // Check for user's events
  try {
    const events = await pool.queryDirect([url], {
      kinds: [1, 0, 3],
      authors: [pubkeyHex],
      limit: 1,
    })
    report.hasUserEvents = events.length > 0
  } catch {
    // Query failed — relay may be down
  }

  // Write access test
  if (checkWrite && report.reachable) {
    try {
      const sign = ctx.getSigningFunction()
      const testEvent = await sign({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', '_bray_health_check'], ['expiration', String(Math.floor(Date.now() / 1000) + 60)]],
        content: '',
      })
      const result = await pool.publishDirect([url], testEvent)
      report.writeAccess = result.success
    } catch {
      report.writeAccess = false
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// 7. onboard-verified
// ---------------------------------------------------------------------------

export interface OnboardStep {
  step: number
  title: string
  action: string
  completed: boolean
  optional?: boolean
}

export interface OnboardVerifiedResult {
  currentTier: number | null
  currentScore: number
  steps: OnboardStep[]
  potentialVouchers: Array<{ pubkey: string; npub: string; tier: number }>
}

export async function handleOnboardVerified(
  ctx: IdentityContext,
  pool: RelayPool,
  trust: TrustContext,
  _args: Record<string, never>,
): Promise<OnboardVerifiedResult> {
  const myHex = ctx.activePublicKeyHex

  // 1. Assess current tier and score
  const assessment = await trust.assess(myHex)
  const currentTier = assessment.verification.tier
  const currentScore = assessment.verification.score

  // 2. Build onboarding steps
  const steps: OnboardStep[] = [
    {
      step: 1,
      title: 'Self-declaration (Tier 1)',
      action: 'Publish a self-declared profile attestation so others can find and vouch for you',
      completed: currentTier !== null && currentTier >= 1,
    },
    {
      step: 2,
      title: 'Get vouches (Tier 2)',
      action: 'Ask trusted contacts to issue kind 31000 attestations for your identity',
      completed: currentTier !== null && currentTier >= 2,
    },
    {
      step: 3,
      title: 'Professional verification (Tier 3)',
      action: 'Complete Signet professional verification to achieve the highest trust tier',
      completed: currentTier !== null && currentTier >= 3,
    },
    {
      step: 4,
      title: 'Set up vault (optional)',
      action: 'Configure an encrypted vault to share private data with trusted contacts',
      completed: assessment.access.vaultTiers.length > 0,
      optional: true,
    },
  ]

  // 3. Find potential vouchers from follow graph (contacts who are Tier 2+)
  const myContactEvents = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [myHex],
  })
  const myContacts = extractContactPubkeys(myContactEvents)

  const potentialVouchers: OnboardVerifiedResult['potentialVouchers'] = []
  const contactSlice = [...myContacts].slice(0, 100)

  for (const contactPk of contactSlice) {
    const contactAssessment = await trust.assess(contactPk)
    const tier = contactAssessment.verification.tier
    if (tier !== null && tier >= 2) {
      potentialVouchers.push({
        pubkey: contactPk,
        npub: npubEncode(contactPk),
        tier,
      })
    }
  }

  return {
    currentTier,
    currentScore,
    steps,
    potentialVouchers,
  }
}
