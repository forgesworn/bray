#!/usr/bin/env node
/**
 * nostr-bray CLI — standalone Nostr identity management from the terminal.
 *
 * Usage:
 *   nostr-bray                          Start MCP server (default)
 *   nostr-bray post "hello nostr"       Post a text note
 *   nostr-bray reply <event-id> "text"  Reply to an event
 *   nostr-bray react <event-id>         React to an event (+)
 *   nostr-bray derive <purpose>         Derive a child identity
 *   nostr-bray persona <name>           Derive a named persona
 *   nostr-bray switch <target>          Switch active identity
 *   nostr-bray list                     List all identities
 *   nostr-bray prove [blind|full]       Create a linkage proof
 *   nostr-bray profile <pubkey-hex>     Fetch a profile
 *   nostr-bray relay-info <url>         Fetch NIP-11 relay info
 *   nostr-bray backup <dir>             Shamir backup (threshold=3, shares=5)
 *   nostr-bray whoami                   Show active identity npub
 */

import { loadConfig } from './config.js'
import { IdentityContext } from './context.js'
import { RelayPool } from './relay-pool.js'
import { Nip65Manager } from './nip65.js'
import { handleSocialPost, handleSocialReply, handleSocialReact, handleSocialProfileGet } from './social/handlers.js'
import { handleIdentityList, handleIdentityProve } from './identity/handlers.js'
import { handleBackupShamir } from './identity/shamir.js'
import { handleRelayInfo } from './relay/handlers.js'

const args = process.argv.slice(2)
const command = args[0]

// No command = start MCP server (default behaviour)
if (!command || command === 'serve') {
  await import('./index.js')
  process.exit(0)
}

// Help — no config needed
if (command === 'help' || command === '--help' || command === '-h') {
  console.log('nostr-bray — Sovereign Nostr identities for AI agents')
  console.log('')
  console.log('Usage: nostr-bray [command] [args]')
  console.log('')
  console.log('Commands:')
  console.log('  (no command)                  Start MCP server (stdio)')
  console.log('  whoami                        Show active identity npub')
  console.log('  list                          List all identities')
  console.log('  derive <purpose> [index]      Derive a child identity')
  console.log('  persona <name> [index]        Derive a named persona')
  console.log('  switch <target> [index]       Switch active identity')
  console.log('  prove [blind|full]            Create a linkage proof')
  console.log('  post "message"                Post a text note')
  console.log('  reply <event-id> "text"       Reply to an event')
  console.log('  react <event-id> [reaction]   React to an event')
  console.log('  profile <pubkey-hex>          Fetch a profile')
  console.log('  relay-info <wss://url>        Fetch NIP-11 relay info')
  console.log('  backup <dir> [t] [n]          Shamir backup (default 3-of-5)')
  console.log('')
  console.log('Environment:')
  console.log('  NOSTR_SECRET_KEY              nsec, hex, or BIP-39 mnemonic')
  console.log('  NOSTR_SECRET_KEY_FILE         Path to secret key file')
  console.log('  NOSTR_RELAYS                  Comma-separated relay URLs')
  process.exit(0)
}

// CLI commands need config + context
const config = loadConfig()
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
})
const nip65 = new Nip65Manager(pool, config.relays)
const ctx = new IdentityContext(config.secretKey, config.secretFormat)

// Clear secrets
;(config as any).secretKey = ''
;(config as any).nwcUri = undefined

// Load master relay list
const masterRelays = await nip65.loadForIdentity(ctx.activeNpub)
pool.reconfigure(ctx.activeNpub, masterRelays)

