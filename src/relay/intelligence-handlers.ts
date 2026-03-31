import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import { parseRelayTags } from '../nip65.js'
import { validateRelayUrl, handleRelayInfo } from './handlers.js'

// ---------------------------------------------------------------------------
// 1. relay-discover — discover relays used by contacts
// ---------------------------------------------------------------------------

export interface ContactRelay {
  url: string
  /** Number of contacts using this relay */
  contactCount: number
  /** Whether this relay is already in your set */
  alreadyUsed: boolean
  mode: 'read' | 'write' | 'both'
}

export interface RelayDiscoverResult {
  contactsScanned: number
  relaysFound: number
  relays: ContactRelay[]
}

export async function handleRelayDiscover(
  ctx: SigningContext,
  pool: RelayPool,
  args: { limit?: number },
): Promise<RelayDiscoverResult> {
  const limit = args.limit ?? 20
  const myHex = ctx.activePublicKeyHex

  // 1. Fetch our kind 3 contact list
  const contactEvents = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [myHex],
  })

  if (contactEvents.length === 0) {
    return { contactsScanned: 0, relaysFound: 0, relays: [] }
  }

  // Take the newest kind 3
  const best = contactEvents.reduce((a, b) => b.created_at > a.created_at ? b : a)
  const contactPubkeys = best.tags
    .filter(t => t[0] === 'p' && t[1])
    .map(t => t[1])

  if (contactPubkeys.length === 0) {
    return { contactsScanned: 0, relaysFound: 0, relays: [] }
  }

  // 2. Fetch kind 10002 relay lists for contacts (cap at 500)
  const batch = contactPubkeys.slice(0, 500)
  const relayListEvents = await pool.query(ctx.activeNpub, {
    kinds: [10002],
    authors: batch,
  })

  // Deduplicate: keep only the newest kind 10002 per author
  const bestPerAuthor = new Map<string, NostrEvent>()
  for (const ev of relayListEvents) {
    const prev = bestPerAuthor.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) {
      bestPerAuthor.set(ev.pubkey, ev)
    }
  }

  // 3. Aggregate relay URLs
  const readCounts = new Map<string, number>()
  const writeCounts = new Map<string, number>()

  for (const ev of bestPerAuthor.values()) {
    const parsed = parseRelayTags(ev.tags)
    for (const url of parsed.read) {
      readCounts.set(url, (readCounts.get(url) ?? 0) + 1)
    }
    for (const url of parsed.write) {
      writeCounts.set(url, (writeCounts.get(url) ?? 0) + 1)
    }
  }

  // Combine into a single ranked list
  const allUrls = new Set([...readCounts.keys(), ...writeCounts.keys()])
  const myRelays = pool.getRelays(ctx.activeNpub)
  const myAll = new Set([...myRelays.read, ...myRelays.write])

  const ranked: ContactRelay[] = []
  for (const url of allUrls) {
    const rc = readCounts.get(url) ?? 0
    const wc = writeCounts.get(url) ?? 0
    const mode = rc > 0 && wc > 0 ? 'both' : rc > 0 ? 'read' : 'write'
    ranked.push({
      url,
      contactCount: rc + wc,
      alreadyUsed: myAll.has(url),
      mode,
    })
  }

  // Sort by contact count descending
  ranked.sort((a, b) => b.contactCount - a.contactCount)

  return {
    contactsScanned: bestPerAuthor.size,
    relaysFound: ranked.length,
    relays: ranked.slice(0, limit),
  }
}

// ---------------------------------------------------------------------------
// 2. relay-nip-search — find relays supporting specific NIPs
// ---------------------------------------------------------------------------

export interface NipSearchRelay {
  url: string
  supportedNips: number[]
  /** Which of the requested NIPs this relay supports */
  matchedNips: number[]
  name?: string
}

export interface NipSearchResult {
  requestedNips: number[]
  relaysChecked: number
  matches: NipSearchRelay[]
}

export async function handleRelayNipSearch(
  ctx: SigningContext,
  pool: RelayPool,
  args: { nips: number[]; candidateRelays?: string[] },
): Promise<NipSearchResult> {
  // Determine candidate relays: explicit list, or our current relays + well-known relays
  let candidates: string[]
  if (args.candidateRelays?.length) {
    for (const url of args.candidateRelays) validateRelayUrl(url)
    candidates = args.candidateRelays
  } else {
    const myRelays = pool.getRelays(ctx.activeNpub)
    candidates = [...new Set([...myRelays.read, ...myRelays.write])]
  }

  // Fetch NIP-11 for each candidate
  const matches: NipSearchRelay[] = []
  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      const info = await fetchNip11Quiet(url)
      return { url, info }
    }),
  )

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value.info) continue
    const { url, info } = result.value
    const supportedNips = extractSupportedNips(info)
    const matchedNips = args.nips.filter(n => supportedNips.includes(n))

    if (matchedNips.length > 0) {
      matches.push({
        url,
        supportedNips,
        matchedNips,
        name: typeof info.name === 'string' ? info.name : undefined,
      })
    }
  }

  // Sort by number of matched NIPs descending
  matches.sort((a, b) => b.matchedNips.length - a.matchedNips.length)

  return {
    requestedNips: args.nips,
    relaysChecked: candidates.length,
    matches,
  }
}

