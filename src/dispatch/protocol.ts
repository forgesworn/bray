/**
 * Dispatch protocol message types, builders, and validators.
 *
 * Pure TypeScript — no external dependencies. All message types follow
 * the dispatch wire format: `{ v: 1, type: "dispatch-*", ... }`.
 */

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = 1 as const
const MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000 // 2 minutes clock skew allowance
const REPO_NAME_RE = /^[a-zA-Z0-9_-]+$/

// Monotonic counter for task ID uniqueness within a single process
let idCounter = 0

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface DispatchThink {
  v: 1
  type: 'dispatch-think'
  id: string
  ts: string
  prompt: string
  repos: string[]
  respond_to: string
  context_id?: string
  depth?: number
}

export interface DispatchBuild {
  v: 1
  type: 'dispatch-build'
  id: string
  ts: string
  prompt: string
  repos: string[]
  branch_from: string
  respond_to: string
  context_id?: string
  depth?: number
}

export interface DispatchResult {
  v: 1
  type: 'dispatch-result'
  re: string
  ts: string
  mode: 'think' | 'build'
  plan?: string
  files_read?: string[]
  branch?: string
  commits?: string[]
  tests?: string
  pr?: string
}

export interface DispatchAck {
  v: 1
  type: 'dispatch-ack'
  re: string
  ts: string
  note?: string
}

export interface DispatchCancel {
  v: 1
  type: 'dispatch-cancel'
  re: string
  ts: string
  note?: string
}

export interface DispatchStatus {
  v: 1
  type: 'dispatch-status'
  ts: string
  status: string
  resets_at?: string
  queue?: number
  note?: string
}

export interface DispatchRefuse {
  v: 1
  type: 'dispatch-refuse'
  re: string
  ts: string
  reason: string
}

export interface DispatchFailure {
  v: 1
  type: 'dispatch-failure'
  re: string
  ts: string
  error: string
  partial?: string
}

export interface DispatchQuery {
  v: 1
  type: 'dispatch-query'
  re: string
  ts: string
  question: string
  respond_to: string
}

export type DispatchMessage =
  | DispatchThink
  | DispatchBuild
  | DispatchResult
  | DispatchAck
  | DispatchCancel
  | DispatchStatus
  | DispatchRefuse
  | DispatchFailure
  | DispatchQuery

// ---------------------------------------------------------------------------
// Task ID generation
// ---------------------------------------------------------------------------

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildThinkMessage(args: {
  prompt: string
  repos: string[]
  respond_to: string
  context_id?: string
  depth?: number
}): DispatchThink {
  const msg: DispatchThink = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-think',
    id: makeId('think'),
    ts: new Date().toISOString(),
    prompt: args.prompt,
    repos: args.repos,
    respond_to: args.respond_to,
  }
  if (args.context_id !== undefined) msg.context_id = args.context_id
  if (args.depth !== undefined) msg.depth = args.depth
  return msg
}

export function buildBuildMessage(args: {
  prompt: string
  repos: string[]
  branch_from: string
  respond_to: string
  context_id?: string
  depth?: number
}): DispatchBuild {
  const msg: DispatchBuild = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-build',
    id: makeId('build'),
    ts: new Date().toISOString(),
    prompt: args.prompt,
    repos: args.repos,
    branch_from: args.branch_from,
    respond_to: args.respond_to,
  }
  if (args.context_id !== undefined) msg.context_id = args.context_id
  if (args.depth !== undefined) msg.depth = args.depth
  return msg
}

export function buildResultMessage(args: {
  re: string
  mode: 'think' | 'build'
  plan?: string
  files_read?: string[]
  branch?: string
  commits?: string[]
  tests?: string
  pr?: string
}): DispatchResult {
  const msg: DispatchResult = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-result',
    re: args.re,
    ts: new Date().toISOString(),
    mode: args.mode,
  }
  if (args.plan !== undefined) msg.plan = args.plan
  if (args.files_read !== undefined) msg.files_read = args.files_read
  if (args.branch !== undefined) msg.branch = args.branch
  if (args.commits !== undefined) msg.commits = args.commits
  if (args.tests !== undefined) msg.tests = args.tests
  if (args.pr !== undefined) msg.pr = args.pr
  return msg
}

