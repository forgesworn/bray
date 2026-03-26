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
import { registerZapTools } from './zap/tools.js'
import { registerSafetyTools } from './safety/tools.js'
import { registerUtilTools } from './util/tools.js'
import { registerWorkflowTools } from './workflow/tools.js'
import { ActionCatalog, createCatalogProxy } from './catalog.js'

const config = loadConfig()
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
})
const nip65 = new Nip65Manager(pool, config.relays)

// Connect to bunker or use local key
let ctx: IdentityContext | import('./bunker-context.js').BunkerContext
if (config.bunkerUri) {
  const { BunkerContext } = await import('./bunker-context.js')
  ctx = await BunkerContext.connect(config.bunkerUri)
  console.error(`Connected to bunker — signing as ${ctx.activeNpub}`)
} else {
  ctx = new IdentityContext(config.secretKey, config.secretFormat)
}

export const deps = { ctx: ctx as any, pool, nip65, nwcUri: config.nwcUri }

;(config as any).secretKey = ''
;(config as any).nwcUri = undefined
;(config as any).bunkerUri = undefined

// Load master identity relay list in the background — don't block tool registration
nip65.loadForIdentity(ctx.activeNpub).then(masterRelays => {
  pool.reconfigure(ctx.activeNpub, masterRelays)
}).catch(e => console.error('NIP-65 relay load failed:', e.message))

const server = new McpServer({ name: 'nostr-bray', version: '0.1.0' }, {
  instructions: 'Always check whoami before posting or signing. Use social-feed or social-notifications to get event IDs and author pubkeys before calling social-reply or social-react. DMs default to NIP-17 gift wrap (most private); only use NIP-04 if the recipient requires it. For less common actions (encoding, encryption, ring signatures, blossom, groups, NIPs, key management, safety), use search-actions to discover them, then execute-action to run them.',
})

// Promoted tools are registered directly with the server (always visible to Claude).
// Everything else goes to the catalog, discoverable via search-actions + execute-action.
const PROMOTED = new Set([
  'whoami', 'social-post', 'social-reply', 'social-feed',
  'dm-send', 'dm-read', 'zap-send', 'zap-balance',
  'identity-switch', 'relay-query',
])
const catalog = new ActionCatalog()
const proxy = createCatalogProxy(server, catalog, PROMOTED)

// Register all tools — the proxy routes promoted to server, rest to catalog
registerIdentityTools(proxy, deps)
registerSocialTools(proxy, deps)
registerTrustTools(proxy, deps)
registerRelayTools(proxy, deps)
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
  const { randomUUID } = await import('node:crypto')

  const token = randomUUID()
  console.error(`nostr-bray HTTP auth token: ${token}`)

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)

  const { timingSafeEqual } = await import('node:crypto')
  const expectedAuth = Buffer.from(`Bearer ${token}`)

  // Sliding window rate limiter (per-IP)
  const rateLimits = new Map<string, { count: number; resetAt: number }>()
  const RATE_WINDOW = 60_000 // 60 seconds
  const RATE_LIMIT = 100     // 100 requests per window

  function checkRateLimit(ip: string): boolean {
    const now = Date.now()
    const entry = rateLimits.get(ip)
    if (!entry || now > entry.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
      return true
    }
    entry.count++
    return entry.count <= RATE_LIMIT
  }

  const httpServer = createServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown'

    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: 'Too many requests' }))
      return
    }

    // Bearer token auth (constant-time comparison)
    const actual = Buffer.from(req.headers.authorization ?? '')
    if (actual.length !== expectedAuth.length || !timingSafeEqual(actual, expectedAuth)) {
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
    if (req.method === 'POST') {
      const MAX_BODY = 1_048_576
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
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString())
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }
      await transport.handleRequest(req, res, body)
    } else {
      await transport.handleRequest(req, res)
    }
  })

  httpServer.listen(config.port, config.bindAddress, () => {
    console.error(`nostr-bray HTTP on ${config.bindAddress}:${config.port}`)
  })
}

const shutdown = () => { ctx.destroy(); pool.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
