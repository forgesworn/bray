/**
 * NIP-77 reconciliation plus explicit REQ/EVENT transfer operations.
 *
 * Negentropy reconciles event IDs only. Pulling and pushing are deliberately
 * separate phases so callers can inspect a read-only plan before mutating a
 * relay or local store.
 */

import { readFileSync, statSync } from 'node:fs'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { matchFilter, verifyEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import { Nip77UnavailableError } from '../relay-pool.js'
import { assertEventSemanticallyValid } from '../event-validation/validator.js'
import { nostrEventSchema, validateInputPath } from '../validation.js'

export type SyncProtocol = 'nip77' | 'req-fallback'
export type SyncProtocolPreference = 'auto' | SyncProtocol

const DEFAULT_MAX_IDS = 1_000
const DEFAULT_MAX_REMOTE_EVENTS = 10_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_LOCAL_EVENTS = 50_000
const MAX_INPUT_BYTES = 64 * 1024 * 1024
const FETCH_BATCH_SIZE = 500

export interface SyncPlanOptions {
  /** Target relay URL. */
  relay: string
  /** In-memory local event set (SDK/MCP). */
  events?: NostrEvent[]
  /** JSONL local event set (CLI); use '-' for stdin. */
  eventsFile?: string
  /** Nostr filter reconciled by both sides. */
  filter?: Filter
  /** Convenience filter fields retained for CLI compatibility. */
  kinds?: number[]
  authors?: string[]
  since?: number
  until?: number
  /** Maximum IDs retained in each result list. Counts may be larger. */
  maxIds?: number
  /** REQ fallback scan bound. */
  maxRemoteEvents?: number
  /** Network deadline for each reconciliation/transfer phase. */
  timeoutMs?: number
  /** Force NIP-77, force REQ, or try NIP-77 then fall back. */
  protocol?: SyncProtocolPreference
  signal?: AbortSignal
}

export interface SyncPlanResult {
  relay: string
  filter: Filter
  protocol: SyncProtocol
  localEventCount: number
  localOnlyIds: string[]
  remoteOnlyIds: string[]
  localOnlyCount: number
  remoteOnlyCount: number
  /** True only when the full comparison completed, not merely the bounded output. */
  complete: boolean
  /** True when one or both ID arrays omit IDs reported by reconciliation. */
  truncated: boolean
  warnings: string[]
}

export interface SyncPullOptions extends SyncPlanOptions {
  /** Backwards-compatible alias for maxIds. */
  limit?: number
}

export interface SyncPullResult {
  relay: string
  protocol: SyncProtocol
  plan: SyncPlanResult
  events: NostrEvent[]
  count: number
  transferComplete: boolean
}

export interface SyncPushOptions extends SyncPlanOptions {}

export interface SyncPushResult {
  relay: string
  protocol: SyncProtocol
  plan: SyncPlanResult
  attempted: number
  succeeded: number
  failed: number
  transferComplete: boolean
  results: Array<{ id: string; success: boolean; error?: string }>
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`)
  }
  return resolved
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Sync operation was cancelled', 'AbortError')
}

export function buildSyncFilter(opts: Pick<SyncPlanOptions, 'filter' | 'kinds' | 'authors' | 'since' | 'until'>): Filter {
  const filter: Filter = { ...(opts.filter ?? {}) }
  if (opts.kinds?.length) filter.kinds = opts.kinds
  if (opts.authors?.length) filter.authors = opts.authors
  if (opts.since !== undefined) filter.since = opts.since
  if (opts.until !== undefined) filter.until = opts.until
  // A REQ limit is not a reconciliation boundary. Output/scan limits are
  // represented separately and reported truthfully.
  delete filter.limit
  return filter
}

export function parseEventJsonl(raw: string, source = '<input>'): NostrEvent[] {
  const events: NostrEvent[] = []
  const seen = new Set<string>()
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line) continue
    if (events.length >= MAX_LOCAL_EVENTS) throw new Error(`${source} exceeds the ${MAX_LOCAL_EVENTS}-event input limit`)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1} of ${source}`)
    }
    const event = validateSyncEvent(value, `${source}:${index + 1}`)
    if (!seen.has(event.id)) {
      seen.add(event.id)
      events.push(event)
    }
  }
  return events
}