export function buildAckMessage(args: {
  re: string
  note?: string
}): DispatchAck {
  const msg: DispatchAck = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-ack',
    re: args.re,
    ts: new Date().toISOString(),
  }
  if (args.note !== undefined) msg.note = args.note
  return msg
}

export function buildCancelMessage(args: {
  re: string
  note?: string
}): DispatchCancel {
  const msg: DispatchCancel = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-cancel',
    re: args.re,
    ts: new Date().toISOString(),
  }
  if (args.note !== undefined) msg.note = args.note
  return msg
}

export function buildStatusMessage(args: {
  status: string
  note?: string
  resets_at?: string
  queue?: number
}): DispatchStatus {
  const msg: DispatchStatus = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-status',
    ts: new Date().toISOString(),
    status: args.status,
  }
  if (args.resets_at !== undefined) msg.resets_at = args.resets_at
  if (args.queue !== undefined) msg.queue = args.queue
  if (args.note !== undefined) msg.note = args.note
  return msg
}

export function buildRefuseMessage(args: {
  re: string
  reason: string
}): DispatchRefuse {
  return {
    v: PROTOCOL_VERSION,
    type: 'dispatch-refuse',
    re: args.re,
    ts: new Date().toISOString(),
    reason: args.reason,
  }
}

export function buildFailureMessage(args: {
  re: string
  error: string
  partial?: string
}): DispatchFailure {
  const msg: DispatchFailure = {
    v: PROTOCOL_VERSION,
    type: 'dispatch-failure',
    re: args.re,
    ts: new Date().toISOString(),
    error: args.error,
  }
  if (args.partial !== undefined) msg.partial = args.partial
  return msg
}

export function buildQueryMessage(args: {
  re: string
  question: string
  respond_to: string
}): DispatchQuery {
  return {
    v: PROTOCOL_VERSION,
    type: 'dispatch-query',
    re: args.re,
    ts: new Date().toISOString(),
    question: args.question,
    respond_to: args.respond_to,
  }
}

// ---------------------------------------------------------------------------
// Type guard and parser
// ---------------------------------------------------------------------------

/** Type guard: returns true if the value looks like a dispatch message. */
export function isDispatchMessage(obj: unknown): obj is DispatchMessage {
  if (obj === null || obj === undefined || typeof obj !== 'object') return false
  const rec = obj as Record<string, unknown>
  return (
    rec.v === PROTOCOL_VERSION &&
    typeof rec.type === 'string' &&
    rec.type.startsWith('dispatch-')
  )
}

/** Parse a JSON string, returning a DispatchMessage or null. */
export function parseDispatchMessage(content: string): DispatchMessage | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (isDispatchMessage(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate that all repo entries are simple directory names.
 * Rejects slashes, `..`, absolute paths, spaces, and empty strings.
 * Requires at least one entry.
 */
export function validateRepos(repos: string[]): void {
  if (repos.length === 0) {
    throw new Error('repos must contain at least one entry')
  }
  for (const name of repos) {
    if (!REPO_NAME_RE.test(name)) {
      throw new Error(
        `Invalid repo name "${name}": must match /^[a-zA-Z0-9_-]+$/`
      )
    }
  }
}

/**
 * Check that a timestamp is fresh (not older than 4 hours, not significantly
 * in the future). Throws on stale, future, or unparseable timestamps.
 */
export function checkFreshness(ts: string): void {
  const date = new Date(ts)
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: "${ts}"`)
  }

  const now = Date.now()
  const age = now - date.getTime()

  if (age < -FUTURE_TOLERANCE_MS) {
    throw new Error(
      `Timestamp is too far in the future (${ts})`
    )
  }

  if (age >= MAX_AGE_MS) {
    throw new Error(
      `Message is stale: timestamp ${ts} is older than 4 hours`
    )
  }
}
