import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import { validatePublicUrl } from '../validation.js'

/** Kind 31402 — parameterised replaceable event for L402 service announcements */
export const L402_ANNOUNCE_KIND = 31402

// --- Parsed types ---

/** @experimental */
export interface ParsedPricing {
  capability: string
  amount: string
  currency: string
}

/** @experimental */
export interface ParsedCapability {
  name: string
  description: string
  endpoint?: string
  schema?: unknown
  outputSchema?: unknown
}

/** @experimental */
export interface ParsedService {
  /** Nostr event ID */
  id: string
  /** d-tag identifier */
  identifier: string
  name: string
  urls: string[]
  about: string
  pubkey: string
  paymentMethods: string[][]
  pricing: ParsedPricing[]
  topics: string[]
  capabilities: ParsedCapability[]
  version?: string
  picture?: string
  createdAt: number
}

/** @experimental */
export interface L402Challenge {
  macaroon: string
  invoice: string
}

/** @experimental */
export interface ProbeResult {
  url: string
  status: number
  challenge?: L402Challenge
  costSats?: number
  /** Body parsed as JSON, if available */
  body?: unknown
}

/** @experimental */
export interface ServiceComparison {
  services: Array<{
    name: string
    identifier: string
    pubkey: string
    urls: string[]
    pricing: ParsedPricing[]
    paymentMethods: string[][]
    capabilities: string[]
    topics: string[]
  }>
  comparison: {
    cheapest?: string
    mostCapabilities?: string
    sharedCapabilities: string[]
  }
}

// --- Event parsing ---