// ---------------------------------------------------------------------------
// 3. relay-compare — compare relays side-by-side
// ---------------------------------------------------------------------------

export interface RelayComparison {
  url: string
  reachable: boolean
  responseTimeMs: number
  name?: string
  description?: string
  supportedNips: number[]
  hasUserEvents: boolean
  software?: string
  version?: string
  limitation?: Record<string, unknown>
  error?: string
}

export interface RelayCompareResult {
  relays: RelayComparison[]
}

export async function handleRelayCompare(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relays: string[] },
): Promise<RelayCompareResult> {
  for (const url of args.relays) validateRelayUrl(url)

  const pubkeyHex = ctx.activePublicKeyHex

  const comparisons = await Promise.all(
    args.relays.map(url => compareRelay(pool, ctx, url, pubkeyHex)),
  )

  return { relays: comparisons }
}

async function compareRelay(
  pool: RelayPool,
  ctx: SigningContext,
  url: string,
  pubkeyHex: string,
): Promise<RelayComparison> {
  const result: RelayComparison = {
    url,
    reachable: false,
    responseTimeMs: -1,
    supportedNips: [],
    hasUserEvents: false,
  }

  // NIP-11 metadata
  try {
    const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
    const start = Date.now()
    const resp = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(5_000),
    })
    result.responseTimeMs = Date.now() - start
    result.reachable = resp.ok

    if (resp.ok) {
      try {
        const info = await resp.json() as Record<string, unknown>
        result.name = typeof info.name === 'string' ? info.name : undefined
        result.description = typeof info.description === 'string' ? info.description : undefined
        result.supportedNips = extractSupportedNips(info)
        result.software = typeof info.software === 'string' ? info.software : undefined
        result.version = typeof info.version === 'string' ? info.version : undefined
        if (typeof info.limitation === 'object' && info.limitation !== null) {
          result.limitation = info.limitation as Record<string, unknown>
        }
      } catch { /* not valid JSON */ }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'NIP-11 fetch failed'
  }

  // Check for user events
  try {
    const events = await pool.queryDirect([url], {
      kinds: [1, 0, 3],
      authors: [pubkeyHex],
      limit: 1,
    })
    result.hasUserEvents = events.length > 0
  } catch {
    // Query failed
  }

  return result
}

// ---------------------------------------------------------------------------
// 4. relay-diversity — analyse relay set for centralisation risk
// ---------------------------------------------------------------------------

export interface OperatorGroup {
  operator: string
  relays: string[]
}

export interface DiversityReport {
  totalRelays: number
  uniqueOperators: number
  operatorGroups: OperatorGroup[]
  /** Fraction of relays sharing the most common operator (0..1) */
  concentrationRatio: number
  warnings: string[]
  recommendations: string[]
  relayDetails: Array<{
    url: string
    operator?: string
    software?: string
    country?: string
    reachable: boolean
  }>
}

