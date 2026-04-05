import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'

const DEFAULT_QUEUE_DIR = join(homedir(), '.config', 'bray', 'scheduled')

export interface ScheduledEvent {
  scheduledAt: number
  event: NostrEvent
  relays: string[]
}

export interface ScheduleResult {
  scheduled: true
  scheduledAt: number
  eventId: string
  filePath: string
}

export interface QueueEntry {
  scheduledAt: number
  eventId: string
  kind: number
  content: string
  filePath: string
}

export interface CancelResult {
  cancelled: true
  eventId: string
}

export interface PublishScheduledResult {
  published: number
  failed: number
  remaining: number
}

/** Parse a scheduledAt value (ISO string or Unix timestamp) to Unix timestamp */
function parseScheduledAt(scheduledAt: string | number): number {
  if (typeof scheduledAt === 'number') return scheduledAt
  // ISO string
  const parsed = Date.parse(scheduledAt)
  if (isNaN(parsed)) throw new Error(`Invalid scheduledAt: "${scheduledAt}" — expected ISO datetime or Unix timestamp`)
  return Math.floor(parsed / 1000)
}

/** Schedule a Nostr event for future publication */
export async function handlePostSchedule(
  ctx: SigningContext,
  args: {
    content: string
    scheduledAt: string | number
    kind?: number
    tags?: string[][]
    relays?: string[]
  },
  queueDir?: string,
): Promise<ScheduleResult> {
  const dir = queueDir ?? DEFAULT_QUEUE_DIR
  const ts = parseScheduledAt(args.scheduledAt)
  const now = Math.floor(Date.now() / 1000)

  if (ts <= now) {
    throw new Error(`scheduledAt must be in the future (got ${ts}, now is ${now})`)
  }

  const kind = args.kind ?? 1
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: args.tags ?? [],
    content: args.content,
  })

  const relays = args.relays ?? []
  const payload: ScheduledEvent = { scheduledAt: ts, event, relays }
  const fileName = `${ts}-${event.id.slice(0, 8)}.json`
  const filePath = join(dir, fileName)

  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 })

  return { scheduled: true, scheduledAt: ts, eventId: event.id, filePath }
}

/** List all scheduled posts waiting to be published */
export function handlePostQueueList(queueDir?: string): QueueEntry[] {
  const dir = queueDir ?? DEFAULT_QUEUE_DIR

  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  const entries: QueueEntry[] = []

  for (const file of files) {
    const filePath = join(dir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const data: ScheduledEvent = JSON.parse(raw)
      entries.push({
        scheduledAt: data.scheduledAt,
        eventId: data.event.id,
        kind: data.event.kind,
        content: data.event.content.slice(0, 80),
        filePath,
      })
    } catch {
      // Skip unparseable files
    }
  }

  entries.sort((a, b) => a.scheduledAt - b.scheduledAt)
  return entries
}

/** Cancel a scheduled post by event ID */
export function handlePostQueueCancel(eventId: string, queueDir?: string): CancelResult {
  const dir = queueDir ?? DEFAULT_QUEUE_DIR

  if (!existsSync(dir)) {
    throw new Error(`Scheduled post not found: ${eventId}`)
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))

  for (const file of files) {
    const filePath = join(dir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const data: ScheduledEvent = JSON.parse(raw)
      if (data.event.id === eventId) {
        unlinkSync(filePath)
        return { cancelled: true, eventId }
      }
    } catch {
      // Skip unparseable files
    }
  }

  throw new Error(`Scheduled post not found: ${eventId}`)
}

/** Publish all scheduled events that are due. Called by the CLI command, not MCP. */
export async function handlePublishScheduled(
  pool: RelayPool,
  npub: string,
  queueDir?: string,
): Promise<PublishScheduledResult> {
  const dir = queueDir ?? DEFAULT_QUEUE_DIR
  const now = Math.floor(Date.now() / 1000)

  if (!existsSync(dir)) {
    return { published: 0, failed: 0, remaining: 0 }
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  let published = 0
  let failed = 0
  let remaining = 0

  for (const file of files) {
    const filePath = join(dir, file)
    let data: ScheduledEvent
    try {
      const raw = readFileSync(filePath, 'utf-8')
      data = JSON.parse(raw)
    } catch {
      failed++
      continue
    }

    if (data.scheduledAt > now) {
      remaining++
      continue
    }

    try {
      // Configure pool with stored relays if present
      if (data.relays.length > 0) {
        pool.reconfigure(npub, { read: data.relays, write: data.relays })
      }
      const result = await pool.publish(npub, data.event)
      if (result.success) {
        unlinkSync(filePath)
        published++
      } else {
        // success is the majority-quorum flag: treat as failure only when
        // we did not reach at least 50% of attempted relays.
        const reason = result.accepted.length === 0
          ? 'rejected by all relays'
          : `only ${result.accepted.length}/${result.accepted.length + result.rejected.length} relays accepted`
        console.error(`Failed to publish ${data.event.id}: ${reason}`)
        failed++
      }
    } catch (err: any) {
      console.error(`Failed to publish ${data.event.id}: ${err.message}`)
      failed++
    }
  }

  return { published, failed, remaining }
}