/** Parse a kind 31402 Nostr event into a structured service description. */
export function parseAnnounceEvent(event: NostrEvent): ParsedService {
  const getTag = (key: string): string | undefined =>
    event.tags.find(t => t[0] === key)?.[1]

  const getAllTags = (key: string): string[][] =>
    event.tags.filter(t => t[0] === key)

  const getAllTagValues = (key: string): string[] =>
    event.tags.filter(t => t[0] === key).map(t => t[1]).filter(Boolean)

  const paymentMethods = getAllTags('pmi').map(t => t.slice(1))
  const topics = getAllTagValues('t')

  const pricing: ParsedPricing[] = getAllTags('price').map(t => ({
    capability: t[1] ?? '',
    amount: t[2] ?? '',
    currency: t[3] ?? '',
  }))

  let capabilities: ParsedCapability[] = []
  let version: string | undefined
  try {
    const parsed = JSON.parse(event.content) as Record<string, unknown>
    if (Array.isArray(parsed.capabilities)) {
      capabilities = (parsed.capabilities as unknown[]).slice(0, 100)
        .filter((c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null &&
          typeof (c as Record<string, unknown>).name === 'string' &&
          typeof (c as Record<string, unknown>).description === 'string',
        )
        .map(c => ({
          name: (c.name as string).slice(0, 500),
          description: (c.description as string).slice(0, 2000),
          ...(typeof c.endpoint === 'string' ? { endpoint: c.endpoint.slice(0, 2048) } : {}),
          ...(c.schema !== undefined ? { schema: c.schema } : {}),
          ...(c.outputSchema !== undefined ? { outputSchema: c.outputSchema } : {}),
        }))
    }
    if (typeof parsed.version === 'string') {
      version = parsed.version.slice(0, 64)
    }
  } catch {
    // Invalid JSON content — capabilities remain empty
  }

  return {
    id: event.id,
    identifier: getTag('d') ?? '',
    name: getTag('name') ?? '',
    urls: getAllTagValues('url'),
    about: getTag('about') ?? '',
    pubkey: event.pubkey,
    paymentMethods,
    pricing,
    topics,
    capabilities,
    version,
    picture: getTag('picture'),
    createdAt: event.created_at,
  }
}

// --- Discovery ---

/** @experimental */
export interface DiscoverArgs {
  topics?: string[]
  paymentMethod?: string
  authors?: string[]
  maxPrice?: number
  currency?: string
  limit?: number
  relays?: string[]
}

/** Query Nostr relays for kind 31402 service announcements with optional filters. */
export async function handleMarketplaceDiscover(
  pool: RelayPool,
  npub: string,
  args: DiscoverArgs,
): Promise<ParsedService[]> {
  const filter: Filter = {
    kinds: [L402_ANNOUNCE_KIND],
    limit: args.limit ?? 50,
  }

  if (args.authors?.length) {
    filter.authors = args.authors
  }

  // Relay-side tag filters
  if (args.topics?.length) {
    (filter as Record<string, unknown>)['#t'] = args.topics
  }
  if (args.paymentMethod) {
    (filter as Record<string, unknown>)['#pmi'] = [args.paymentMethod]
  }

  let events: NostrEvent[]
  if (args.relays?.length) {
    events = await pool.queryDirect(args.relays, filter)
  } else {
    events = await pool.query(npub, filter)
  }

  // NIP-33 dedup: keep only the newest event per pubkey + d-tag
  const replaceableMap = new Map<string, NostrEvent>()
  for (const e of events) {
    const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? ''
    const key = `${e.pubkey}:${dTag}`
    const existing = replaceableMap.get(key)
    if (!existing || e.created_at > existing.created_at) {
      replaceableMap.set(key, e)
    }
  }

  let services = [...replaceableMap.values()].map(parseAnnounceEvent)

  // Client-side price filter (relays cannot filter by price range)
  if (args.maxPrice !== undefined && args.currency) {
    const currencyLower = args.currency.toLowerCase()
    services = services.filter(svc =>
      svc.pricing.some(p => {
        const amount = parseFloat(p.amount)
        return (
          p.currency.toLowerCase() === currencyLower &&
          !isNaN(amount) &&
          amount <= args.maxPrice!
        )
      }),
    )
  }

  return services
}

// --- Inspect ---

/** Get full details of a specific service by event ID or by pubkey + identifier. */
export async function handleMarketplaceInspect(
  pool: RelayPool,
  npub: string,
  args: { eventId?: string; pubkey?: string; identifier?: string; relays?: string[] },
): Promise<ParsedService | null> {
  if (!args.eventId && !(args.pubkey && args.identifier)) {
    throw new Error('Provide either eventId, or both pubkey and identifier')
  }

  const filter: Filter = { kinds: [L402_ANNOUNCE_KIND], limit: 1 }

  if (args.eventId) {
    filter.ids = [args.eventId]
  } else {
    filter.authors = [args.pubkey!]
    ;(filter as Record<string, unknown>)['#d'] = [args.identifier!]
  }

  let events: NostrEvent[]
  if (args.relays?.length) {
    events = await pool.queryDirect(args.relays, filter)
  } else {
    events = await pool.query(npub, filter)
  }

  if (events.length === 0) return null

  // For replaceable events queried by pubkey+d, take the newest
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at)
  return parseAnnounceEvent(sorted[0])
}

// --- Search ---

/** Text search across service names, descriptions, and capabilities. */
export async function handleMarketplaceSearch(
  pool: RelayPool,
  npub: string,
  args: { query: string; topics?: string[]; paymentMethod?: string; limit?: number; relays?: string[] },
): Promise<ParsedService[]> {
  // Fetch a broad set of kind 31402 events first
  const services = await handleMarketplaceDiscover(pool, npub, {
    topics: args.topics,
    paymentMethod: args.paymentMethod,
    limit: 200, // fetch more for client-side filtering
    relays: args.relays,
  })

  const queryLower = args.query.toLowerCase()
  const filtered = services.filter(svc => {
    const searchable = [
      svc.name,
      svc.about,
      svc.identifier,
      ...svc.topics,
      ...svc.capabilities.map(c => `${c.name} ${c.description}`),
    ].join(' ').toLowerCase()

    return searchable.includes(queryLower)
  })

  return filtered.slice(0, args.limit ?? 20)
}

// --- Reputation ---

/** @experimental */
export interface ReputationResult {
  pubkey: string
  serviceCount: number
  oldestAnnouncement?: number
  newestAnnouncement?: number
  topics: string[]
  /** Trust score from the trust-score workflow, if available */
  trustScore?: number
}

