import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { resolveRecipient } from '../resolve.js'
import {
  handleSignetBadge,
  handleSignetVouch,
  handleSignetCredentials,
  handleSignetPolicyCheck,
  handleSignetPolicySet,
  handleSignetVerifiers,
  handleSignetChallenge,
} from './handlers.js'

export function registerSignetTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('signet-badge', {
    description: 'Get a quick trust summary for a pubkey — returns their Signet tier, trust score, composite level, and flags. Use this as a "who is this?" check before interacting with an unknown user.',
    inputSchema: {
      pubkey: z.string().describe('User to assess — name, NIP-05, npub, or hex pubkey'),
    },
    annotations: { title: 'Signet Badge', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolved = await resolveRecipient(args.pubkey)
    const result = await handleSignetBadge(deps.trust!, { ...args, pubkey: resolved.pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-vouch', {
    description: 'Vouch for another user by publishing a kind 31000 attestation signed by the active identity. Use "in-person" when you have physically met the person; "online" for remote verification only. An optional comment can provide context for other verifiers.',
    inputSchema: {
      pubkey: z.string().describe('User to vouch for — name, NIP-05, npub, or hex pubkey'),
      method: z.enum(['in-person', 'online']).default('in-person').describe('Verification method used'),
      comment: z.string().optional().describe('Optional context or notes about this vouch'),
    },
    annotations: { title: 'Signet Vouch', readOnlyHint: false },
  }, async (args) => {
    const resolved = await resolveRecipient(args.pubkey)
    const result = await handleSignetVouch(deps.ctx, deps.pool, { ...args, pubkey: resolved.pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-credentials', {
    description: 'List all kind 31000 Signet credentials held by a pubkey — includes tier, type, method, profession, jurisdiction, age range, and expiry. Use this to inspect a user\'s full credential set.',
    inputSchema: {
      pubkey: z.string().describe('User whose credentials to fetch — name, NIP-05, npub, or hex pubkey'),
    },
    annotations: { title: 'Signet Credentials', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolved = await resolveRecipient(args.pubkey)
    const result = await handleSignetCredentials(deps.pool, deps.ctx.activeNpub, { ...args, pubkey: resolved.pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-policy-check', {
    description: 'Check whether a pubkey satisfies a community\'s Signet access policy. Returns allowed/denied with the required and actual tier/score. Use this before granting access to age-gated or trust-gated content.',
    inputSchema: {
      pubkey: z.string().describe('User to check — name, NIP-05, npub, or hex pubkey'),
      communityId: z.string().describe('Community identifier (matches the d-tag in the policy event)'),
    },
    annotations: { title: 'Signet Policy Check', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolved = await resolveRecipient(args.pubkey)
    const result = await handleSignetPolicyCheck(deps.pool, deps.trust!, deps.ctx.activeNpub, { ...args, pubkey: resolved.pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-policy-set', {
    description: 'Publish a kind 30078 Signet community policy signed by the active identity. Sets minimum verification tiers for adult and child access, optional minimum trust score, and enforcement mode. Use "client" for app-level gating, "relay" to hint relays, "both" for belt-and-braces enforcement.',
    inputSchema: {
      communityId: z.string().describe('Unique community identifier'),
      adultMinTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe('Minimum Signet tier for adult access (1–4)'),
      childMinTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe('Minimum Signet tier for under-18 access (1–4)'),
      minScore: z.number().min(0).max(200).optional().describe('Minimum composite trust score (0–200)'),
      enforcement: z.enum(['client', 'relay', 'both']).optional().describe('Enforcement level: client, relay, or both'),
      description: z.string().optional().describe('Human-readable description of the policy'),
    },
    annotations: { title: 'Signet Policy Set', readOnlyHint: false },
  }, async (args) => {
    const result = await handleSignetPolicySet(deps.ctx, deps.pool, args)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-verifiers', {
    description: 'Search for Signet-registered professional verifiers. Filter by jurisdiction (e.g. "GB") or profession (e.g. "solicitor"). Returns pubkey, npub, profession, jurisdiction, and professional body. Use this to find a suitable verifier before requesting a credential.',
    inputSchema: {
      jurisdiction: z.string().optional().describe('ISO 3166-1 alpha-2 country code (e.g. "GB", "US")'),
      profession: z.string().optional().describe('Profession filter (e.g. "solicitor", "notary")'),
    },
    annotations: { title: 'Signet Verifiers', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const result = await handleSignetVerifiers(deps.pool, deps.ctx.activeNpub, args)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('signet-challenge', {
    description: 'Publish a kind 31000 challenge event against a verifier suspected of misconduct. Provide a reason code and optional supporting evidence text. Use "anomalous-volume" for suspicious attestation rates, "registry-mismatch" when their claimed registration cannot be confirmed, "fraudulent-attestation" for clearly false credentials, "licence-revoked" if their professional licence has lapsed, or "other" for anything else.',
    inputSchema: {
      verifierPubkey: z.string().describe('Verifier being challenged — name, NIP-05, npub, or hex pubkey'),
      reason: z.enum(['anomalous-volume', 'registry-mismatch', 'fraudulent-attestation', 'licence-revoked', 'other']).describe('Reason for the challenge'),
      evidence: z.string().optional().describe('Supporting evidence text'),
    },
    annotations: { title: 'Signet Challenge', readOnlyHint: false },
  }, async (args) => {
    const resolved = await resolveRecipient(args.verifierPubkey)
    const result = await handleSignetChallenge(deps.ctx, deps.pool, { ...args, verifierPubkey: resolved.pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })
}
