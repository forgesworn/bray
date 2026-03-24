import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import {
  handleTrustAttest,
  handleTrustRead,
  handleTrustVerify,
  handleTrustRevoke,
} from './handlers.js'

export function registerTrustTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('trust_attest', {
    description: 'Create and publish a kind 31000 verifiable attestation as the active identity.',
    inputSchema: {
      type: z.string().describe('Attestation type (e.g. "identity-verification", "endorsement")'),
      identifier: z.string().optional().describe('D-tag identifier (hex pubkey or context string)'),
      subject: z.string().optional().describe('Subject hex pubkey (for third-party attestations)'),
      summary: z.string().optional().describe('Human-readable summary'),
      content: z.string().optional().describe('Event content (text or JSON)'),
      expiration: z.number().optional().describe('Unix timestamp for attestation expiry'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ type, identifier, subject, summary, content, expiration }) => {
    const result = await handleTrustAttest(deps.ctx, deps.pool, {
      type, identifier, subject, summary, content, expiration,
    })
    const response: Record<string, unknown> = {
      id: result.event.id,
      publish: result.publish,
    }
    if (result.warning) response.warning = result.warning
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
    }
  })

  server.registerTool('trust_read', {
    description: 'Read kind 31000 attestations from relays. Filter by subject, type, or attestor.',
    inputSchema: {
      subject: z.string().optional().describe('Subject hex pubkey to filter by'),
      type: z.string().optional().describe('Attestation type to filter by'),
      attestor: z.string().optional().describe('Attestor hex pubkey to filter by'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ subject, type, attestor }) => {
    const events = await handleTrustRead(deps.pool, deps.ctx.activeNpub, { subject, type, attestor })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(events.map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        kind: e.kind,
        tags: e.tags,
        content: e.content,
        created_at: e.created_at,
      })), null, 2) }],
    }
  })

  server.registerTool('trust_verify', {
    description: 'Validate the structural correctness of a kind 31000 attestation event.',
    inputSchema: {
      event: z.record(z.string(), z.unknown()).describe('The attestation event object to validate'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ event }) => {
    const result = handleTrustVerify(event as any)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust_revoke', {
    description: 'Revoke a previously issued attestation. Active identity must match the original attestor.',
    inputSchema: {
      type: z.string().describe('Attestation type being revoked'),
      identifier: z.string().describe('D-tag identifier of the attestation'),
      originalAttestorPubkey: z.string().optional().describe('Hex pubkey of the original attestor (for verification)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ type, identifier, originalAttestorPubkey }) => {
    const result = await handleTrustRevoke(deps.ctx, deps.pool, {
      type, identifier, originalAttestorPubkey,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })
}