export async function handleRelayDiversity(
  ctx: SigningContext,
  pool: RelayPool,
): Promise<DiversityReport> {
  const relaySet = pool.getRelays(ctx.activeNpub)
  const allRelays = [...new Set([...relaySet.read, ...relaySet.write])]

  if (allRelays.length === 0) {
    return {
      totalRelays: 0,
      uniqueOperators: 0,
      operatorGroups: [],
      concentrationRatio: 0,
      warnings: ['No relays configured.'],
      recommendations: ['Configure at least 3 relays for redundancy.'],
      relayDetails: [],
    }
  }

  // Fetch NIP-11 for each relay
  const details = await Promise.all(
    allRelays.map(async (url) => {
      const info = await fetchNip11Quiet(url)
      return {
        url,
        operator: extractOperator(info),
        software: typeof info?.software === 'string' ? info.software : undefined,
        country: typeof info?.country === 'string' ? info.country : undefined,
        reachable: info !== null,
      }
    }),
  )

  // Group by operator
  const operatorMap = new Map<string, string[]>()
  for (const d of details) {
    const op = d.operator ?? 'unknown'
    const group = operatorMap.get(op) ?? []
    group.push(d.url)
    operatorMap.set(op, group)
  }

  const operatorGroups: OperatorGroup[] = [...operatorMap.entries()]
    .map(([operator, relays]) => ({ operator, relays }))
    .sort((a, b) => b.relays.length - a.relays.length)

  const uniqueOperators = operatorGroups.filter(g => g.operator !== 'unknown').length
  const largestGroup = operatorGroups[0]?.relays.length ?? 0
  const concentrationRatio = allRelays.length > 0 ? largestGroup / allRelays.length : 0

  // Generate warnings and recommendations
  const warnings: string[] = []
  const recommendations: string[] = []

  if (allRelays.length < 3) {
    warnings.push(`Only ${allRelays.length} relay(s) configured. Minimum 3 recommended for redundancy.`)
  }

  if (concentrationRatio > 0.5 && operatorGroups[0]?.operator !== 'unknown') {
    warnings.push(
      `Over 50% of your relays (${largestGroup}/${allRelays.length}) share operator "${operatorGroups[0].operator}". ` +
      'This is a centralisation risk.',
    )
    recommendations.push('Add relays from different operators to reduce single-point-of-failure risk.')
  }

  const softwareSet = new Set(details.map(d => d.software).filter(Boolean))
  if (softwareSet.size === 1) {
    warnings.push(`All reachable relays run the same software: ${[...softwareSet][0]}. Software monoculture increases risk.`)
    recommendations.push('Consider adding relays running different software (e.g. strfry, nostr-rs-relay, khatru).')
  }

  const unreachable = details.filter(d => !d.reachable)
  if (unreachable.length > 0) {
    warnings.push(`${unreachable.length} relay(s) unreachable: ${unreachable.map(d => d.url).join(', ')}.`)
  }

  if (warnings.length === 0) {
    recommendations.push('Your relay set looks well-diversified.')
  }

  return {
    totalRelays: allRelays.length,
    uniqueOperators,
    operatorGroups,
    concentrationRatio: Math.round(concentrationRatio * 100) / 100,
    warnings,
    recommendations,
    relayDetails: details,
  }
}

// ---------------------------------------------------------------------------
// 5. relay-recommend — recommend relays based on strategy
// ---------------------------------------------------------------------------

export type RecommendStrategy = 'balanced' | 'privacy' | 'performance' | 'social'

export interface RecommendedRelay {
  url: string
  score: number
  reasons: string[]
  responseTimeMs?: number
  supportedNips?: number[]
  contactCount?: number
}

export interface RelayRecommendResult {
  strategy: RecommendStrategy
  recommendations: RecommendedRelay[]
}

export async function handleRelayRecommend(
  ctx: SigningContext,
  pool: RelayPool,
  args: { strategy?: RecommendStrategy; limit?: number },
): Promise<RelayRecommendResult> {
  const strategy = args.strategy ?? 'balanced'
  const limit = args.limit ?? 10

  // 1. Discover relays from contacts
  const discovery = await handleRelayDiscover(ctx, pool, { limit: 50 })

  // 2. Fetch NIP-11 info for top discovered relays
  const candidateUrls = discovery.relays
    .filter(r => !r.alreadyUsed)
    .slice(0, 30)
    .map(r => r.url)

  const nip11Map = new Map<string, Record<string, unknown>>()
  const responseTimeMap = new Map<string, number>()

  const infoResults = await Promise.allSettled(
    candidateUrls.map(async (url) => {
      const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
      const start = Date.now()
      const resp = await fetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(5_000),
      })
      const elapsed = Date.now() - start
      responseTimeMap.set(url, elapsed)

      if (resp.ok) {
        const info = await resp.json() as Record<string, unknown>
        nip11Map.set(url, info)
      }
    }),
  )

  // Build contact count map
  const contactCountMap = new Map<string, number>()
  for (const r of discovery.relays) {
    contactCountMap.set(r.url, r.contactCount)
  }

  // 3. Score each candidate according to strategy
  const scored: RecommendedRelay[] = []

  for (const url of candidateUrls) {
    const info = nip11Map.get(url)
    const responseTime = responseTimeMap.get(url)
    const contactCount = contactCountMap.get(url) ?? 0
    const reachable = info !== undefined

    if (!reachable) continue

    const { score, reasons } = scoreRelay(url, info, responseTime, contactCount, strategy)

    scored.push({
      url,
      score,
      reasons,
      responseTimeMs: responseTime,
      supportedNips: info ? extractSupportedNips(info) : undefined,
      contactCount,
    })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return {
    strategy,
    recommendations: scored.slice(0, limit),
  }
}

