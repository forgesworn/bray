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

export interface ToolDeps {
  ctx: IdentityContext
  pool: RelayPool
  nip65: Nip65Manager
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
}
