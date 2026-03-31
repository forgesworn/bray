import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import { loadIdentities } from './identities.js'
import { handleDispatchSend, handleDispatchCheck, handleDispatchReply } from './handlers.js'
import { hexId } from '../validation.js'

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

  // Register dispatch-send
  server.registerTool('dispatch-send', {
    description: 'Send a collaboration task to a trusted Nostr identity. Think tasks request read-only code analysis. Build tasks request implementation. The recipient\'s AI agent receives the task via encrypted NIP-17 DM and can process it with dispatch-check. Uses the active identity as sender — switch identity first if needed.',
    inputSchema: {
      to: z.string().describe('Recipient name (as listed in dispatch identities, e.g. "alice", "bob")'),
      type: z.enum(['think', 'build']).describe('"think" for read-only analysis, "build" for implementation'),
      prompt: z.string().describe('The task description — what you want the recipient to analyse or build'),
      repos: z.array(z.string()).optional().describe('Repository directory names the recipient needs (e.g. ["toll-booth", "trott-sdk"])'),
      branch_from: z.string().optional().describe('Base branch for build tasks (default: "main")'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ to, type, prompt, repos, branch_from, output }) => {
    const result = await handleDispatchSend(deps.ctx, deps.pool, {
      identities,
      to,
      type,
      prompt,
      repos,
      branchFrom: branch_from,
    })
    return toolResponse(result, output, fmt.formatDispatchSendResult)
  })

  // Register dispatch-check
  server.registerTool('dispatch-check', {
    description: 'Check for incoming collaboration tasks from trusted Nostr identities. Returns structured dispatch messages (think tasks, build tasks, results, status updates). Only shows messages from trusted identities, validated for freshness and safety. By default only shows messages received since this session started — pass since=0 to see all recent messages.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only return messages after this time. Defaults to session start time. Pass 0 for all recent messages.'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
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

  // Register dispatch-reply
  server.registerTool('dispatch-reply', {
    description: 'Send a result back for a processed dispatch task. Use after completing a think (analysis) or build (implementation) task received via dispatch-check. Optionally deletes the original message from relays (NIP-09) for ephemeral messaging.',
    inputSchema: {
      re: z.string().describe('Task ID being responded to (e.g. "think-m1abc-1")'),
      to: hexId.describe('Hex pubkey to send result to (respond_to field from original message)'),
      mode: z.enum(['think', 'build']).describe('Whether this is a think or build result'),
      plan: z.string().optional().describe('Analysis text for think results — summaries and recommendations, NOT verbatim file contents'),
      files_read: z.array(z.string()).optional().describe('Files examined during analysis'),
      branch: z.string().optional().describe('Git branch created for build results'),
      commits: z.array(z.string()).optional().describe('Commit hashes for build results'),
      tests: z.string().optional().describe('Test results summary'),
      pr: z.string().optional().describe('Pull request URL if created'),
      delete_event_id: z.string().optional().describe('Event ID of original dispatch message to delete (NIP-09 cleanup)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ re, to, mode, plan, files_read, branch, commits, tests, pr, delete_event_id, output }) => {
    const result = await handleDispatchReply(deps.ctx, deps.pool, {
      identities,
      re,
      to,
      mode,
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
}
