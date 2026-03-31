/**
 * Dispatch handlers — compose DM primitives with the dispatch protocol
 * and identity modules to send, check, and reply to collaborator tasks.
 */

import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { DmReadEntry } from '../social/dm.js'
import {
  buildThinkMessage,
  buildBuildMessage,
  buildResultMessage,
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
  messageType: 'claude-think' | 'claude-build'
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
  messageType: 'claude-result'
  deleted: boolean
}

// ---------------------------------------------------------------------------
// handleDispatchSend
// ---------------------------------------------------------------------------

/**
 * Send a dispatch task (think or build) to a named collaborator.
 *
 * Looks up the recipient in the identities map, builds the appropriate
 * protocol message, and sends it as a NIP-17 DM.
 */
export async function handleDispatchSend(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    to: string
    type: 'think' | 'build'
    prompt: string
    repos?: string[]
    branchFrom?: string
  },
): Promise<DispatchSendResult> {
  const name = args.to.toLowerCase()
  const recipientHex = args.identities.get(name)

  if (!recipientHex) {
    const known = [...args.identities.keys()].join(', ')
    throw new Error(
      `Unknown recipient "${args.to}". Known identities: ${known}`,
    )
  }

  const senderHex = ctx.activePublicKeyHex
  const repos = args.repos ?? []

  let msg
  if (args.type === 'think') {
    msg = buildThinkMessage({
      prompt: args.prompt,
      repos,
      respond_to: senderHex,
    })
  } else {
    msg = buildBuildMessage({
      prompt: args.prompt,
      repos,
      branch_from: args.branchFrom ?? 'main',
      respond_to: senderHex,
    })
  }

  const json = JSON.stringify(msg)
  const dmResult = await handleDmSend(ctx, pool, {
    recipientPubkeyHex: recipientHex,
    message: json,
  })

  return {
    sent: true,
    taskId: msg.id,
    messageType: msg.type,
    recipientName: name,
    recipientHex,
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
  ctx: IdentityContext,
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
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    identities: Map<string, string>
    re: string
    to: string
    mode: 'think' | 'build'
    plan?: string
    filesRead?: string[]
    branch?: string
    commits?: string[]
    tests?: string
    pr?: string
    deleteEventId?: string
  },
): Promise<DispatchReplyResult> {
  // Build the result message
  const resultMsg = buildResultMessage({
    re: args.re,
    mode: args.mode,
    plan: args.plan,
    files_read: args.filesRead,
    branch: args.branch,
    commits: args.commits,
    pr: args.pr,
  })

  const json = JSON.stringify(resultMsg)
  await handleDmSend(ctx, pool, {
    recipientPubkeyHex: args.to,
    message: json,
  })

  // Best-effort deletion of the original task event
  let deleted = false
  if (args.deleteEventId) {
    try {
      await handleSocialDelete(ctx, pool, {
        eventId: args.deleteEventId,
        reason: 'dispatch task completed',
      })
      deleted = true
    } catch {
      // Deletion is best-effort; do not propagate errors
    }
  }

  return {
    sent: true,
    messageType: 'claude-result',
    deleted,
  }
}