export function validateSyncEvent(value: unknown, source = '<event>'): NostrEvent {
  const parsed = nostrEventSchema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid Nostr event at ${source}: ${detail}`)
  }
  const event = parsed.data as NostrEvent
  if (!verifyEvent(event)) throw new Error(`Invalid Nostr event signature or ID at ${source}`)
  assertEventSemanticallyValid(event)
  return event
}

export function loadSyncEvents(opts: Pick<SyncPlanOptions, 'events' | 'eventsFile'>): NostrEvent[] {
  if (opts.events && opts.eventsFile) throw new Error('Provide events or eventsFile, not both')
  if (opts.events) {
    if (opts.events.length > MAX_LOCAL_EVENTS) throw new Error(`events exceeds the ${MAX_LOCAL_EVENTS}-event input limit`)
    const seen = new Set<string>()
    return opts.events
      .map((event, index) => validateSyncEvent(event, `events[${index}]`))
      .filter(event => {
        if (seen.has(event.id)) return false
        seen.add(event.id)
        return true
      })
  }
  if (!opts.eventsFile) return []
  if (opts.eventsFile === '-') return parseEventJsonl(readFileSync(0, 'utf8'), '<stdin>')
  const path = validateInputPath(opts.eventsFile)
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error(`Event input exceeds Bray's ${MAX_INPUT_BYTES}-byte limit`)
  return parseEventJsonl(readFileSync(path, 'utf8'), path)
}

function retainBounded(ids: Iterable<string>, maxIds: number): { ids: string[]; count: number; truncated: boolean } {
  const output: string[] = []
  let count = 0
  for (const id of ids) {
    count++
    if (output.length < maxIds) output.push(id)
  }
  return { ids: output, count, truncated: count > maxIds }
}

