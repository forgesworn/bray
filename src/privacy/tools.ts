import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import {
  handlePrivacyCommit,
  handlePrivacyOpen,
  handlePrivacyProveRange,
  handlePrivacyVerifyRange,
  handlePrivacyProveAge,
  handlePrivacyVerifyAge,
  handlePrivacyProveThreshold,
  handlePrivacyVerifyThreshold,
  handlePrivacyPublishProof,
  handlePrivacyReadProof,
} from './handlers.js'

export function registerPrivacyTools(server: McpServer, deps: ToolDeps): void {
  // --- Commitment primitives ---

  server.registerTool('privacy-commit', {
    description: 'Create a Pedersen commitment to a secret value. Returns a public commitment point (safe to share) and a blinding factor (keep secret). The commitment cryptographically binds you to the value without revealing it.',
    inputSchema: {
      value: z.number().int().nonnegative().describe('The secret value to commit to (non-negative integer)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ value }) => {
    const result = handlePrivacyCommit({ value })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('privacy-open', {
    description: 'Verify a Pedersen commitment opening. Given the original value and blinding factor, check they match the public commitment. Returns true if the commitment is valid.',
    inputSchema: {
      commitment: z.string().describe('The public commitment point (compressed hex)'),
      value: z.number().int().nonnegative().describe('The claimed value'),
      blinding: z.string().describe('The blinding factor (64-char hex scalar)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ commitment, value, blinding }) => {
    const result = handlePrivacyOpen({ commitment, value, blinding })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Range proof primitives ---

  server.registerTool('privacy-prove-range', {
    description: 'Prove a secret value is within [min, max] without revealing the value. Returns a cryptographic range proof that anyone can verify against the commitment. Optional binding context prevents proof transplanting between credentials.',
    inputSchema: {
      value: z.number().int().nonnegative().describe('The secret value to prove is in range'),
      min: z.number().int().nonnegative().describe('Minimum of the range (inclusive)'),
      max: z.number().int().nonnegative().describe('Maximum of the range (inclusive)'),
      context: z.string().optional().describe('Optional binding context (e.g. subject pubkey) to prevent proof transplanting'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ value, min, max, context }) => {
    const result = handlePrivacyProveRange({ value, min, max, context })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('privacy-verify-range', {
    description: 'Verify a range proof. Checks that the committed value is within [min, max] without learning the value. Supply the same binding context used during proof creation.',
    inputSchema: {
      proof: z.string().describe('The serialised range proof (JSON string)'),
      min: z.number().int().nonnegative().describe('Expected minimum of the range (inclusive)'),
      max: z.number().int().nonnegative().describe('Expected maximum of the range (inclusive)'),
      context: z.string().optional().describe('Expected binding context (must match what prover used)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ proof, min, max, context }) => {
    const result = handlePrivacyVerifyRange({ proof, min, max, context })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Application-level: age proofs ---

  server.registerTool('privacy-prove-age', {
    description: 'Prove age is within a range without revealing the exact age. Supports formats like "18+" (adult), "13-17" (teen), "8-12" (child). Optionally bind to a subject pubkey to prevent transplanting.',
    inputSchema: {
      age: z.number().int().nonnegative().describe('The actual age (secret — not revealed)'),
      ageRange: z.string().describe('Age range to prove: "18+" for adult, "min-max" for band (e.g. "8-12", "13-17")'),
      subjectPubkey: hexId.optional().describe('Subject hex pubkey to bind the proof to (prevents transplanting)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ age, ageRange, subjectPubkey }) => {
    const result = handlePrivacyProveAge({ age, ageRange, subjectPubkey })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('privacy-verify-age', {
    description: 'Verify an age range proof. Checks that the subject is within the expected age range without learning their exact age.',
    inputSchema: {
      proof: z.string().describe('The serialised age range proof (JSON string)'),
      ageRange: z.string().describe('Expected age range: "18+" for adult, "min-max" for band'),
      subjectPubkey: hexId.optional().describe('Expected subject hex pubkey (must match what prover used)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ proof, ageRange, subjectPubkey }) => {
    const result = handlePrivacyVerifyAge({ proof, ageRange, subjectPubkey })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Application-level: threshold proofs ---

  server.registerTool('privacy-prove-threshold', {
    description: 'Prove a value exceeds a threshold without revealing the exact value. Useful for income verification, balance checks, credit scoring. The proof shows value >= threshold.',
    inputSchema: {
      value: z.number().int().nonnegative().describe('The secret value (not revealed)'),
      threshold: z.number().int().nonnegative().describe('The minimum threshold to prove against'),
      context: z.string().optional().describe('Optional binding context to prevent proof transplanting'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ value, threshold, context }) => {
    const result = handlePrivacyProveThreshold({ value, threshold, context })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('privacy-verify-threshold', {
    description: 'Verify a threshold proof. Checks that the committed value is >= threshold without learning the value.',
    inputSchema: {
      proof: z.string().describe('The serialised threshold proof (JSON string)'),
      threshold: z.number().int().nonnegative().describe('Expected minimum threshold'),
      context: z.string().optional().describe('Expected binding context (must match what prover used)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ proof, threshold, context }) => {
    const result = handlePrivacyVerifyThreshold({ proof, threshold, context })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // --- Nostr integration ---

  server.registerTool('privacy-publish-proof', {
    description: 'Publish a range proof as a kind 30078 (NIP-78) Nostr event. Includes the commitment, proof, range description, and optional subject pubkey. The proof can then be discovered and verified by anyone.',
    inputSchema: {
      proof: z.string().describe('The serialised range proof (JSON string) to publish'),
      label: z.string().describe('Human-readable label for this proof (e.g. "age-adult", "income-50k", "credit-good")'),
      subjectPubkey: hexId.optional().describe('Subject hex pubkey — tagged with p-tag for discoverability'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ proof, label, subjectPubkey }) => {
    const result = await handlePrivacyPublishProof(deps.ctx, deps.pool, {
      proof, label, subjectPubkey,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('privacy-read-proof', {
    description: 'Fetch and verify range proof events from relays. Returns a list of proofs with their verification status, labels, ranges, and subject pubkeys.',
    inputSchema: {
      authorPubkey: hexId.optional().describe('Filter by author hex pubkey'),
      label: z.string().optional().describe('Filter by proof label (e.g. "age-adult")'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ authorPubkey, label }) => {
    const results = await handlePrivacyReadProof(deps.pool, deps.ctx.activeNpub, {
      authorPubkey, label,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    }
  })
}