/** Check a service provider's reputation by examining their announcement history. */
export async function handleMarketplaceReputation(
  pool: RelayPool,
  npub: string,
  args: { pubkey: string; relays?: string[] },
): Promise<ReputationResult> {
  const filter: Filter = {
    kinds: [L402_ANNOUNCE_KIND],
    authors: [args.pubkey],
    limit: 100,
  }

  let events: NostrEvent[]
  if (args.relays?.length) {
    events = await pool.queryDirect(args.relays, filter)
  } else {
    events = await pool.query(npub, filter)
  }

  // NIP-33 dedup
  const replaceableMap = new Map<string, NostrEvent>()
  for (const e of events) {
    const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? ''
    const key = `${e.pubkey}:${dTag}`
    const existing = replaceableMap.get(key)
    if (!existing || e.created_at > existing.created_at) {
      replaceableMap.set(key, e)
    }
  }

  const uniqueServices = [...replaceableMap.values()]
  const allTopics = new Set<string>()
  for (const e of uniqueServices) {
    for (const t of e.tags) {
      if (t[0] === 't' && t[1]) allTopics.add(t[1])
    }
  }

  const timestamps = uniqueServices.map(e => e.created_at)

  return {
    pubkey: args.pubkey,
    serviceCount: uniqueServices.length,
    oldestAnnouncement: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestAnnouncement: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    topics: [...allTopics],
  }
}

// --- Compare ---

/** Compare multiple services side by side. */
export function handleMarketplaceCompare(services: ParsedService[]): ServiceComparison {
  if (services.length < 2) {
    throw new Error('At least two services are required for comparison')
  }

  const summaries = services.map(svc => ({
    name: svc.name,
    identifier: svc.identifier,
    pubkey: svc.pubkey,
    urls: svc.urls,
    pricing: svc.pricing,
    paymentMethods: svc.paymentMethods,
    capabilities: svc.capabilities.map(c => c.name),
    topics: svc.topics,
  }))

  // Find cheapest (by lowest single-capability price in sats)
  let cheapestName: string | undefined
  let cheapestPrice = Infinity
  for (const svc of services) {
    for (const p of svc.pricing) {
      if (p.currency.toLowerCase() === 'sats') {
        const amount = parseFloat(p.amount)
        if (!isNaN(amount) && amount < cheapestPrice) {
          cheapestPrice = amount
          cheapestName = svc.name
        }
      }
    }
  }

  // Find service with most capabilities
  let mostCapName: string | undefined
  let mostCapCount = 0
  for (const svc of services) {
    if (svc.capabilities.length > mostCapCount) {
      mostCapCount = svc.capabilities.length
      mostCapName = svc.name
    }
  }

  // Find capabilities shared by all services
  const capSets = services.map(svc =>
    new Set(svc.capabilities.map(c => c.name)),
  )
  const sharedCapabilities = capSets.length > 0
    ? [...capSets[0]].filter(cap => capSets.every(s => s.has(cap)))
    : []

  return {
    services: summaries,
    comparison: {
      cheapest: cheapestName,
      mostCapabilities: mostCapName,
      sharedCapabilities,
    },
  }
}

// --- Probe ---

/** Probe an HTTP endpoint for an L402 challenge without paying. */
export async function handleMarketplaceProbe(
  url: string,
  method: string = 'GET',
): Promise<ProbeResult> {
  validatePublicUrl(url)

  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(15_000),
  })

  const result: ProbeResult = {
    url,
    status: response.status,
  }

  if (response.status === 402) {
    const authHeader = response.headers.get('www-authenticate') ?? ''
    const challenge = parseL402ChallengeHeader(authHeader)
    if (challenge) {
      result.challenge = challenge
      // Basic bolt11 amount extraction
      result.costSats = extractBolt11AmountSats(challenge.invoice)
    }
  }

  try {
    const text = await response.text()
    if (text.length > 0 && text.length < 65_536) {
      result.body = JSON.parse(text)
    }
  } catch {
    // Body not JSON or too large — ignore
  }

  return result
}

