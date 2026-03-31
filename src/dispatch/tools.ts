import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import { loadIdentities } from './identities.js'
import { resolveRecipient } from '../resolve.js'
import {
  handleDispatchSend,
  handleDispatchCheck,
  handleDispatchReply,
  handleDispatchAck,
  handleDispatchStatus,
  handleDispatchCancel,
  handleDispatchRefuse,
  handleDispatchFailure,
  handleDispatchQuery,
} from './handlers.js'

export function registerDispatchTools(server: McpServer, deps: ToolDeps & { dispatchIdentitiesPath?: string }): void {
  // Load identities once at registration time
  let identities: Map<string, string>
  if (deps.dispatchIdentitiesPath) {
    try {
      identities = loadIdentities(deps.dispatchIdentitiesPath)
      console.error(`dispatch: loaded ${identities.size} identities from ${deps.dispatchIdentitiesPath}`)
    } catch (e: any) {
      console.error(`dispatch: failed to load identities: ${e.message}`)
      identities = new Map()
    }
  } else {
    console.error('dispatch: no DISPATCH_IDENTITIES configured — dispatch tools disabled')
    return
  }

  if (identities.size === 0) {
    console.error('dispatch: identities file is empty — dispatch tools disabled')
    return
  }

  const sessionStartUnix = Math.floor(Date.now() / 1000)

  // --- dispatch-send ---

  server.registerTool('dispatch-send', {
    description: 'Send a collaboration task to a trusted Nostr identity. Think tasks request read-only code analysis. Build tasks request implementation with code changes. The recipient\'s AI agent receives the task via encrypted NIP-17 DM and processes it with dispatch-check. Uses the active identity as sender — switch identity first if needed.',
    inputSchema: {
      to: z.string().describe('Recipient — name ("alice"), NIP-05 ("alice@example.com"), npub, or hex pubkey'),
      type: z.enum(['think', 'build']).describe('"think" for read-only analysis (questions, reviews), "build" for implementation (code changes, PRs)'),
      prompt: z.string().describe('The task description. For think: what to analyse and what questions to answer. For build: what to implement and acceptance criteria.'),
      repos: z.array(z.string()).optional().describe('Repository directory names the recipient needs (e.g. ["toll-booth", "trott-sdk"])'),
      branch_from: z.string().optional().describe('Base branch for build tasks (default: "main")'),
      context_id: z.string().optional().describe('Conversation/session ID for grouping related tasks. Pass the same ID across a multi-turn exchange.'),
      depth: z.number().optional().describe('Delegation depth limit. Decremented when forwarding tasks. Prevents infinite delegation chains. Default: no limit.'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ to, type, prompt, repos, branch_from, context_id, depth, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchSend(deps.ctx, deps.pool, {
      identities,
      recipientHex: resolved.pubkeyHex,
      recipientName: resolved.displayName ?? to,
      type,
      prompt,
      repos,
      branchFrom: branch_from,
      contextId: context_id,
      depth,
    })
    return toolResponse(result, output, fmt.formatDispatchSendResult)
  })

  // --- dispatch-check ---

  server.registerTool('dispatch-check', {
    description: 'Check for incoming collaboration tasks from trusted Nostr identities. Returns dispatch messages: think tasks, build tasks, results, acks, status updates. Only shows messages from identities in the dispatch trust list, validated for freshness. Defaults to messages received since this session started (prevents re-processing old tasks). Pass since=0 to see all available messages regardless of age.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only return messages after this time. Defaults to session start (prevents duplicate processing). Pass 0 to fetch all available messages.'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, output }) => {
    const effectiveSince = since === 0 ? undefined : (since ?? sessionStartUnix)
    const result = await handleDispatchCheck(deps.ctx, deps.pool, {
      identities,
      since: effectiveSince,
    })
    return toolResponse(result, output, fmt.formatDispatchMessages)
  })

  // --- dispatch-reply ---

  server.registerTool('dispatch-reply', {
    description: 'Send a result back for a completed dispatch task. Use after finishing a think or build task received via dispatch-check. Only replies to trusted identities. Do not use this for human conversations — only for responding to tasks from other AI agents.',
    inputSchema: {
      re: z.string().describe('Task ID from the received message (the "id" field from dispatch-check output)'),
      to: z.string().describe('Recipient — name ("alice"), NIP-05, npub, or hex pubkey. Use the sender from the original dispatch message.'),
      type: z.enum(['think', 'build']).describe('Whether this is a think (analysis) or build (implementation) result'),
      plan: z.string().optional().describe('Analysis text — summaries and recommendations, NOT verbatim file contents'),
      files_read: z.array(z.string()).optional().describe('Files examined during analysis'),
      branch: z.string().optional().describe('Git branch created for build results'),
      commits: z.array(z.string()).optional().describe('Commit hashes for build results'),
      tests: z.string().optional().describe('Test results summary (e.g. "12 passed, 0 failed")'),
      pr: z.string().optional().describe('Pull request URL if created'),
      delete_event_id: z.string().optional().describe('Event ID to delete after reply (use the eventId from dispatch-check for NIP-09 cleanup)'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, type, plan, files_read, branch, commits, tests, pr, delete_event_id, output }) => {
    const resolved = await resolveRecipient(to, identities)

    // Trust boundary: only reply to known identities
    const knownHexes = new Set(identities.values())
    if (!knownHexes.has(resolved.pubkeyHex)) {
      throw new Error(`Refusing to reply to untrusted identity "${to}" (${resolved.pubkeyHex.slice(0, 12)}…). Only dispatch-listed identities are allowed.`)
    }

    const result = await handleDispatchReply(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      type,
      plan,
      filesRead: files_read,
      branch,
      commits,
      tests,
      pr,
      deleteEventId: delete_event_id,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-ack ---

  server.registerTool('dispatch-ack', {
    description: 'Acknowledge receipt of a dispatch task. Tells the sender "got it, working on it" before you have a full result. Use when a task will take time to complete.',
    inputSchema: {
      re: z.string().describe('Task ID being acknowledged (the "id" field from dispatch-check output)'),
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      note: z.string().optional().describe('Optional status note (e.g. "starting analysis of toll-booth")'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, note, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchAck(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      note,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-status ---

  server.registerTool('dispatch-status', {
    description: 'Send a status update to collaborators. Use to broadcast availability (e.g. "busy until 14:00"), queue depth, or progress on long-running tasks.',
    inputSchema: {
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      status: z.string().describe('Current status (e.g. "available", "busy", "offline")'),
      note: z.string().optional().describe('Additional context'),
      resets_at: z.string().optional().describe('ISO timestamp when status resets (e.g. when you will be available again)'),
      queue: z.number().optional().describe('Number of tasks currently queued'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ to, status, note, resets_at, queue, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchStatus(deps.ctx, deps.pool, {
      identities,
      to: resolved.pubkeyHex,
      status,
      note,
      resetsAt: resets_at,
      queue,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-cancel ---

  server.registerTool('dispatch-cancel', {
    description: 'Cancel a dispatch task you previously sent or received. Notifies the other party that the task should be abandoned.',
    inputSchema: {
      re: z.string().describe('Task ID to cancel (the "id" field from the dispatch message)'),
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      note: z.string().optional().describe('Reason for cancellation'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, note, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchCancel(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      note,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-refuse ---

  server.registerTool('dispatch-refuse', {
    description: 'Refuse a dispatch task you cannot or should not complete. Tells the sender "I cannot do this" with a reason. Use when the task is outside your capabilities, scope, or permissions.',
    inputSchema: {
      re: z.string().describe('Task ID being refused (the "id" field from dispatch-check output)'),
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      reason: z.string().describe('Why you are refusing (e.g. "repo not available", "task requires write access I do not have")'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, reason, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchRefuse(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      reason,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-failure ---

  server.registerTool('dispatch-failure', {
    description: 'Report that a dispatch task failed after you attempted it. Use when you tried to complete the task but encountered errors. Optionally include partial results so work is not lost.',
    inputSchema: {
      re: z.string().describe('Task ID that failed (the "id" field from dispatch-check output)'),
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      error: z.string().describe('What went wrong (e.g. "build failed: type error in handlers.ts:42")'),
      partial: z.string().optional().describe('Any partial results or progress made before the failure'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, error, partial, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchFailure(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      error,
      partial,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })

  // --- dispatch-query ---

  server.registerTool('dispatch-query', {
    description: 'Ask the task sender a clarifying question before delivering results. Use mid-task when you need more information to proceed. The sender receives the question via dispatch-check and can reply.',
    inputSchema: {
      re: z.string().describe('Task ID you are asking about (the "id" field from dispatch-check output)'),
      to: z.string().describe('Recipient — name, NIP-05, npub, or hex pubkey'),
      question: z.string().describe('The clarifying question'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, question, output }) => {
    const resolved = await resolveRecipient(to, identities)
    const result = await handleDispatchQuery(deps.ctx, deps.pool, {
      identities,
      re,
      to: resolved.pubkeyHex,
      question,
    })
    return toolResponse(result, output, fmt.formatDispatchReplyResult)
  })
}
