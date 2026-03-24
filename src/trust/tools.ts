import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import {
  handleTrustAttest,
  handleTrustRead,
  handleTrustVerify,
  handleTrustRevoke,
  handleTrustRequest,
  handleTrustRequestList,
  handleTrustProofPublish,
} from './handlers.js'
import { handleTrustRingProve, handleTrustRingVerify } from './ring.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from './spoken.js'

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

  server.registerTool('trust_request', {
    description: 'Send an attestation request to another Nostr identity via NIP-17 encrypted DM.',
    inputSchema: {
      recipientPubkeyHex: z.string().describe('Hex pubkey of the attestor you are requesting from'),
      subject: z.string().describe('Hex pubkey of the subject to be attested'),
      attestationType: z.string().describe('Type of attestation requested'),
      message: z.string().optional().describe('Optional message explaining the request'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ recipientPubkeyHex, subject, attestationType, message }) => {
    const result = await handleTrustRequest(deps.ctx, deps.pool, {
      recipientPubkeyHex, subject, attestationType, message,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('trust_request_list', {
    description: 'Scan received NIP-17 DMs for attestation request payloads.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const requests = await handleTrustRequestList(deps.ctx, deps.pool)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(requests, null, 2) }],
    }
  })

  server.registerTool('trust_proof_publish', {
    description: 'Publish a cryptographic linkage proof as a kind 30078 event. Requires confirmation — this is irreversible.',
    inputSchema: {
      mode: z.enum(['blind', 'full']).default('blind').describe('Proof mode: blind hides derivation path, full reveals it'),
      confirm: z.boolean().default(false).describe('Set true to publish (irreversible)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ mode, confirm }) => {
    const result = await handleTrustProofPublish(deps.ctx, deps.pool, { mode, confirm })
    if (!result.published) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ warning: result.warning }, null, 2) }] }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event!.id, published: true }, null, 2) }],
    }
  })

  server.registerTool('trust_ring_prove', {
    description: 'Create a ring signature proving anonymous membership in a group of public keys.',
    inputSchema: {
      ring: z.array(z.string()).describe('Hex x-only public keys of ring members (must include active identity)'),
      attestationType: z.string().describe('Attestation type context for the canonical message'),
      message: z.string().optional().describe('Custom message to sign (defaults to canonical format)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ ring, attestationType, message }) => {
    const result = await handleTrustRingProve(deps.ctx, deps.pool, { ring, attestationType, message })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, ringSize: ring.length }, null, 2) }],
    }
  })

  server.registerTool('trust_ring_verify', {
    description: 'Verify a ring signature proof.',
    inputSchema: {
      signature: z.record(z.string(), z.unknown()).describe('Ring signature object or Nostr event containing one'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ signature }) => {
    const result = handleTrustRingVerify(signature as any)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust_spoken_challenge', {
    description: 'Generate a spoken verification token for in-person identity confirmation.',
    inputSchema: {
      secret: z.string().describe('Shared secret (hex, min 32 chars)'),
      context: z.string().describe('Context string for domain separation'),
      counter: z.number().int().describe('Time-based or usage counter'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret, context, counter }) => {
    const result = handleTrustSpokenChallenge({ secret, context, counter })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust_spoken_verify', {
    description: 'Verify a spoken token response against the shared secret.',
    inputSchema: {
      secret: z.string().describe('Shared secret (hex, min 32 chars)'),
      context: z.string().describe('Context string used during challenge'),
      counter: z.number().int().describe('Current counter value'),
      input: z.string().describe('The spoken/entered token to verify'),
      tolerance: z.number().int().min(0).max(10).default(1).describe('Counter tolerance window (default 1)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret, context, counter, input, tolerance }) => {
    const result = handleTrustSpokenVerify({ secret, context, counter, input, tolerance })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