/** Parse L402/LSAT challenge from WWW-Authenticate header. */
export function parseL402ChallengeHeader(header: string): L402Challenge | null {
  const match = header.match(/^(?:L402|LSAT)\s+(.+)$/i)
  if (!match) return null

  const params = match[1]
  const macaroonMatch = params.match(
    /macaroon="([A-Za-z0-9+/_\-=]+)"|macaroon=([A-Za-z0-9+/_\-=]+)(?:[,\s]|$)/,
  )
  const invoiceMatch = params.match(
    /invoice="(ln(?:bc(?:rt)?|tb)[A-Za-z0-9]+)"|invoice=(ln(?:bc(?:rt)?|tb)[A-Za-z0-9]+)(?:[,\s]|$)/,
  )

  if (!macaroonMatch || !invoiceMatch) return null

  return {
    macaroon: macaroonMatch[1] ?? macaroonMatch[2],
    invoice: invoiceMatch[1] ?? invoiceMatch[2],
  }
}

/** Extract amount in sats from a bolt11 invoice string (basic parsing). */
export function extractBolt11AmountSats(bolt11: string): number | undefined {
  const match = bolt11.match(/^ln(?:bc|tb|tbs)(\d+)([munp])?/)
  if (!match) return undefined

  const num = parseInt(match[1], 10)
  const multiplier = match[2]
  const multipliers: Record<string, number> = {
    'm': 100_000_000,
    'u': 100_000,
    'n': 100,
    'p': 0.1,
  }

  if (multiplier && multipliers[multiplier]) {
    // Convert msats to sats
    return Math.round(num * multipliers[multiplier] / 1000)
  }

  return undefined
}

// --- Pay ---

/** Pay an L402 invoice via NWC and return credentials for authenticated calls.
 *  This delegates to the zap infrastructure — the actual payment is handled
 *  by the NWC wallet. The macaroon + preimage are combined into a credential
 *  that can be used for authenticated API calls.
 *
 *  SECURITY: Credentials are used internally only — never returned raw to the caller. */
/** @experimental */
export interface PayResult {
  paid: boolean
  /** Opaque credential handle — use with marketplace-call */
  credentialId: string
  costSats?: number
}

// In-memory credential store for L402 tokens (per-session, not persisted)
const credentialStore = new Map<string, { macaroon: string; preimage: string }>()

export function storeCredential(id: string, macaroon: string, preimage: string): void {
  credentialStore.set(id, { macaroon, preimage })
}

export function getCredential(id: string): { macaroon: string; preimage: string } | undefined {
  return credentialStore.get(id)
}

export function clearCredentials(): void {
  credentialStore.clear()
}

/** Build the L402 Authorization header from stored credentials. */
export function buildL402AuthHeader(credentialId: string): string | null {
  const cred = credentialStore.get(credentialId)
  if (!cred) return null
  return `L402 ${cred.macaroon}:${cred.preimage}`
}

// --- Call ---

/** @experimental */
export interface CallResult {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** Make an authenticated API call using L402 credentials. */
export async function handleMarketplaceCall(
  args: { url: string; method?: string; credentialId: string; body?: string; headers?: Record<string, string> },
): Promise<CallResult> {
  validatePublicUrl(args.url)

  const authHeader = buildL402AuthHeader(args.credentialId)
  if (!authHeader) {
    throw new Error(`No credentials found for ID "${args.credentialId}". Use marketplace-pay first.`)
  }

  const headers: Record<string, string> = {
    ...args.headers,
    Authorization: authHeader,
  }

  const response = await fetch(args.url, {
    method: args.method ?? 'GET',
    headers,
    body: args.body,
    signal: AbortSignal.timeout(30_000),
  })

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    // Filter out sensitive headers
    if (!key.toLowerCase().startsWith('set-cookie')) {
      responseHeaders[key] = value
    }
  })

  let body: unknown
  try {
    const text = await response.text()
    if (text.length > 0 && text.length < 1_048_576) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    } else if (text.length >= 1_048_576) {
      body = '(response body too large — truncated)'
    }
  } catch {
    body = null
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body,
  }
}

// --- Announce ---

