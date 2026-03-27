#!/usr/bin/env node
/**
 * Kind discovery scanner — find unusual/new kinds on Nostr relays.
 * Scans the addressable range (30000-39999) in chunks, tallies kind frequencies,
 * and highlights anything not in the well-known NIP kind table.
 *
 * Usage: node scripts/discover-kinds.mjs [--since=24h] [--attestation-like]
 */

import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import { nip19 } from 'nostr-tools'
import WS from 'ws'

useWebSocketImplementation(WS)

// Well-known addressable kinds from merged NIPs (as of March 2026)
const KNOWN_KINDS = new Map([
  [30000, 'Follow sets (NIP-51)'],
  [30001, 'Generic lists (NIP-51)'],
  [30002, 'Relay sets (NIP-51)'],
  [30003, 'Bookmark sets (NIP-51)'],
  [30004, 'Curation sets (NIP-51)'],
  [30008, 'Profile badges (NIP-58)'],
  [30009, 'Badge definition (NIP-58)'],
  [30015, 'Interest sets (NIP-51)'],
  [30017, 'Stall (NIP-15)'],
  [30018, 'Product (NIP-15)'],
  [30019, 'Marketplace UI/UX (NIP-15)'],
  [30023, 'Long-form content (NIP-23)'],
  [30024, 'Draft long-form content (NIP-23)'],
  [30030, 'Custom emoji set'],
  [30040, 'Curated publication index (NKBIP-01)'],
  [30041, 'Curated publication content (NKBIP-01)'],
  [30063, 'Release artifact sets (NIP-51)'],
  [30078, 'Application-specific data (NIP-78)'],
  [30311, 'Live event (NIP-53)'],
  [30315, 'User statuses (NIP-38)'],
  [30382, 'Trusted assertion (NIP-85)'],
  [30383, 'Trust threshold (NIP-85)'],
  [30388, 'Algo curation set'],
  [30402, 'Classified listing (NIP-99)'],
  [30617, 'Git repository (NIP-34)'],
  [30618, 'Git issue (NIP-34)'],
  [30818, 'Wiki article (NIP-54)'],
  [30819, 'Redirect (NIP-54)'],
  [31000, 'Verifiable attestation (NIP-VA)'],
  [31388, 'Live chat message'],
  [31402, 'L402 service announcement'],
  [31890, 'Feed definition'],
  [31922, 'Calendar date event (NIP-52)'],
  [31923, 'Calendar time event (NIP-52)'],
  [31924, 'Calendar (NIP-52)'],
  [31925, 'Calendar RSVP (NIP-52)'],
  [31989, 'Handler recommendation (NIP-89)'],
  [31990, 'Handler information (NIP-89)'],
  [34550, 'Community definition (NIP-72)'],
  [39000, 'Group metadata (NIP-29)'],
  [39001, 'Group admins (NIP-29)'],
  [39002, 'Group members (NIP-29)'],
])

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.wine',
]

// Parse args
const sinceArg = process.argv.find(a => a.startsWith('--since='))
const sinceHours = sinceArg ? parseInt(sinceArg.split('=')[1]) : 168 // default 7 days
const since = Math.floor(Date.now() / 1000) - (sinceHours * 3600)
const attestationLike = process.argv.includes('--attestation-like')

console.log(`Scanning ${RELAYS.length} relays for addressable kinds (30000-39999)`)
console.log(`Since: ${new Date(since * 1000).toISOString()} (${sinceHours}h ago)`)
if (attestationLike) console.log('Filtering for attestation-like tag patterns')
console.log()

const pool = new SimplePool()

// Scan in chunks of 100 kinds
const kindCounts = new Map()
const kindExamples = new Map()
const allEvents = []

const ranges = []
for (let start = 30000; start < 40000; start += 200) {
  const kinds = []
  for (let k = start; k < start + 200 && k < 40000; k++) {
    kinds.push(k)
  }
  ranges.push(kinds)
}

