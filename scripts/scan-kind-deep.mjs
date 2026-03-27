#!/usr/bin/env node
/**
 * Deep scan — show events that DON'T have kanban tags (b, col, status).
 * Usage: node scripts/scan-kind-deep.mjs <kind>
 */

import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import WS from 'ws'
import { nip19 } from 'nostr-tools'

useWebSocketImplementation(WS)

const kind = parseInt(process.argv[2], 10)
if (isNaN(kind)) {
  console.error('Usage: node scripts/scan-kind-deep.mjs <kind>')
  process.exit(1)
}

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

console.log(`Deep scan: kind ${kind} across ${RELAYS.length} relays...\n`)

const pool = new SimplePool()

try {
  const events = await pool.querySync(RELAYS, { kinds: [kind], limit: 500 })

  const seen = new Map()
  for (const e of events) {
    if (!seen.has(e.id)) seen.set(e.id, e)
  }
  const unique = [...seen.values()]

  console.log(`Total: ${unique.length} unique events\n`)

  // Split into kanban vs non-kanban
  const kanban = unique.filter(e => e.tags.some(t => t[0] === 'col' || t[0] === 'b'))
  const nonKanban = unique.filter(e => !e.tags.some(t => t[0] === 'col' || t[0] === 'b'))

  console.log(`Kanban (b/col tags): ${kanban.length}`)
  console.log(`Non-kanban: ${nonKanban.length}\n`)

  if (nonKanban.length > 0) {
    console.log('=== NON-KANBAN EVENTS ===\n')
    for (const e of nonKanban) {
      const npub = nip19.npubEncode(e.pubkey)
      console.log(JSON.stringify({
        id: e.id,
        pubkey: e.pubkey,
        npub,
        kind: e.kind,
        tags: e.tags,
        content: e.content.length > 500 ? e.content.slice(0, 500) + '...' : e.content,
        created_at: e.created_at,
        date: new Date(e.created_at * 1000).toISOString(),
      }, null, 2))
      console.log()
    }
  }

  // Per-pubkey breakdown
  console.log('=== PER-PUBKEY BREAKDOWN ===\n')
  const pubkeys = [...new Set(unique.map(e => e.pubkey))]
  for (const pk of pubkeys) {
    const pkEvents = unique.filter(e => e.pubkey === pk)
    const npub = nip19.npubEncode(pk)
    const isKanban = pkEvents.some(e => e.tags.some(t => t[0] === 'col'))
    const statuses = [...new Set(pkEvents.flatMap(e => e.tags.filter(t => t[0] === 'status').map(t => t[1])))]
    const tagNames = [...new Set(pkEvents.flatMap(e => e.tags.map(t => t[0])))]
    const dateRange = {
      first: new Date(Math.min(...pkEvents.map(e => e.created_at)) * 1000).toISOString().split('T')[0],
      last: new Date(Math.max(...pkEvents.map(e => e.created_at)) * 1000).toISOString().split('T')[0],
    }
    console.log(`${npub}`)
    console.log(`  Events: ${pkEvents.length} | Kanban: ${isKanban} | Tags: [${tagNames.join(', ')}]`)
    console.log(`  Statuses: [${statuses.join(', ')}] | Range: ${dateRange.first} → ${dateRange.last}`)
    console.log()
  }
} finally {
  pool.close(RELAYS)
  setTimeout(() => process.exit(0), 500)
}