async function run(): Promise<void> {
  switch (command) {
    case 'whoami': {
      console.log(ctx.activeNpub)
      break
    }

    case 'list': {
      const identities = handleIdentityList(ctx)
      console.log(JSON.stringify(identities, null, 2))
      break
    }

    case 'derive': {
      const purpose = args[1]
      if (!purpose) { console.error('Usage: nostr-bray derive <purpose> [index]'); process.exit(1) }
      const index = parseInt(args[2] ?? '0', 10)
      const result = ctx.derive(purpose, index)
      console.log(JSON.stringify(result, null, 2))
      break
    }

    case 'persona': {
      const name = args[1]
      if (!name) { console.error('Usage: nostr-bray persona <name> [index]'); process.exit(1) }
      const index = parseInt(args[2] ?? '0', 10)
      const result = ctx.derivePersona(name, index)
      console.log(JSON.stringify(result, null, 2))
      break
    }

    case 'switch': {
      const target = args[1]
      if (!target) { console.error('Usage: nostr-bray switch <target> [index]'); process.exit(1) }
      const index = args[2] ? parseInt(args[2], 10) : undefined
      ctx.switch(target, index)
      console.log(ctx.activeNpub)
      break
    }

    case 'prove': {
      const mode = (args[1] === 'full' ? 'full' : 'blind') as 'blind' | 'full'
      const proof = handleIdentityProve(ctx, { mode })
      console.log(JSON.stringify(proof, null, 2))
      break
    }

    case 'post': {
      const content = args[1]
      if (!content) { console.error('Usage: nostr-bray post "your message"'); process.exit(1) }
      const result = await handleSocialPost(ctx, pool, { content })
      console.log(JSON.stringify({ id: result.event.id, pubkey: result.event.pubkey, publish: result.publish }, null, 2))
      break
    }

    case 'reply': {
      const eventId = args[1]
      const content = args[2]
      if (!eventId || !content) { console.error('Usage: nostr-bray reply <event-id> "your reply"'); process.exit(1) }
      const result = await handleSocialReply(ctx, pool, {
        content,
        replyTo: eventId,
        replyToPubkey: '', // simplified for CLI
      })
      console.log(JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2))
      break
    }

    case 'react': {
      const eventId = args[1]
      if (!eventId) { console.error('Usage: nostr-bray react <event-id> [reaction]'); process.exit(1) }
      const result = await handleSocialReact(ctx, pool, {
        eventId,
        eventPubkey: '',
        reaction: args[2] ?? '+',
      })
      console.log(JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2))
      break
    }

    case 'profile': {
      const pubkeyHex = args[1]
      if (!pubkeyHex) { console.error('Usage: nostr-bray profile <pubkey-hex>'); process.exit(1) }
      const profile = await handleSocialProfileGet(pool, ctx.activeNpub, pubkeyHex)
      console.log(JSON.stringify(profile, null, 2))
      break
    }

    case 'relay-info': {
      const url = args[1]
      if (!url) { console.error('Usage: nostr-bray relay-info <wss://relay-url>'); process.exit(1) }
      const info = await handleRelayInfo(url)
      console.log(JSON.stringify(info, null, 2))
      break
    }

    case 'backup': {
      const dir = args[1]
      if (!dir) { console.error('Usage: nostr-bray backup <output-dir> [threshold] [shares]'); process.exit(1) }
      const threshold = parseInt(args[2] ?? '3', 10)
      const shares = parseInt(args[3] ?? '5', 10)
      const result = handleBackupShamir({
        secret: new Uint8Array(ctx.activePrivateKey),
        threshold,
        shares,
        outputDir: dir,
      })
      console.log(JSON.stringify(result, null, 2))
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      console.error('')
      console.error('Commands:')
      console.error('  whoami                        Show active identity npub')
      console.error('  list                          List all identities')
      console.error('  derive <purpose> [index]      Derive a child identity')
      console.error('  persona <name> [index]        Derive a named persona')
      console.error('  switch <target> [index]       Switch active identity')
      console.error('  prove [blind|full]            Create a linkage proof')
      console.error('  post "message"                Post a text note')
      console.error('  reply <event-id> "text"       Reply to an event')
      console.error('  react <event-id> [reaction]   React to an event')
      console.error('  profile <pubkey-hex>          Fetch a profile')
      console.error('  relay-info <wss://url>        Fetch NIP-11 relay info')
      console.error('  backup <dir> [t] [n]          Shamir backup (default 3-of-5)')
      console.error('')
      console.error('No command = start MCP server (stdio)')
      process.exit(1)
  }
}

try {
  await run()
} finally {
  ctx.destroy()
  pool.close()
}