/** @experimental */
export interface AnnounceArgs {
  identifier: string
  name: string
  urls: string[]
  about: string
  pricing: Array<{ capability: string; price: number; currency: string }>
  paymentMethods: string[][]
  picture?: string
  topics?: string[]
  capabilities?: Array<{ name: string; description: string; endpoint?: string }>
  version?: string
}

/** Build and publish a kind 31402 service announcement. */
export async function handleMarketplaceAnnounce(
  ctx: SigningContext,
  pool: RelayPool,
  args: AnnounceArgs,
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  // Validate inputs
  if (!args.identifier || args.identifier.trim().length === 0) {
    throw new Error('identifier must not be empty')
  }
  if (args.identifier.length > 256) {
    throw new Error('identifier must not exceed 256 characters')
  }
  if (!args.name || args.name.trim().length === 0) {
    throw new Error('name must not be empty')
  }
  if (args.name.length > 256) {
    throw new Error('name must not exceed 256 characters')
  }
  if (!args.urls || args.urls.length === 0) {
    throw new Error('At least one URL is required')
  }
  if (args.urls.length > 10) {
    throw new Error('Maximum 10 URLs allowed')
  }
  for (const url of args.urls) {
    new URL(url) // throws on invalid URL
  }
  if (!args.about || args.about.trim().length === 0) {
    throw new Error('about must not be empty')
  }
  if (args.about.length > 4096) {
    throw new Error('about must not exceed 4096 characters')
  }
  if (!args.pricing || args.pricing.length === 0) {
    throw new Error('At least one pricing entry is required')
  }
  if (args.pricing.length > 100) {
    throw new Error('Maximum 100 pricing entries allowed')
  }
  for (const p of args.pricing) {
    if (!Number.isFinite(p.price) || p.price < 0) {
      throw new Error(`Price must be a finite non-negative number, got: ${p.price}`)
    }
  }
  if (!args.paymentMethods || args.paymentMethods.length === 0) {
    throw new Error('At least one payment method is required')
  }
  const validRails = new Set(['l402', 'x402', 'cashu', 'xcashu', 'payment'])
  for (const pm of args.paymentMethods) {
    if (!Array.isArray(pm) || pm.length === 0) {
      throw new Error('Payment method entries must be non-empty arrays')
    }
    if (!validRails.has(pm[0])) {
      throw new Error(`Payment method rail must be one of: ${[...validRails].join(', ')}. Got: "${pm[0]}"`)
    }
  }

  // Build tags
  const tags: string[][] = [
    ['d', args.identifier],
    ['name', args.name],
    ...args.urls.map(u => ['url', u]),
    ['about', args.about],
  ]

  if (args.picture) {
    tags.push(['picture', args.picture])
  }

  for (const pm of args.paymentMethods) {
    tags.push(['pmi', ...pm])
  }

  for (const p of args.pricing) {
    tags.push(['price', p.capability, String(p.price), p.currency])
  }

  if (args.topics) {
    for (const topic of args.topics) {
      tags.push(['t', topic])
    }
  }

  // Build content JSON
  const contentObj: Record<string, unknown> = {}
  if (args.capabilities) {
    contentObj.capabilities = args.capabilities
  }
  if (args.version) {
    contentObj.version = args.version
  }
  const content = JSON.stringify(contentObj)

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: L402_ANNOUNCE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// --- Update ---

/** Update an existing service announcement (same as announce — kind 31402 is replaceable). */
export async function handleMarketplaceUpdate(
  ctx: SigningContext,
  pool: RelayPool,
  args: AnnounceArgs,
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  // Same as announce — NIP-33 replaceable events auto-update on same pubkey + d-tag
  return handleMarketplaceAnnounce(ctx, pool, args)
}

// --- Retire ---

/** Mark a service as retired by publishing a kind 5 deletion event. */
export async function handleMarketplaceRetire(
  ctx: SigningContext,
  pool: RelayPool,
  args: { identifier: string; reason?: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.identifier || args.identifier.trim().length === 0) {
    throw new Error('identifier must not be empty')
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['a', `${L402_ANNOUNCE_KIND}:${ctx.activePublicKeyHex}:${args.identifier}`],
    ],
    content: args.reason ?? '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}
