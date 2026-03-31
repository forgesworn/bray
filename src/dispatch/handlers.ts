/**
 * Dispatch handlers — compose DM primitives with the dispatch protocol
 * and identity modules to send, check, and reply to collaborator tasks.
 */

import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import {
  buildThinkMessage,
  buildBuildMessage,
  buildResultMessage,
  buildAckMessage,
  buildCancelMessage,
  buildStatusMessage,
  buildRefuseMessage,
  buildFailureMessage,
  buildQueryMessage,
  buildProposeMessage,
  parseDispatchMessage,
  validateRepos,
  checkFreshness,
  type DispatchMessage,
} from './protocol.js'
import { handleDmSend, handleDmRead } from '../social/dm.js'
import { handleSocialDelete } from '../social/handlers.js'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DispatchSendResult {
  sent: boolean
  taskId: string
  messageType: 'dispatch-think' | 'dispatch-build'
  recipientName: string
  recipientHex: string
  publish: PublishResult
}

export interface CheckedDispatchMessage {
  eventId: string
  from: string
  fromName: string | undefined
  message: DispatchMessage
  createdAt: number
}

export interface DispatchReplyResult {
  sent: boolean
  messageType: 'dispatch-result' | 'dispatch-ack' | 'dispatch-status' | 'dispatch-cancel' | 'dispatch-refuse' | 'dispatch-failure' | 'dispatch-query' | 'dispatch-propose'
  deleted: boolean
}

// ---------------------------------------------------------------------------
// handleDispatchSend
// ---------------------------------------------------------------------------

/**
 * Send a dispatch task (think or build) to a resolved recipient.
 *
 * The caller has already resolved the recipient to a hex pubkey via
 * resolveRecipient(). This handler builds the protocol message and
 * sends it as a NIP-17 DM.
 */
export async function handleDispatchSend(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    recipientHex: string
    recipientName: string
    type: 'think' | 'build'
    prompt: string
    repos?: string[]
    branchFrom?: string
    contextId?: string
    depth?: number
    dependsOn?: string[]
  },
): Promise<DispatchSendResult> {
  // Enforce delegation depth limit
  if (args.depth !== undefined && args.depth <= 0) {
    throw new Error('Delegation depth limit reached (depth=0). Cannot forward this task further.')
  }

  const senderHex = ctx.activePublicKeyHex
  const repos = args.repos ?? []

  let msg
  if (args.type === 'think') {
    msg = buildThinkMessage({
      prompt: args.prompt,
      repos,
      respond_to: senderHex,
      context_id: args.contextId,
      depth: args.depth,
      depends_on: args.dependsOn,
    })
  } else {
    msg = buildBuildMessage({
      prompt: args.prompt,
      repos,
      branch_from: args.branchFrom ?? 'main',
      respond_to: senderHex,
      context_id: args.contextId,
      depth: args.depth,
      depends_on: args.dependsOn,
    })
  }

  const json = JSON.stringify(msg)
  const dmResult = await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.recipientHex,
    message: json,
  })

  return {
    sent: true,
    taskId: msg.id,
    messageType: msg.type,
    recipientName: args.recipientName,
    recipientHex: args.recipientHex,
    publish: dmResult.publish,
  }
}

// ---------------------------------------------------------------------------
// handleDispatchCheck
// ---------------------------------------------------------------------------

/**
 * Check for incoming dispatch messages from trusted collaborators.
 *
 * Reads recent DMs, attempts to parse each as a dispatch message,
 * filters to those from known identities, and validates freshness.
 */