function scoreRelay(
  url: string,
  info: Record<string, unknown> | undefined,
  responseTime: number | undefined,
  contactCount: number,
  strategy: RecommendStrategy,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const nips = info ? extractSupportedNips(info) : []

  // Base scores common to all strategies
  if (responseTime !== undefined && responseTime >= 0) {
    if (responseTime < 200) {
      score += 20
      reasons.push('fast response (<200ms)')
    } else if (responseTime < 500) {
      score += 10
      reasons.push('moderate response (<500ms)')
    }
  }

  if (contactCount >= 10) {
    score += 15
    reasons.push(`popular among contacts (${contactCount})`)
  } else if (contactCount >= 3) {
    score += 8
    reasons.push(`used by ${contactCount} contacts`)
  }

  // Strategy-specific scoring
  switch (strategy) {
    case 'balanced': {
      // Reward a mix of popularity and NIP support
      if (nips.length >= 10) {
        score += 15
        reasons.push('broad NIP support')
      }
      if (contactCount >= 5 && contactCount < 50) {
        score += 10
        reasons.push('balanced popularity (not too centralised)')
      }
      if (typeof info?.limitation === 'object' && info.limitation !== null) {
        const lim = info.limitation as Record<string, unknown>
        if (typeof lim.payment_required === 'boolean' && !lim.payment_required) {
          score += 5
          reasons.push('free to use')
        }
      }
      break
    }

    case 'privacy': {
      // Favour .onion relays, no auth requirement, NIP-42 support optional
      const parsed = new URL(url)
      if (parsed.hostname.endsWith('.onion')) {
        score += 30
        reasons.push('Tor hidden service')
      }
      if (typeof info?.limitation === 'object' && info.limitation !== null) {
        const lim = info.limitation as Record<string, unknown>
        if (!lim.auth_required) {
          score += 15
          reasons.push('no authentication required')
        } else {
          score -= 10
          reasons.push('requires authentication (privacy penalty)')
        }
        if (!lim.payment_required) {
          score += 5
          reasons.push('no payment required')
        }
      } else {
        score += 10
        reasons.push('no stated limitations')
      }
      break
    }

    case 'performance': {
      // Heavily weight response time
      if (responseTime !== undefined) {
        if (responseTime < 100) {
          score += 30
          reasons.push('very fast (<100ms)')
        } else if (responseTime < 200) {
          score += 20
          // already counted in base
        } else if (responseTime < 300) {
          score += 10
        }
      }
      if (nips.includes(45)) {
        score += 10
        reasons.push('supports NIP-45 (event counts)')
      }
      if (nips.includes(50)) {
        score += 10
        reasons.push('supports NIP-50 (search)')
      }
      break
    }

    case 'social': {
      // Heavily weight contact overlap
      if (contactCount >= 20) {
        score += 30
        reasons.push(`highly popular among contacts (${contactCount})`)
      } else if (contactCount >= 10) {
        score += 20
      } else if (contactCount >= 5) {
        score += 10
      }
      // Prefer relays that support DMs and reactions
      if (nips.includes(17)) {
        score += 5
        reasons.push('supports NIP-17 (gift-wrapped DMs)')
      }
      break
    }
  }

  return { score: Math.max(0, score), reasons }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fetch NIP-11 info document quietly (returns null on failure) */
export async function fetchNip11Quiet(url: string): Promise<Record<string, unknown> | null> {
  try {
    const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
    const resp = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) return null
    return await resp.json() as Record<string, unknown>
  } catch {
    return null
  }
}

/** Extract supported NIP numbers from NIP-11 info */
export function extractSupportedNips(info: Record<string, unknown> | null): number[] {
  if (!info) return []
  const nips = info.supported_nips
  if (!Array.isArray(nips)) return []
  return nips.filter((n): n is number => typeof n === 'number')
}

/** Extract operator name from NIP-11 info */
export function extractOperator(info: Record<string, unknown> | null): string | undefined {
  if (!info) return undefined

  // NIP-11 uses pubkey or contact for operator identification
  if (typeof info.pubkey === 'string' && info.pubkey.length > 0) {
    return info.pubkey
  }
  if (typeof info.contact === 'string' && info.contact.length > 0) {
    return info.contact
  }

  // Fall back to software name as a rough grouping
  if (typeof info.software === 'string') {
    // Extract domain from software URL if present
    try {
      const softwareUrl = new URL(info.software)
      return softwareUrl.hostname
    } catch {
      return info.software
    }
  }

  return undefined
}