console.log(`Scanning ${ranges.length} kind ranges...`)

let scanned = 0
for (const kinds of ranges) {
  try {
    const events = await pool.querySync(RELAYS, { kinds, since, limit: 200 })
    for (const e of events) {
      const existing = kindCounts.get(e.kind) || { count: 0, pubkeys: new Set(), ids: new Set() }
      if (!existing.ids.has(e.id)) {
        existing.count++
        existing.pubkeys.add(e.pubkey)
        existing.ids.add(e.id)
        kindCounts.set(e.kind, existing)
        if (!kindExamples.has(e.kind)) kindExamples.set(e.kind, e)
        allEvents.push(e)
      }
    }
  } catch {
    // Some relays reject large kind arrays — continue
  }
  scanned++
  if (scanned % 10 === 0) process.stderr.write(`  ${scanned}/${ranges.length} ranges scanned (${kindCounts.size} kinds found)\r`)
}

console.log(`\nDone. Found ${kindCounts.size} distinct kinds, ${allEvents.length} total events.\n`)

// Sort by count descending
const sorted = [...kindCounts.entries()].sort((a, b) => b[1].count - a[1].count)

// Summary table
console.log('Kind   | Events | Pubkeys | Known NIP?                          | New?')
console.log('-------|--------|---------|-------------------------------------|-----')
for (const [kind, data] of sorted) {
  const known = KNOWN_KINDS.get(kind)
  const isNew = !known
  const flag = isNew ? ' <<<' : ''
  console.log(
    `${String(kind).padEnd(6)} | ${String(data.count).padStart(6)} | ${String(data.pubkeys.size).padStart(7)} | ${(known || '???').padEnd(35)} | ${flag}`
  )
}

// Detail on unknown kinds
const unknowns = sorted.filter(([kind]) => !KNOWN_KINDS.has(kind))
if (unknowns.length > 0) {
  console.log(`\n\n=== ${unknowns.length} UNKNOWN KINDS ===\n`)
  for (const [kind, data] of unknowns) {
    const example = kindExamples.get(kind)
    const tagNames = new Map()
    // Aggregate tags from all events of this kind
    const kindEvents = allEvents.filter(e => e.kind === kind)
    for (const e of kindEvents) {
      for (const tag of e.tags) {
        tagNames.set(tag[0], (tagNames.get(tag[0]) || 0) + 1)
      }
    }

    // Check for attestation-like patterns
    const hasP = tagNames.has('p')
    const hasType = tagNames.has('type')
    const hasStatus = tagNames.has('status')
    const hasV = tagNames.has('v')
    const hasExpiration = tagNames.has('expiration')
    const attestationScore = [hasP, hasType, hasStatus, hasV, hasExpiration].filter(Boolean).length

    if (attestationLike && attestationScore === 0) continue

    const npub = nip19.npubEncode(example.pubkey)
    console.log(`--- Kind ${kind} (${data.count} events, ${data.pubkeys.size} pubkeys) ---`)
    console.log(`  Tags: ${[...tagNames.entries()].map(([k, v]) => `${k}(${v})`).join(', ')}`)
    if (attestationScore > 0) {
      console.log(`  Attestation signals: ${attestationScore}/5 (${[hasP && 'p', hasType && 'type', hasStatus && 'status', hasV && 'v', hasExpiration && 'expiration'].filter(Boolean).join(', ')})`)
    }
    console.log(`  First pubkey: ${npub}`)
    console.log(`  Example event:`)
    console.log(JSON.stringify({
      id: example.id,
      kind: example.kind,
      tags: example.tags,
      content: example.content.length > 200 ? example.content.slice(0, 200) + '...' : example.content,
      created_at: example.created_at,
      date: new Date(example.created_at * 1000).toISOString(),
    }, null, 2))
    console.log()
  }
}

pool.close(RELAYS)
setTimeout(() => process.exit(0), 1000)
