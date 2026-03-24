import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { Nip65Manager } from '../nip65.js'
import {
  handleIdentityCreate,
  handleIdentityDerive,
  handleIdentityDerivePersona,
  handleIdentitySwitch,
  handleIdentityList,
  handleIdentityProve,
} from './handlers.js'
import { handleBackupShamir, handleRestoreShamir } from './shamir.js'
import { handleIdentityBackup, handleIdentityRestore, handleIdentityMigrate } from './migration.js'

export interface ToolDeps {
  ctx: IdentityContext
  pool: RelayPool
  nip65: Nip65Manager
  nwcUri?: string
}

export function registerIdentityTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('identity_create', {
    description: 'Generate a fresh Nostr identity with a BIP-39 mnemonic seed. Returns the master npub and mnemonic for backup.',
    annotations: { readOnlyHint: false },
  }, async () => {
    const result = handleIdentityCreate()
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_derive', {
    description: 'Derive a child Nostr identity from the active tree root. Returns the new npub.',
    inputSchema: {
      purpose: z.string().describe('Purpose string for derivation (e.g. "messaging", "signing")'),
      index: z.number().int().min(0).default(0).describe('Derivation index (default 0)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ purpose, index }) => {
    const result = handleIdentityDerive(deps.ctx, { purpose, index })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_derive_persona', {
    description: 'Derive a named persona identity (e.g. "work", "personal", "anonymous"). Returns the new npub.',
    inputSchema: {
      name: z.string().describe('Persona name (e.g. "work", "personal", "anonymous")'),
      index: z.number().int().min(0).default(0).describe('Derivation index (default 0)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, index }) => {
    const result = handleIdentityDerivePersona(deps.ctx, { name, index })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_switch', {
    description: 'Switch the active Nostr identity. All subsequent tools operate as the new identity. Use "master" to return to root.',
    inputSchema: {
      target: z.string().describe('Purpose, persona name, or "master" to switch to'),
      index: z.number().int().min(0).optional().describe('Derivation index (if switching by purpose)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ target, index }) => {
    const result = handleIdentitySwitch(deps.ctx, { target, index })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_list', {
    description: 'List all known Nostr identities. Returns npub, purpose, and persona name for each. Never includes private keys.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = handleIdentityList(deps.ctx)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_prove', {
    description: 'Create a cryptographic linkage proof between the master key and the active identity. Defaults to blind proof (no purpose/index revealed).',
    inputSchema: {
      mode: z.enum(['blind', 'full']).default('blind').describe('Proof mode: "blind" hides derivation path, "full" reveals purpose and index'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ mode }) => {
    const proof = handleIdentityProve(deps.ctx, { mode })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(proof, null, 2) }],
    }
  })

  server.registerTool('identity_backup_shamir', {
    description: 'Split the master secret into Shamir shard files. Shard content is written to disk — never returned in the response.',
    inputSchema: {
      threshold: z.number().int().min(2).describe('Minimum shards needed to reconstruct'),
      shares: z.number().int().min(2).describe('Total number of shards to create'),
      outputDir: z.string().describe('Directory to write shard files to'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ threshold, shares, outputDir }) => {
    // Get the raw secret from config (re-parse would be needed in production;
    // for now this tool requires the secret to be passed via a secure channel)
    const result = handleBackupShamir({
      secret: deps.ctx._getPrivateKeyRefForTesting(deps.ctx.activeNpub)!,
      threshold,
      shares,
      outputDir,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        message: `Created ${result.shares} shards (threshold: ${result.threshold})`,
        files: result.files,
      }, null, 2) }],
    }
  })

  server.registerTool('identity_restore_shamir', {
    description: 'Reconstruct a secret from Shamir shard files. Returns the restored npub for verification.',
    inputSchema: {
      files: z.array(z.string()).describe('Paths to shard files'),
      threshold: z.number().int().min(2).describe('Threshold used during backup'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ files, threshold }) => {
    const secret = handleRestoreShamir({ files, threshold })
    // Verify by creating a temporary context from the restored secret
    const { fromNsec } = await import('nsec-tree')
    const root = fromNsec(secret)
    const npub = root.masterPubkey
    root.destroy()
    // Zeroise the restored secret
    secret.fill(0)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        message: 'Secret reconstructed successfully',
        masterNpub: npub,
      }, null, 2) }],
    }
  })

  server.registerTool('identity_backup', {
    description: 'Fetch profile, contacts, relay list, and attestations for a pubkey. Returns a portable JSON bundle (no private keys).',
    inputSchema: {
      pubkeyHex: z.string().describe('Hex pubkey to back up'),
      npub: z.string().optional().describe('Bech32 npub for relay routing (defaults to active identity)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkeyHex, npub }) => {
    const resolvedNpub = npub ?? deps.ctx.activeNpub
    const bundle = await handleIdentityBackup(deps.pool, pubkeyHex, resolvedNpub)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        pubkeyHex: bundle.pubkeyHex,
        eventCount: bundle.events.length,
        kinds: [...new Set(bundle.events.map(e => e.kind))],
      }, null, 2) }],
    }
  })

  server.registerTool('identity_restore', {
    description: 'Re-sign migratable events (profile, contacts, relay list) under the active identity. Skips attestations (trust chain protection).',
    inputSchema: {
      pubkeyHex: z.string().describe('Hex pubkey of the original identity to restore from'),
      npub: z.string().optional().describe('Bech32 npub for relay routing'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ pubkeyHex, npub }) => {
    const resolvedNpub = npub ?? deps.ctx.activeNpub
    const backup = await handleIdentityBackup(deps.pool, pubkeyHex, resolvedNpub)
    const result = await handleIdentityRestore(deps.ctx, deps.pool, backup)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('identity_migrate', {
    description: 'Migrate from an old identity to the active one. Shows preview first — set confirm: true to execute. Publishes linkage proof and re-signs migratable events.',
    inputSchema: {
      oldPubkeyHex: z.string().describe('Hex pubkey of the old identity'),
      oldNpub: z.string().describe('Bech32 npub of the old identity'),
      confirm: z.boolean().default(false).describe('Set true to execute migration (preview by default)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ oldPubkeyHex, oldNpub, confirm }) => {
    const result = await handleIdentityMigrate(deps.ctx, deps.pool, { oldPubkeyHex, oldNpub, confirm })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
