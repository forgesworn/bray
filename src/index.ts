#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from './config.js'
import { IdentityContext } from './context.js'
import { RelayPool } from './relay-pool.js'
import { Nip65Manager } from './nip65.js'

const config = loadConfig()
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
})
const nip65 = new Nip65Manager(pool, config.relays)
const ctx = new IdentityContext(config.secretKey, config.secretFormat)
export const deps = { ctx, pool, nip65 }

// Load master identity relay list
const masterRelays = await nip65.loadForIdentity(ctx.activeNpub)
pool.reconfigure(ctx.activeNpub, masterRelays)

const server = new McpServer({ name: 'nostr-bray', version: '0.1.0' })

// Tool registrations will go here (Phase 2+)

if (config.transport === 'stdio') {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  await server.connect(new StdioServerTransport())
  console.error('nostr-bray started (stdio)')
} else {
  console.error('HTTP transport not yet implemented')
  process.exit(1)
}

process.on('SIGINT', () => {
  ctx.destroy()
  pool.close()
  process.exit(0)
})
