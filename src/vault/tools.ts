import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { resolveRecipient, resolveRecipients } from '../resolve.js'
import {
  handleVaultCreate,
  handleVaultEncrypt,
  handleVaultShare,
  handleVaultRead,
  handleVaultReadShared,
  handleVaultRevoke,
  handleVaultMembers,
  handleVaultConfig,
  handleVaultRotate,
} from './handlers.js'

function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function registerVaultTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('vault-create', {
    description: 'Create a Dominion vault config with named access tiers. Signs and publishes the config as a kind 30078 event. Returns the created event, publish result, and tier names.',
    inputSchema: {
      tiers: z.array(z.string()).describe('Names of the access tiers to create (e.g. ["admin", "member", "guest"])'),
    },
    annotations: { title: 'Create Vault', readOnlyHint: false },
  }, async (args) => {
    const result = await handleVaultCreate(deps.ctx, deps.pool, args)
    return jsonResponse(result)
  })

  server.registerTool('vault-encrypt', {
    description: 'Encrypt content using a content key derived from the active identity for a given tier and epoch. No network access — purely local cryptography. Returns the ciphertext, tier, and epoch used.',
    inputSchema: {
      content: z.string().describe('Plaintext content to encrypt'),
      tier: z.string().describe('Access tier name to derive the content key for'),
      epoch: z.string().optional().describe('Epoch ID to use (defaults to current epoch if omitted)'),
    },
    annotations: { title: 'Vault Encrypt', readOnlyHint: true },
  }, async (args) => {
    const result = handleVaultEncrypt(deps.ctx, args)
    return jsonResponse(result)
  })

  server.registerTool('vault-share', {
    description: 'Derive the content key for a tier and epoch, then distribute encrypted vault shares to recipients via gift-wrapped events. Returns counts of published and failed shares.',
    inputSchema: {
      tier: z.string().describe('Access tier name to share the content key for'),
      recipients: z.array(z.string()).describe('Recipients — name, NIP-05, npub, or hex pubkey for each'),
      epoch: z.string().optional().describe('Epoch ID to share (defaults to current epoch if omitted)'),
    },
    annotations: { title: 'Share Vault Key', readOnlyHint: false },
  }, async (args) => {
    const resolved = await resolveRecipients(args.recipients)
    const result = await handleVaultShare(deps.ctx, deps.pool, { ...args, recipients: resolved.map(r => r.pubkeyHex) })
    return jsonResponse(result)
  })

  server.registerTool('vault-read', {
    description: 'Decrypt ciphertext using the content key derived from the active identity for a given tier and epoch. No network access — purely local cryptography. Returns the plaintext, tier, and epoch.',
    inputSchema: {
      ciphertext: z.string().describe('Encrypted ciphertext to decrypt'),
      tier: z.string().describe('Access tier name the content was encrypted for'),
      epoch: z.string().describe('Epoch ID that was used when encrypting'),
    },
    annotations: { title: 'Vault Read', readOnlyHint: true },
  }, async (args) => {
    const result = handleVaultRead(deps.ctx, args)
    return jsonResponse(result)
  })

  server.registerTool('vault-read-shared', {
    description: 'Decrypt ciphertext using a vault key that was shared with you by another identity. Fetches the encrypted share event from relays, decrypts the content key via NIP-44, then decrypts the ciphertext. Use this when you are a recipient of vault-share, not the vault owner.',
    inputSchema: {
      ciphertext: z.string().describe('Encrypted ciphertext to decrypt'),
      authorPubkey: z.string().describe('Identity that shared the vault key — name, NIP-05, npub, or hex pubkey'),
      tier: z.string().describe('Access tier name the content was encrypted for'),
      epoch: z.string().describe('Epoch ID that was used when encrypting'),
    },
    annotations: { title: 'Read Shared Vault', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolved = await resolveRecipient(args.authorPubkey)
    const result = await handleVaultReadShared(deps.ctx, deps.pool, { ...args, authorPubkey: resolved.pubkeyHex })
    return jsonResponse(result)
  })

  server.registerTool('vault-revoke', {
    description: 'Revoke a pubkey from the vault config. Fetches the current config, adds the pubkey to the revoked list, signs, and republishes the updated config event. Returns the updated event and revoked npub.',
    inputSchema: {
      pubkey: z.string().describe('Identity to revoke — name, NIP-05, npub, or hex pubkey'),
    },
    annotations: { title: 'Revoke Vault Access', readOnlyHint: false },
  }, async (args) => {
    const resolved = await resolveRecipient(args.pubkey)
    const result = await handleVaultRevoke(deps.ctx, deps.pool, { ...args, pubkey: resolved.pubkeyHex })
    return jsonResponse(result)
  })

  server.registerTool('vault-members', {
    description: 'Fetch a vault config and list all members annotated with trust levels. Optionally query another author\'s vault by passing their pubkey. Returns members with npub, tier, and trust annotation.',
    inputSchema: {
      authorPubkey: z.string().optional().describe('Vault owner to inspect — name, NIP-05, npub, or hex pubkey (defaults to active identity)'),
    },
    annotations: { title: 'List Vault Members', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolvedAuthor = args.authorPubkey ? (await resolveRecipient(args.authorPubkey)).pubkeyHex : undefined
    const result = await handleVaultMembers(deps.pool, deps.trust!, deps.ctx.activeNpub, { ...args, authorPubkey: resolvedAuthor })
    return jsonResponse(result)
  })

  server.registerTool('vault-config', {
    description: 'Fetch a vault config and return a summary of tier names, member counts, revoked count, grant count, and current epoch. Optionally inspect another author\'s vault.',
    inputSchema: {
      authorPubkey: z.string().optional().describe('Vault owner to inspect — name, NIP-05, npub, or hex pubkey (defaults to active identity)'),
    },
    annotations: { title: 'Vault Config', readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    const resolvedAuthor = args.authorPubkey ? (await resolveRecipient(args.authorPubkey)).pubkeyHex : undefined
    const result = await handleVaultConfig(deps.pool, deps.ctx.activeNpub, { ...args, authorPubkey: resolvedAuthor })
    return jsonResponse(result)
  })

  server.registerTool('vault-rotate', {
    description: 'Show the current epoch ID and explain how epoch-based key rotation works. Purely informational — to rotate access, revoke recipients and re-share keys for the next epoch.',
    inputSchema: {},
    annotations: { title: 'Vault Rotate Info', readOnlyHint: false },
  }, async () => {
    const result = handleVaultRotate()
    return jsonResponse(result)
  })
}