/** Read-only comparison of local IDs and relay IDs. No events are transferred. */
export async function handleSyncPlan(pool: RelayPool, opts: SyncPlanOptions): Promise<SyncPlanResult> {
  throwIfAborted(opts.signal)
  const maxIds = boundedInteger(opts.maxIds, DEFAULT_MAX_IDS, 1, 10_000, 'maxIds')
  const maxRemoteEvents = boundedInteger(
    opts.maxRemoteEvents,
    DEFAULT_MAX_REMOTE_EVENTS,
    1,
    50_000,
    'maxRemoteEvents',
  )
  const timeoutMs = boundedInteger(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 120_000, 'timeoutMs')
  const filter = buildSyncFilter(opts)
  const localEvents = loadSyncEvents(opts).filter(event => matchFilter(filter, event))
  const preference = opts.protocol ?? 'auto'
  const warnings: string[] = []

  if (preference !== 'req-fallback') {
    try {
      const diff = await pool.reconcileDirect(
        opts.relay,
        localEvents.map(event => ({ id: event.id, createdAt: event.created_at })),
        filter,
        { timeoutMs, signal: opts.signal, maxIds },
      )
      return {
        relay: opts.relay,
        filter,
        protocol: 'nip77',
        localEventCount: localEvents.length,
        ...diff,
        complete: true,
        warnings,
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      if (preference === 'nip77') throw error
      const reason = error instanceof Nip77UnavailableError ? error.message : (error as Error).message
      warnings.push(`NIP-77 unavailable; used bounded REQ fallback: ${reason}`)
    }
  } else {
    warnings.push('REQ fallback was explicitly requested; comparison may be incomplete at its scan bound.')
  }

  throwIfAborted(opts.signal)
  const remoteEvents = await pool.queryDirect(
    [opts.relay],
    { ...filter, limit: maxRemoteEvents },
    { timeoutMs, signal: opts.signal },
  )
  throwIfAborted(opts.signal)
  const remoteIds = new Set<string>()
  for (const value of remoteEvents) {
    const event = validateSyncEvent(value, `relay ${opts.relay}`)
    if (matchFilter(filter, event)) remoteIds.add(event.id)
  }
  const localIds = new Set(localEvents.map(event => event.id))
  const localOnly = retainBounded([...localIds].filter(id => !remoteIds.has(id)), maxIds)
  const remoteOnly = retainBounded([...remoteIds].filter(id => !localIds.has(id)), maxIds)
  const scanBoundReached = remoteEvents.length >= maxRemoteEvents
  if (scanBoundReached) warnings.push(`REQ fallback reached its ${maxRemoteEvents}-event scan bound; the diff may be incomplete.`)

  return {
    relay: opts.relay,
    filter,
    protocol: 'req-fallback',
    localEventCount: localEvents.length,
    localOnlyIds: localOnly.ids,
    remoteOnlyIds: remoteOnly.ids,
    localOnlyCount: localOnly.count,
    remoteOnlyCount: remoteOnly.count,
    complete: !scanBoundReached,
    truncated: localOnly.truncated || remoteOnly.truncated,
    warnings,
  }
}

/** Plan, then fetch the remote-only IDs via ordinary REQ messages. */
export async function handleSyncPull(
  pool: RelayPool,
  _activeNpub: string,
  opts: SyncPullOptions,
): Promise<SyncPullResult> {
  const maxIds = opts.maxIds ?? opts.limit
  const plan = await handleSyncPlan(pool, { ...opts, maxIds })
  const timeoutMs = boundedInteger(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 120_000, 'timeoutMs')
  const events = new Map<string, NostrEvent>()
  const deadline = Date.now() + timeoutMs

  for (let index = 0; index < plan.remoteOnlyIds.length; index += FETCH_BATCH_SIZE) {
    throwIfAborted(opts.signal)
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Sync pull timed out after ${timeoutMs}ms`)
    const ids = plan.remoteOnlyIds.slice(index, index + FETCH_BATCH_SIZE)
    const fetched = await pool.queryDirect(
      [opts.relay],
      { ...plan.filter, ids, limit: ids.length },
      { timeoutMs: remaining, signal: opts.signal },
    )
    for (const value of fetched) {
      const event = validateSyncEvent(value, `relay ${opts.relay}`)
      if (ids.includes(event.id)) events.set(event.id, event)
    }
  }

  const ordered = plan.remoteOnlyIds.flatMap(id => events.get(id) ? [events.get(id)!] : [])
  return {
    relay: opts.relay,
    protocol: plan.protocol,
    plan,
    events: ordered,
    count: ordered.length,
    transferComplete: plan.complete && !plan.truncated && ordered.length === plan.remoteOnlyCount,
  }
}

/** Plan, then publish the local-only IDs using ordinary EVENT messages. */
export async function handleSyncPush(pool: RelayPool, opts: SyncPushOptions): Promise<SyncPushResult> {
  const localEvents = loadSyncEvents(opts)
  const eventById = new Map(localEvents.map(event => [event.id, event]))
  const plan = await handleSyncPlan(pool, { ...opts, events: localEvents, eventsFile: undefined })
  const timeoutMs = boundedInteger(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 120_000, 'timeoutMs')
  const deadline = Date.now() + timeoutMs
  const results: Array<{ id: string; success: boolean; error?: string }> = []
  let succeeded = 0
  let failed = 0

  for (const id of plan.localOnlyIds) {
    throwIfAborted(opts.signal)
    const event = eventById.get(id)
    if (!event) {
      failed++
      results.push({ id, success: false, error: 'Local event disappeared after planning' })
      continue
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Sync push timed out after ${timeoutMs}ms`)
    try {
      const publish = await pool.publishDirect([opts.relay], event, { timeoutMs: remaining, signal: opts.signal })
      results.push({ id, success: publish.success, ...(!publish.success ? { error: publish.errors.join('; ') || 'relay rejected event' } : {}) })
      if (publish.success) succeeded++
      else failed++
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      failed++
      results.push({ id, success: false, error: (error as Error).message })
    }
  }

  return {
    relay: opts.relay,
    protocol: plan.protocol,
    plan,
    attempted: results.length,
    succeeded,
    failed,
    transferComplete: plan.complete && !plan.truncated && failed === 0 && results.length === plan.localOnlyCount,
    results,
  }
}