export async function handleDispatchCheck(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    since?: number
  },
): Promise<CheckedDispatchMessage[]> {
  const entries = await handleDmRead(ctx, pool, {
    since: args.since,
    limit: 50,
  })

  // Build reverse lookup: hex -> name
  const hexToName = new Map<string, string>()
  for (const [name, hex] of args.identities) {
    hexToName.set(hex, name)
  }

  const results: CheckedDispatchMessage[] = []

  for (const entry of entries) {
    // Skip entries that failed to decrypt
    if (!entry.decrypted || !entry.content) continue

    // Must be from a known/trusted sender
    const senderName = hexToName.get(entry.from)
    if (!senderName) continue

    // Parse as dispatch message
    const message = parseDispatchMessage(entry.content)
    if (!message) continue

    // Validate freshness (silently skip stale messages)
    try {
      checkFreshness(message.ts)
    } catch {
      continue
    }

    // Validate repos if present
    if ('repos' in message && Array.isArray(message.repos) && message.repos.length > 0) {
      try {
        validateRepos(message.repos)
      } catch {
        continue
      }
    }

    // Validate respond_to if present (should be a 64-char hex string)
    if ('respond_to' in message && typeof message.respond_to === 'string') {
      if (!/^[0-9a-f]{64}$/.test(message.respond_to)) continue
    }

    results.push({
      eventId: entry.id,
      from: entry.from,
      fromName: senderName,
      message,
      createdAt: entry.createdAt,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// handleDispatchReply
// ---------------------------------------------------------------------------

/**
 * Reply to a dispatch task with a result message.
 *
 * Builds the result, sends it as a DM to the original sender,
 * and optionally deletes the original task event (best effort).
 */
export async function handleDispatchReply(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    type: 'think' | 'build'
    plan?: string
    filesRead?: string[]
    branch?: string
    commits?: string[]
    tests?: string
    pr?: string
    deleteEventId?: string
  },
): Promise<DispatchReplyResult> {
  const resultMsg = buildResultMessage({
    re: args.re,
    mode: args.type,
    plan: args.plan,
    files_read: args.filesRead,
    branch: args.branch,
    commits: args.commits,
    tests: args.tests,
    pr: args.pr,
  })

  const json = JSON.stringify(resultMsg)
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: json,
  })

  let deleted = false
  if (args.deleteEventId) {
    try {
      await handleSocialDelete(ctx, pool, {
        eventId: args.deleteEventId,
        reason: 'dispatch task completed',
      })
      deleted = true
    } catch {
      // Deletion is best-effort
    }
  }

  return { sent: true, messageType: 'dispatch-result', deleted }
}

// ---------------------------------------------------------------------------
// handleDispatchAck
// ---------------------------------------------------------------------------

/**
 * Acknowledge receipt of a dispatch task.
 */
export async function handleDispatchAck(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    note?: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildAckMessage({ re: args.re, note: args.note })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-ack', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchStatus
// ---------------------------------------------------------------------------

/**
 * Send a status update to a collaborator.
 */
export async function handleDispatchStatus(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    to: string
    status: string
    note?: string
    resetsAt?: string
    queue?: number
  },
): Promise<DispatchReplyResult> {
  const msg = buildStatusMessage({
    status: args.status,
    note: args.note,
    resets_at: args.resetsAt,
    queue: args.queue,
  })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-status', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchCancel
// ---------------------------------------------------------------------------

/**
 * Cancel a dispatch task.
 */
export async function handleDispatchCancel(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    note?: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildCancelMessage({ re: args.re, note: args.note })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-cancel', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchRefuse
// ---------------------------------------------------------------------------

/**
 * Refuse a dispatch task. Tells the sender "I can't do this" with a reason.
 */
export async function handleDispatchRefuse(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    reason: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildRefuseMessage({ re: args.re, reason: args.reason })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-refuse', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchFailure
// ---------------------------------------------------------------------------

/**
 * Report that a dispatch task failed. Optionally includes partial results.
 */
export async function handleDispatchFailure(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    error: string
    partial?: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildFailureMessage({
    re: args.re,
    error: args.error,
    partial: args.partial,
  })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-failure', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchQuery
// ---------------------------------------------------------------------------

/**
 * Ask the sender a clarifying question mid-task before delivering results.
 */
export async function handleDispatchQuery(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    question: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildQueryMessage({
    re: args.re,
    question: args.question,
    respond_to: ctx.activePublicKeyHex,
  })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-query', deleted: false }
}

// ---------------------------------------------------------------------------
// handleDispatchPropose
// ---------------------------------------------------------------------------

/**
 * Propose an alternative approach for a dispatch task.
 */
export async function handleDispatchPropose(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    proposal: string
    reason?: string
  },
): Promise<DispatchReplyResult> {
  const msg = buildProposeMessage({
    re: args.re,
    proposal: args.proposal,
    reason: args.reason,
    respond_to: ctx.activePublicKeyHex,
  })
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: JSON.stringify(msg),
  })
  return { sent: true, messageType: 'dispatch-propose', deleted: false }
}
