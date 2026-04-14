#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from './config.js'
import { IdentityContext } from './context.js'
import { RelayPool } from './relay-pool.js'
import { Nip65Manager } from './nip65.js'
import { registerIdentityTools } from './identity/tools.js'
import { registerSocialTools } from './social/tools.js'
import { registerTrustTools } from './trust/tools.js'
import { registerRelayTools } from './relay/tools.js'
import { registerRelayIntelligenceTools } from './relay/intelligence-tools.js'
import { registerZapTools } from './zap/tools.js'
import { registerSafetyTools } from './safety/tools.js'
import { registerUtilTools } from './util/tools.js'
import { registerWorkflowTools } from './workflow/tools.js'
import { registerMarketplaceTools } from './marketplace/tools.js'
import { registerPrivacyTools } from './privacy/tools.js'
import { registerModerationTools } from './moderation/tools.js'
import { TrustContext } from './trust-context.js'
import type { SigningContext } from './signing-context.js'
import { registerSignetTools } from './signet/tools.js'
import { registerVaultTools } from './vault/tools.js'
import { registerDispatchTools } from './dispatch/tools.js'
import { registerHandlerTools } from './handler/tools.js'
import { ActionCatalog, createCatalogProxy } from './catalog.js'
import { configureHttpClient } from './http-client.js'

const config = await loadConfig()
// Route every fetch() in this process through the SOCKS proxy when Tor is
// configured, before any HTTP-using code runs. Structural protection
// against DNS/IP leaks; no callsite needs to opt in.
configureHttpClient({ torProxy: config.torProxy })
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
  allowPrivateRelays: config.allowPrivateRelays,
})
const nip65 = new Nip65Manager(pool, config.relays)

// Connect to bunker or use local key.
//
// In bunker mode we defer the Heartwood extension probe to a background
// task rather than blocking startup on it. The probe sends a
// heartwood_list_identities round-trip to the remote signer, which costs
// an extra 1-2 seconds on top of the NIP-46 connect and pubkey lookup.
// Sync startup takes 3-6s total over five relays, and Claude Code's MCP
// stdio health check will mark the server as "Failed to connect" if the
// StdioServerTransport isn't serving within its window -- so every second
// we can shave off startup matters. Heartwood-specific tools
// (heartwood_derive etc.) still work because nostr-tools' BunkerSigner
// sends arbitrary NIP-46 method names via sendRequest; the probe only
// controlled whether to expose those methods as typed instance methods
// on HeartwoodContext, which is a cosmetic distinction for MCP use.
let ctx: SigningContext
if (config.bunkerUri) {
  const { BunkerContext } = await import('./bunker-context.js')
  const base = await BunkerContext.connect(config.bunkerUri)
  await base.resolvePublicKey()
  ctx = base
  console.error(`Connected to bunker — signing as ${base.activeNpub}`)

  // Probe for Heartwood extensions in the background and upgrade in place.
  // Object.setPrototypeOf on the existing ctx instance lets tools that
  // check `ctx instanceof HeartwoodContext` see the upgraded class after
  // the probe resolves, without having to coordinate a ctx swap.
  ;(async () => {
    try {
      const { HeartwoodContext } = await import('./heartwood-context.js')
      const hw = await HeartwoodContext.probe(base)
      if (hw) {
        console.error(`Heartwood extensions detected — ${base.activeNpub}`)
      }
    } catch (e) {
      console.error('Heartwood probe failed (non-fatal):', (e as Error).message)
    }
  })()
} else {
  ctx = new IdentityContext(config.secretKey, config.secretFormat)
}

const trust = new TrustContext(ctx, pool, {
  cacheTtl: config.trustCacheTtl,
  cacheMax: config.trustCacheMax,
  trustMode: config.trustMode,
})

export const deps = {
  ctx, pool, nip65, trust,
  nwcUri: config.nwcUri,
  walletsFile: config.walletsFile,
  nip04Enabled: config.nip04Enabled,
}

;(config as any).secretKey = ''
;(config as any).nwcUri = undefined
;(config as any).bunkerUri = undefined

// Load master identity relay list in the background — don't block tool registration
nip65.loadForIdentity(ctx.activeNpub).then(masterRelays => {
  pool.reconfigure(ctx.activeNpub, masterRelays)
}).catch(e => console.error('NIP-65 relay load failed:', e.message))

const server = new McpServer({ name: 'nostr-bray', version: '0.1.0' }, {
  instructions: 'Always check whoami before posting or signing. Use signet-badge to check trust before interacting with unfamiliar pubkeys. Use trust-score for the full three-dimensional view (verification + proximity + access). Use social-feed or social-notifications to get event IDs and author pubkeys before calling social-reply or social-react. DMs default to NIP-17 gift wrap (most private); only use NIP-04 if the recipient requires it. Respect vault tiers -- do not share decrypted content outside its intended audience. For less common actions, use search-actions to discover them, then execute-action to run them.',
})

// Promoted tools are registered directly with the server (always visible to Claude).
// Everything else goes to the catalog, discoverable via search-actions + execute-action.
const PROMOTED = new Set([
  'whoami', 'social-post', 'social-reply', 'social-feed',
  'dm-send', 'dm-read', 'zap-send', 'zap-balance',
  'identity-switch', 'relay-query',
  'signet-badge', 'trust-score', 'vault-read',
  'dispatch-send', 'dispatch-check', 'dispatch-reply',
  'dispatch-ack', 'dispatch-status', 'dispatch-cancel',
  'dispatch-refuse', 'dispatch-failure', 'dispatch-query',
  'article-publish', 'article-read', 'article-list',
  'search-notes', 'search-profiles', 'hashtag-feed',
  'social-profile-get', 'dm-conversation', 'verify-person',
  'dispatch-propose', 'dispatch-capability-publish', 'dispatch-capability-discover', 'dispatch-capability-read',
  'badge-create', 'badge-award', 'badge-accept', 'badge-list',
  'community-create', 'community-feed', 'community-post', 'community-approve', 'community-list',
  'calendar-create', 'calendar-read', 'calendar-rsvp',
  'listing-create', 'listing-read', 'listing-search', 'listing-close',
])
const catalog = new ActionCatalog()
const proxy = createCatalogProxy(server, catalog, PROMOTED)

