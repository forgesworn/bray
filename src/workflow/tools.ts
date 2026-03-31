import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VeilScoring } from '../veil/scoring.js'
import { TrustCache } from '../veil/cache.js'
import type { SigningContext } from '../signing-context.js'
import { hasExtendedIdentity } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { Nip65Manager } from '../nip65.js'
import type { TrustContext } from '../trust-context.js'
import { hexId } from '../validation.js'
import { resolveRecipient } from '../resolve.js'
import {
  handleTrustScore,
  handleFeedDiscover,
  handleVerifyPerson,
  handleIdentitySetup,
  handleIdentityRecover,
  handleRelayHealth,
  handleOnboardVerified,
} from './handlers.js'

export interface WorkflowDeps {
  ctx: SigningContext
  pool: RelayPool
  nip65: Nip65Manager
  veilCacheTtl: number
  veilCacheMax: number
  trust?: TrustContext
}

export function registerWorkflowTools(server: McpServer, deps: WorkflowDeps): void {
  // Shared trust cache — persists across calls within a session
  const trustCache = new TrustCache({ ttl: deps.veilCacheTtl, maxEntries: deps.veilCacheMax })

  server.registerTool('trust-score', {
    description: 'Compute a trust score for a Nostr identity using the web-of-trust graph and kind 31000 attestations. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      pubkey: z.string().describe('Identity to score — name, NIP-05, npub, or hex pubkey'),
      depth: z.number().int().min(1).max(3).default(2).optional().describe('Social graph traversal depth (1–3, default 2)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, depth }) => {
    const resolved = await resolveRecipient(pubkey)
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const result = await handleTrustScore(deps.ctx, deps.pool, scoring, { pubkey: resolved.pubkeyHex, depth }, deps.trust)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('feed-discover', {
    description: 'Discover new accounts worth following, ranked by trust score. Strategies: trust-adjacent (contacts-of-contacts), topic (hashtag search), active (recent posters in your network).',
    inputSchema: {
      strategy: z.enum(['trust-adjacent', 'topic', 'active']).optional().describe('Discovery strategy (default: trust-adjacent)'),
      limit: z.number().int().min(1).max(100).default(20).optional().describe('Maximum results to return (default 20)'),
      query: z.string().optional().describe('Topic or hashtag for topic strategy'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ strategy, limit, query }) => {
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const result = await handleFeedDiscover(deps.ctx, deps.pool, scoring, { strategy, limit, query }, deps.trust)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('verify-person', {
    description: 'Verify a Nostr identity: checks NIP-05, trust score, kind 31000 attestations, linkage proofs, and (in full mode) ring endorsements and a spoken challenge token. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      pubkey: z.string().describe('Identity to verify — name, NIP-05, npub, or hex pubkey'),
      method: z.enum(['quick', 'full']).optional().describe('Verification depth — quick (default) or full (includes ring proofs and spoken challenge)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, method }) => {
    const resolved = await resolveRecipient(pubkey)
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const result = await handleVerifyPerson(deps.ctx, deps.pool, scoring, { pubkey: resolved.pubkeyHex, method }, deps.trust)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('identity-setup', {
    description: 'Set up a multi-persona identity from the current master secret. Derives named persona sub-identities, optionally creates a Shamir backup and configures relays. Preview mode (confirm: false) shows what would be created without any side effects.',
    inputSchema: {
      personas: z.array(z.string()).optional().describe('Persona names to derive (default: ["social", "commerce"])'),
      shamirThreshold: z.object({
        shares: z.number().int().min(2).describe('Total number of shares to create'),
        threshold: z.number().int().min(2).describe('Minimum shares needed for recovery'),
      }).optional().describe('Shamir secret sharing configuration'),
      relays: z.array(z.string()).optional().describe('Relay URLs to configure for all personas'),
      confirm: z.boolean().optional().describe('Set true to execute (creates shard files and configures relays); false (default) for preview only'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ personas, shamirThreshold, relays, confirm }) => {
    if (!hasExtendedIdentity(deps.ctx)) {
      return { content: [{ type: 'text' as const, text: 'This operation requires a Heartwood-compatible signer or local key mode.' }] }
    }
    const result = await handleIdentitySetup(deps.ctx, deps.pool, { personas, shamirThreshold, relays, confirm })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('identity-recover', {
    description: 'Recover a master identity from Shamir word-list shard files. Reconstructs the secret, derives the master npub, and optionally configures new relays. This operation is destructive — use only when the original identity is inaccessible.',
    inputSchema: {
      shardPaths: z.array(z.string()).min(1).describe('Absolute file paths to Shamir shard files (need at least threshold count)'),
      newRelays: z.array(z.string()).optional().describe('Relay URLs to configure after recovery'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ shardPaths, newRelays }) => {
    const result = await handleIdentityRecover(deps.pool, { shardPaths, newRelays })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('relay-health', {
    description: 'Check health of the active identity\'s configured relays. Reports NIP-11 metadata, response time, whether the user has events on the relay, and optionally write access (publishes a short-lived test event).',
    inputSchema: {
      pubkey: hexId.optional().describe('Hex pubkey to check for events (defaults to active identity)'),
      checkWrite: z.boolean().default(false).optional().describe('Publish a test kind 30078 event to verify write access (default false)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ pubkey, checkWrite }) => {
    const result = await handleRelayHealth(deps.ctx, deps.pool, { pubkey, checkWrite })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  if (deps.trust) {
    const trust = deps.trust
    server.registerTool('onboard-verified', {
      description: 'Guided workflow to build a verified trust profile. Shows your current Signet tier, what steps remain (self-declaration, vouches, professional verification, vault setup), and lists contacts who could vouch for you.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => {
      const result = await handleOnboardVerified(deps.ctx, deps.pool, trust, {})
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    })
  }
}
