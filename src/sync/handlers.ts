/**
 * Sync — filter-based event synchronisation between a local store and a remote relay.
 *
 * Pull: fetch events matching a filter from a remote relay.
 * Push: broadcast a set of locally-known events (supplied as a JSONL file) to a remote relay.
 *
 * Negentropy is not yet available in nostr-tools; a standard REQ-based diff approach is used.
 */

import type { Filter, Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import { readFileSync } from 'node:fs'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncPullOptions {
  /** Target relay URL (wss:// or ws://) */
  relay: string
  /** Event kinds to fetch */
  kinds?: number[]
  /** Restrict to these authors (hex pubkeys) */
  authors?: string[]
  /** Unix timestamp lower bound */
  since?: number
  /** Maximum number of events to return */
  limit?: number
}

export interface SyncPullResult {
  relay: string
  events: NostrEvent[]
  count: number
}

export interface SyncPushOptions {
  /** Target relay URL */
  relay: string
  /** Path to a JSONL file — one JSON-serialised Nostr event per line */
  eventsFile: string
}

export interface SyncPushResult {
  relay: string
  attempted: number
  succeeded: number
  failed: number
  results: Array<{ id: string; success: boolean; error?: string }>
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Pull events from a remote relay that match the given filter.
 *
 * @param pool - Active relay pool
 * @param activeNpub - npub of the active identity (used for pool routing)
 * @param opts - Filter options and target relay URL
 */
export async function handleSyncPull(
  pool: RelayPool,
  _activeNpub: string,
  opts: SyncPullOptions,
): Promise<SyncPullResult> {
  const filter: Filter = {}
  if (opts.kinds?.length) filter.kinds = opts.kinds
  if (opts.authors?.length) filter.authors = opts.authors
  if (opts.since !== undefined) filter.since = opts.since
  if (opts.limit !== undefined) filter.limit = opts.limit

  const events: NostrEvent[] = await pool.queryDirect([opts.relay], filter)

  return {
    relay: opts.relay,
    events,
    count: events.length,
  }
}

/**
 * Push locally-known events to a remote relay.
 *
 * Reads a JSONL file (one Nostr event JSON per line), publishes each event, and
 * returns a per-event result summary.
 *
 * @param pool - Active relay pool
 * @param opts - Target relay and path to the JSONL file
 */
export async function handleSyncPush(
  pool: RelayPool,
  opts: SyncPushOptions,
): Promise<SyncPushResult> {
  const raw = readFileSync(opts.eventsFile, 'utf-8')
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const events: NostrEvent[] = lines.map((line, i) => {
    try {
      return JSON.parse(line) as NostrEvent
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1} of ${opts.eventsFile}`)
    }
  })

  const results: Array<{ id: string; success: boolean; error?: string }> = []
  let succeeded = 0
  let failed = 0

  for (const ev of events) {
    try {
      const result: PublishResult = await pool.publishDirect([opts.relay], ev)
      const ok = result.success
      results.push({ id: ev.id ?? 'unknown', success: ok })
      if (ok) succeeded++; else failed++
    } catch (err) {
      failed++
      results.push({ id: ev.id ?? 'unknown', success: false, error: (err as Error).message })
    }
  }

  return {
    relay: opts.relay,
    attempted: events.length,
    succeeded,
    failed,
    results,
  }
}