// Register all tools — the proxy routes promoted to server, rest to catalog
registerIdentityTools(proxy, deps)
registerSocialTools(proxy, deps)
registerTrustTools(proxy, deps)
registerRelayTools(proxy, deps)
registerRelayIntelligenceTools(proxy, deps)
registerZapTools(proxy, deps)
registerSafetyTools(proxy, deps)
registerUtilTools(proxy, deps)
registerWorkflowTools(proxy, {
  ctx: deps.ctx,
  pool: deps.pool,
  nip65: deps.nip65,
  veilCacheTtl: config.veilCacheTtl,
  veilCacheMax: config.veilCacheMax,
})
registerMarketplaceTools(proxy, deps)
registerPrivacyTools(proxy, deps)
registerModerationTools(proxy, deps)
registerSignetTools(proxy, deps)
registerVaultTools(proxy, deps)
registerDispatchTools(proxy, { ...deps, dispatchIdentitiesPath: config.dispatchIdentities })
registerHandlerTools(proxy, deps)

// Add search-actions and execute-action meta-tools to the real server
catalog.registerMetaTools(server)
console.error(`nostr-bray: ${PROMOTED.size} promoted tools + ${catalog.size} cataloged (${PROMOTED.size + catalog.size + 2} total)`)

if (config.transport === 'stdio') {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  await server.connect(new StdioServerTransport())
  console.error('nostr-bray started (stdio)')
} else {
  const { createServer } = await import('node:http')
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  )
  const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js')
  const { randomUUID, timingSafeEqual } = await import('node:crypto')

  const token = process.env.BRAY_HTTP_TOKEN ?? randomUUID()
  console.error(`nostr-bray HTTP auth token: ${token}`)

  const expectedAuth = Buffer.from(`Bearer ${token}`)

  // Sliding window rate limiter (per-IP).
  // Cap the map size so a caller rotating source IPs cannot grow it without
  // bound and exhaust memory — an IPv6-enabled attacker can mint free addresses
  // at line rate.
  const rateLimits = new Map<string, { count: number; resetAt: number }>()
  const RATE_WINDOW = 60_000 // 60 seconds
  const RATE_LIMIT = 100     // 100 requests per window
  const RATE_MAP_CAP = 10_000

  function checkRateLimit(ip: string): boolean {
    const now = Date.now()

    if (rateLimits.size >= RATE_MAP_CAP) {
      // Sweep expired entries first.
      for (const [k, v] of rateLimits) {
        if (now > v.resetAt) rateLimits.delete(k)
      }
      // If still over cap, drop oldest insertion-order entries.
      while (rateLimits.size >= RATE_MAP_CAP) {
        const oldest = rateLimits.keys().next().value
        if (oldest === undefined) break
        rateLimits.delete(oldest)
      }
    }

    const entry = rateLimits.get(ip)
    if (!entry || now > entry.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
      return true
    }
    entry.count++
    return entry.count <= RATE_LIMIT
  }

  // Session map — each MCP session gets its own transport.
  // The underlying McpServer is reused across sessions: when a session ends its
  // transport closes, which sets server._transport = undefined, allowing the next
  // session to call server.connect(newTransport).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions = new Map<string, any>()

  async function createSession() {
    // Close the current server connection so it can be reconnected below.
    if (server.isConnected()) await server.close()
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, t) },
    })
    t.onclose = () => { if (t.sessionId) sessions.delete(t.sessionId) }
    await server.connect(t)
    return t
  }

  const httpServer = createServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown'

    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: 'Too many requests' }))
      return
    }

    // Bearer token auth (constant-time comparison).
    // Length is folded into the constant-time compare via a padded buffer so
    // the timing of a wrong-length token does not differ from the timing of a
    // wrong-content token — neither short-circuits.
    const actual = Buffer.from(req.headers.authorization ?? '')
    const padded = Buffer.alloc(expectedAuth.length)
    actual.copy(padded, 0, 0, Math.min(actual.length, expectedAuth.length))
    const lengthMatch = actual.length === expectedAuth.length
    const contentMatch = timingSafeEqual(padded, expectedAuth)
    if (!lengthMatch || !contentMatch) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorised' }))
      return
    }

    // Security headers — no CORS headers = deny all cross-origin
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // Parse body for POST requests (1MB limit)
    let body: unknown
    if (req.method === 'POST') {
      const MAX_BODY = 1_048_576
      // Reject up-front based on Content-Length when the client declares a size.
      // Without the preflight, a malicious client can force a 1 MiB read before
      // the stream-based check catches up.
      const declared = Number.parseInt(req.headers['content-length'] ?? '', 10)
      if (Number.isFinite(declared) && declared > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Request body too large' }))
          return
        }
        chunks.push(chunk as Buffer)
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString())
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }
    }

    // Route to existing session or create a new one for initialize requests
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport = sessionId ? sessions.get(sessionId) : undefined

    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(body)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no active session' }, id: null }))
        return
      }
      transport = await createSession()
    }

    await transport.handleRequest(req, res, body)
  })

  httpServer.listen(config.port, config.bindAddress, () => {
    console.error(`nostr-bray HTTP on ${config.bindAddress}:${config.port}`)
  })
}

const shutdown = () => { ctx.destroy(); pool.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
