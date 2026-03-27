#!/usr/bin/env node
/**
 * Quick relay scanner — find events of a specific kind across major relays.
 * Usage: node scripts/scan-kind.mjs <kind> [limit]
 * Example: node scripts/scan-kind.mjs 30301 100
 */

import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import WS from 'ws'

useWebSocketImplementation(WS)

const kind = parseInt(process.argv[2], 10)
if (isNaN(kind)) {
  console.error('Usage: node scripts/scan-kind.mjs <kind> [limit]')
  process.exit(1)
}
const limit = parseInt(process.argv[3] || '100', 10)

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.nostr.bg',
  'wss://nostr-pub.wellorder.net',
  'wss://eden.nostr.land',
]

console.log(`Scanning ${RELAYS.length} relays for kind ${kind} (limit ${limit})...\n`)

const pool = new SimplePool()

try {
  const events = await pool.querySync(RELAYS, { kinds: [kind], limit })

  if (events.length === 0) {
    console.log('No events found.')
  } else {
    // Deduplicate by event id
    const seen = new Map()
    for (const e of events) {
      if (!seen.has(e.id)) seen.set(e.id, e)
    }
    const unique = [...seen.values()]

    console.log(`Found ${unique.length} unique events.\n`)

    // Summary: unique pubkeys
    const pubkeys = new Set(unique.map(e => e.pubkey))
    console.log(`Publishers: ${pubkeys.size} unique pubkey(s)`)
    for (const pk of pubkeys) {
      const count = unique.filter(e => e.pubkey === pk).length
      console.log(`  ${pk} (${count} events)`)
    }

    // Tag analysis
    const tagNames = new Map()
    for (const e of unique) {
      for (const tag of e.tags) {
        const name = tag[0]
        tagNames.set(name, (tagNames.get(name) || 0) + 1)
      }
    }
    console.log(`\nTag frequency:`)
    for (const [name, count] of [...tagNames.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: ${count}`)
    }

    // Print first 5 events in detail
    console.log(`\n--- First ${Math.min(5, unique.length)} events ---\n`)
    for (const e of unique.slice(0, 5)) {
      console.log(JSON.stringify({
        id: e.id,
        pubkey: e.pubkey,
        kind: e.kind,
        tags: e.tags,
        content: e.content.length > 300 ? e.content.slice(0, 300) + '...' : e.content,
        created_at: e.created_at,
        date: new Date(e.created_at * 1000).toISOString(),
      }, null, 2))
      console.log()
    }
  }
} finally {
  pool.close(RELAYS)
  // Force exit — SimplePool keeps connections alive
  setTimeout(() => process.exit(0), 500)
}
