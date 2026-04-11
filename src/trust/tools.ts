import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import { resolveRecipient, resolveRecipients } from '../resolve.js'
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
import {
  handleTrustAttestParse,
  handleTrustAttestFilter,
  handleTrustAttestTemporal,
  handleTrustAttestChain,
  handleTrustAttestCheckRevoked,
} from './attestation-deep-handlers.js'
import { handleTrustRingLsagSign, handleTrustRingLsagVerify, handleTrustRingKeyImage } from './ring-deep-handlers.js'
import { handleTrustSpokenDirectional, handleTrustSpokenEncode } from './spoken-deep-handlers.js'

export function registerTrustTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('trust-attest', {
    description: 'Verify someone else\'s claim by attesting to their assertion event. The subject publishes their claim as a Nostr event; you reference it and say "I verify this." The type is inherited from the referenced event. This is the recommended pattern — it puts the individual at the centre.',
    inputSchema: {
      assertionId: hexId.describe('Event ID of the subject\'s assertion to verify'),
      subject: z.string().optional().describe('Subject — name, NIP-05, npub, or hex pubkey (auto-detected from assertion if omitted)'),
      type: z.string().optional().describe('Explicit type override (usually inherited from the assertion)'),
      summary: z.string().optional().describe('Human-readable summary of what was verified'),
      content: z.string().optional().describe('Evidence payload (text or JSON)'),
      expiration: z.number().optional().describe('Unix timestamp for attestation expiry'),
      assertionRelay: z.string().optional().describe('Relay hint for the assertion event'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ assertionId, subject, type, summary, content, expiration, assertionRelay }) => {
    const resolvedSubject = subject ? (await resolveRecipient(subject)).pubkeyHex : undefined
    const result = await handleTrustAttest(deps.ctx, deps.pool, {
      assertionId, subject: resolvedSubject, type, summary, content, expiration, assertionRelay,
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

  server.registerTool('trust-claim', {
    description: 'Make a direct statement about another identity — an endorsement, review, vouch, or any attestor-originated claim. You define the type and subject. Use trust-attest instead if the subject has published their own assertion event.',
    inputSchema: {
      type: z.string().describe('Claim type (e.g. "endorsement", "vouch", "review")'),
      subject: z.string().optional().describe('Subject — name, NIP-05, npub, or hex pubkey (omit for self-declarations)'),
      identifier: z.string().optional().describe('D-tag identifier (defaults to subject pubkey)'),
      summary: z.string().optional().describe('Human-readable summary'),
      content: z.string().optional().describe('Event content (text or JSON)'),
      expiration: z.number().optional().describe('Unix timestamp for attestation expiry'),
      assertionAddress: z.string().optional().describe('Addressable event coordinate kind:pubkey:d-tag (produces an a-tag with "assertion" marker, e.g. for attesting authorship of a kind 30817 community NIP)'),
      assertionRelay: z.string().optional().describe('Relay hint for the assertion address'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ type, subject, identifier, summary, content, expiration, assertionAddress, assertionRelay }) => {
    const resolvedSubject = subject ? (await resolveRecipient(subject)).pubkeyHex : undefined
    const result = await handleTrustAttest(deps.ctx, deps.pool, {
      type, subject: resolvedSubject, identifier, summary, content, expiration, assertionAddress, assertionRelay,
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

  server.registerTool('trust-read', {
    description: 'Read kind 31000 attestations from relays. Filter by subject, type, or attestor. Works with both assertion-first (trust-attest) and direct claims (trust-claim).',
    inputSchema: {
      subject: z.string().optional().describe('Subject — name, NIP-05, npub, or hex pubkey'),
      type: z.string().optional().describe('Attestation type to filter by'),
      attestor: z.string().optional().describe('Attestor — name, NIP-05, npub, or hex pubkey'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ subject, type, attestor }) => {
    const resolvedSubject = subject ? (await resolveRecipient(subject)).pubkeyHex : undefined
    const resolvedAttestor = attestor ? (await resolveRecipient(attestor)).pubkeyHex : undefined
    const events = await handleTrustRead(deps.pool, deps.ctx.activeNpub, { subject: resolvedSubject, type, attestor: resolvedAttestor })
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

  server.registerTool('trust-verify', {
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

  server.registerTool('trust-revoke', {
    description: 'Revoke a previously issued attestation. Active identity must match the original attestor.',
    inputSchema: {
      type: z.string().describe('Attestation type being revoked'),
      identifier: z.string().describe('D-tag identifier of the attestation'),
      originalAttestorPubkey: z.string().optional().describe('Hex pubkey of the original attestor (for verification)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
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

  server.registerTool('trust-request', {
    description: 'Send an attestation request to another Nostr identity via NIP-17 encrypted DM.',
    inputSchema: {
      recipientPubkeyHex: z.string().describe('Attestor to request from — name, NIP-05, npub, or hex pubkey'),
      subject: z.string().describe('Subject to be attested — name, NIP-05, npub, or hex pubkey'),
      attestationType: z.string().describe('Type of attestation requested'),
      message: z.string().optional().describe('Optional message explaining the request'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ recipientPubkeyHex, subject, attestationType, message }) => {
    const resolvedRecipient = (await resolveRecipient(recipientPubkeyHex)).pubkeyHex
    const resolvedSubject = (await resolveRecipient(subject)).pubkeyHex
    const result = await handleTrustRequest(deps.ctx, deps.pool, {
      recipientPubkeyHex: resolvedRecipient, subject: resolvedSubject, attestationType, message,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('trust-request-list', {
    description: 'Scan received NIP-17 DMs for attestation request payloads.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const requests = await handleTrustRequestList(deps.ctx, deps.pool)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(requests, null, 2) }],
    }
  })

  server.registerTool('trust-proof-publish', {
    description: 'Publish a cryptographic linkage proof as a kind 30078 event. Requires confirmation — this is irreversible.',
    inputSchema: {
      mode: z.enum(['blind', 'full']).default('blind').describe('Proof mode: blind hides derivation path, full reveals it'),
      confirm: z.boolean().default(false).describe('Set true to publish (irreversible)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ mode, confirm }) => {
    const result = await handleTrustProofPublish(deps.ctx, deps.pool, { mode, confirm })
    if (!result.published) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ warning: result.warning }, null, 2) }] }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event!.id, published: true }, null, 2) }],
    }
  })

  server.registerTool('trust-ring-prove', {
    description: 'Create a ring signature proving anonymous group membership. A verifier can confirm "someone in this ring signed this" but cannot determine who. The active identity must be one of the pubkeys in the ring. Returns kind 30078 event with the signature.',
    inputSchema: {
      ring: z.array(z.string()).describe('Ring members — name, NIP-05, npub, or hex pubkey (must include active identity)'),
      attestationType: z.string().describe('Attestation type context for the canonical message'),
      message: z.string().optional().describe('Custom message to sign (defaults to canonical format)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ ring, attestationType, message }) => {
    const resolved = await resolveRecipients(ring)
    const ringHex = resolved.map(r => r.pubkeyHex)
    const result = await handleTrustRingProve(deps.ctx, deps.pool, { ring: ringHex, attestationType, message })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, ringSize: ring.length }, null, 2) }],
    }
  })

  server.registerTool('trust-ring-verify', {
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

  server.registerTool('trust-spoken-challenge', {
    description: 'Generate a spoken verification token for in-person identity confirmation.',
    inputSchema: {
      secret: z.string().regex(/^[0-9a-f]{32,}$/, 'Hex string, min 32 chars').describe('Shared secret'),
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

  server.registerTool('trust-spoken-verify', {
    description: 'Verify a spoken token response against the shared secret.',
    inputSchema: {
      secret: z.string().regex(/^[0-9a-f]{32,}$/, 'Hex string, min 32 chars').describe('Shared secret'),
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

  // --- Deep attestation tools ---

  server.registerTool('trust-attest-parse', {
    description: 'Parse a kind 31000 attestation event into a fully typed object with all metadata fields: type, subject, assertion references, temporal fields (occurredAt, validFrom, validTo), expiration, schema, revocation status, and content.',
    inputSchema: {
      event: z.record(z.string(), z.unknown()).describe('The attestation event object to parse'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ event }) => {
    const result = handleTrustAttestParse(event as any)
    if (!result) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not a valid kind 31000 attestation event' }, null, 2) }] }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust-attest-filter', {
    description: 'Build a Nostr relay filter for attestation queries. Returns a filter object suitable for relay subscriptions. Supports filtering by type, subject, attestor, schema, and time range.',
    inputSchema: {
      type: z.string().optional().describe('Attestation type to filter by'),
      subject: z.string().optional().describe('Subject — name, NIP-05, npub, or hex pubkey'),
      attestor: z.string().optional().describe('Attestor — name, NIP-05, npub, or hex pubkey'),
      schema: z.string().optional().describe('Schema URI to filter by'),
      since: z.number().int().optional().describe('Unix timestamp — only events after this time'),
      until: z.number().int().optional().describe('Unix timestamp — only events before this time'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ type, subject, attestor, schema, since, until }) => {
    const resolvedSubject = subject ? (await resolveRecipient(subject)).pubkeyHex : undefined
    const resolvedAttestor = attestor ? (await resolveRecipient(attestor)).pubkeyHex : undefined
    const filter = handleTrustAttestFilter({ type, subject: resolvedSubject, attestor: resolvedAttestor, schema, since, until })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(filter, null, 2) }],
    }
  })

  server.registerTool('trust-attest-temporal', {
    description: 'Create and publish an attestation with occurredAt field — records when the attested event actually happened, which may differ from the publication time. Also supports validFrom/validTo for deferred activation and validity windows.',
    inputSchema: {
      type: z.string().optional().describe('Attestation type (required unless assertionId provided)'),
      identifier: z.string().optional().describe('D-tag identifier'),
      subject: z.string().optional().describe('Subject — name, NIP-05, npub, or hex pubkey'),
      assertionId: hexId.optional().describe('Event ID of the assertion to verify'),
      assertionRelay: z.string().optional().describe('Relay hint for the assertion event'),
      summary: z.string().optional().describe('Human-readable summary'),
      content: z.string().optional().describe('Evidence payload (text or JSON)'),
      expiration: z.number().optional().describe('Unix timestamp for attestation expiry'),
      occurredAt: z.number().describe('Unix timestamp when the attested event actually occurred'),
      validFrom: z.number().optional().describe('Unix timestamp for deferred activation'),
      validTo: z.number().optional().describe('Unix timestamp for validity window end'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ type, identifier, subject, assertionId, assertionRelay, summary, content, expiration, occurredAt, validFrom, validTo }) => {
    const resolvedSubject = subject ? (await resolveRecipient(subject)).pubkeyHex : undefined
    const result = await handleTrustAttestTemporal(deps.ctx, deps.pool, {
      type, identifier, subject: resolvedSubject, assertionId, assertionRelay, summary, content, expiration, occurredAt, validFrom, validTo,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        occurredAt,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('trust-attest-chain', {
    description: 'Follow endorsement references to build a transitive trust chain. Starting from a subject, queries attestations about that subject, then follows each attestor as a new subject up to maxDepth. Returns the full chain with validity status for each link.',
    inputSchema: {
      startSubject: z.string().describe('Initial subject to trace from — name, NIP-05, npub, or hex pubkey'),
      type: z.string().optional().describe('Filter by attestation type (narrows the chain)'),
      maxDepth: z.number().int().min(1).max(10).default(3).describe('Maximum chain depth to traverse (default 3, max 10)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ startSubject, type, maxDepth }) => {
    const resolvedStart = (await resolveRecipient(startSubject)).pubkeyHex
    const result = await handleTrustAttestChain(deps.pool, deps.ctx.activeNpub, {
      startSubject: resolvedStart, type, maxDepth,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust-attest-check-revoked', {
    description: 'Check if a specific attestation has been revoked. Queries relays for the latest version of the attestation and checks its revocation status. Provide either (type + identifier) for typed attestations or (assertionId | assertionAddress) for assertion-only attestations.',
    inputSchema: {
      type: z.string().optional().describe('Attestation type (for typed attestations)'),
      identifier: z.string().optional().describe('D-tag identifier (for typed attestations)'),
      assertionId: hexId.optional().describe('Event ID of the referenced assertion (for assertion-only attestations)'),
      assertionAddress: z.string().optional().describe('Addressable coordinate of the referenced assertion'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ type, identifier, assertionId, assertionAddress }) => {
    const result = await handleTrustAttestCheckRevoked(deps.pool, deps.ctx.activeNpub, {
      type, identifier, assertionId, assertionAddress,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Deep ring signature tools ---

  server.registerTool('trust-ring-lsag-sign', {
    description: 'Create an LSAG (Linkable SAG) signature with a key image tied to an election ID. If the same signer signs twice in the same election, the duplicate key image reveals double-action without revealing identity. Use for anonymous voting, one-per-person actions, or fair resource allocation.',
    inputSchema: {
      ring: z.array(z.string()).describe('Ring members — name, NIP-05, npub, or hex pubkey (must include active identity)'),
      electionId: z.string().min(1).describe('Election/context identifier — key image is bound to this (e.g. "vote-2026-q1")'),
      message: z.string().describe('Message to sign'),
      domain: z.string().optional().describe('Domain separator (defaults to "lsag-v1")'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ ring, electionId, message, domain }) => {
    const resolved = await resolveRecipients(ring)
    const ringHex = resolved.map(r => r.pubkeyHex)
    const result = await handleTrustRingLsagSign(deps.ctx, deps.pool, { ring: ringHex, electionId, message, domain })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        keyImage: result.signature.keyImage,
        ringSize: ring.length,
        electionId,
      }, null, 2) }],
    }
  })

  server.registerTool('trust-ring-lsag-verify', {
    description: 'Verify an LSAG signature and check the key image against a list of known images to detect double-signing. Returns validity, key image, and duplicate status.',
    inputSchema: {
      signature: z.record(z.string(), z.unknown()).describe('LSAG signature object or Nostr event containing one'),
      existingKeyImages: z.array(z.string()).optional().describe('Known key images to check for duplicates'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ signature, existingKeyImages }) => {
    const result = handleTrustRingLsagVerify(signature as any, existingKeyImages)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust-ring-key-image', {
    description: 'Compute the key image for the active identity in a specific election context. Use this to pre-check whether the active identity has already signed in an election without creating a full signature. The key image is deterministic: same key + same electionId always produces the same image.',
    inputSchema: {
      electionId: z.string().min(1).describe('Election/context identifier'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ electionId }) => {
    const result = handleTrustRingKeyImage(deps.ctx, { electionId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Deep spoken token tools ---

  server.registerTool('trust-spoken-directional', {
    description: 'Generate a directional token pair where each role gets a different token. Prevents the "echo problem" where the second speaker could parrot the first. Both parties need the shared secret, but each says a different word. Ideal for caller/agent, buyer/seller, or any two-party verification.',
    inputSchema: {
      secret: z.string().regex(/^[0-9a-f]{32,}$/, 'Hex string, min 32 chars').describe('Shared secret'),
      namespace: z.string().min(1).describe('Namespace for domain separation (e.g. "dispatch", "trade")'),
      roles: z.tuple([z.string().min(1), z.string().min(1)]).describe('Exactly two distinct role names (e.g. ["caller", "agent"])'),
      counter: z.number().int().describe('Time-based or usage counter'),
      format: z.enum(['words', 'pin', 'hex']).default('words').describe('Token encoding format'),
      wordCount: z.number().int().min(1).max(16).optional().describe('Number of words (for words format, default 1)'),
      pinDigits: z.number().int().min(1).max(10).optional().describe('Number of digits (for PIN format, default 4)'),
      hexLength: z.number().int().min(1).max(64).optional().describe('Number of hex chars (for hex format, default 8)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret, namespace, roles, counter, format, wordCount, pinDigits, hexLength }) => {
    const result = handleTrustSpokenDirectional({ secret, namespace, roles, counter, format, wordCount, pinDigits, hexLength })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('trust-spoken-encode', {
    description: 'Generate a spoken token in an alternative encoding: PIN digits for phone keypads, hex for technical contexts, or multi-word for higher entropy. Same HMAC derivation as trust-spoken-challenge but with configurable output format.',
    inputSchema: {
      secret: z.string().regex(/^[0-9a-f]{32,}$/, 'Hex string, min 32 chars').describe('Shared secret'),
      context: z.string().describe('Context string for domain separation'),
      counter: z.number().int().describe('Time-based or usage counter'),
      format: z.enum(['words', 'pin', 'hex']).describe('Token encoding format'),
      wordCount: z.number().int().min(1).max(16).optional().describe('Number of words (for words format, default 1)'),
      pinDigits: z.number().int().min(1).max(10).optional().describe('Number of digits (for PIN format, default 4)'),
      hexLength: z.number().int().min(1).max(64).optional().describe('Number of hex chars (for hex format, default 8)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret, context, counter, format, wordCount, pinDigits, hexLength }) => {
    const result = handleTrustSpokenEncode({ secret, context, counter, format, wordCount, pinDigits, hexLength })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
