import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import { handleDuressConfigure, handleDuressActivate } from './handlers.js'
import {
  handleCanarySessionCreate,
  handleCanarySessionCurrent,
  handleCanarySessionVerify,
  handleCanaryGroupCreate,
  handleCanaryGroupJoin,
  handleCanaryGroupCurrent,
  handleCanaryGroupVerify,
  handleCanaryGroupMembers,
  handleCanaryBeaconCreate,
  handleCanaryBeaconCheck,
  handleCanaryDuressSignal,
  handleCanaryDuressDetect,
} from './canary-handlers.js'

export function registerSafetyTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('safety-configure', {
    description: 'Configure an alternative identity persona and pre-warm relay connections.',
    inputSchema: {
      personaName: z.string().default('anonymous').describe('Persona name for the alternative identity'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ personaName }) => {
    const result = handleDuressConfigure(deps.ctx, deps.pool, { personaName })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // Description intentionally does NOT mention duress — appears as normal identity switch
  server.registerTool('safety-activate', {
    description: 'Switch to an alternative identity configuration.',
    inputSchema: {
      personaName: z.string().default('anonymous').describe('Persona name to switch to'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ personaName }) => {
    const result = handleDuressActivate(deps.ctx, { personaName })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // CANARY Session tools — two-party directional verification
  // ---------------------------------------------------------------------------

  server.registerTool('canary-session-create', {
    description:
      'Create a CANARY verification session for two-party spoken verification. ' +
      'Uses the active identity\'s key as the shared secret. ' +
      'Presets: "call" (phone verification, 30s rotation) or "handoff" (physical handoff, single-use). ' +
      'Returns the session ID and the word you should speak to prove your identity.',
    inputSchema: {
      namespace: z.string().min(1).describe('Namespace for the session (e.g. "aviva", "dispatch")'),
      roles: z.tuple([z.string().min(1), z.string().min(1)]).describe('The two roles in the session (e.g. ["caller", "agent"])'),
      myRole: z.string().min(1).describe('Which role you are'),
      preset: z.enum(['call', 'handoff']).optional().describe('Session preset: "call" (30s rotation) or "handoff" (single-use)'),
      rotationSeconds: z.number().int().min(0).optional().describe('Custom rotation interval in seconds (overrides preset)'),
      tolerance: z.number().int().min(0).max(10).optional().describe('Counter tolerance window (default: from preset)'),
      theirIdentity: z.string().optional().describe('Other party\'s identity string for duress detection'),
      counter: z.number().int().min(0).optional().describe('Fixed counter for handoff mode (required when rotationSeconds=0)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ namespace, roles, myRole, preset, rotationSeconds, tolerance, theirIdentity, counter }) => {
    const result = handleCanarySessionCreate(deps.ctx, {
      namespace, roles, myRole, preset, rotationSeconds, tolerance, theirIdentity, counter,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-session-current', {
    description:
      'Get the current verification words for an active CANARY session. ' +
      'Returns your token (what you speak) and their token (what you expect to hear).',
    inputSchema: {
      sessionId: z.string().min(1).describe('Session ID from canary-session-create'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId }) => {
    const result = handleCanarySessionCurrent({ sessionId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-session-verify', {
    description:
      'Verify a spoken word against an active CANARY session. ' +
      'Returns status: "valid" (correct word), "duress" (coercion signal detected), or "invalid" (wrong word).',
    inputSchema: {
      sessionId: z.string().min(1).describe('Session ID from canary-session-create'),
      spokenWord: z.string().min(1).describe('The word spoken by the other party'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, spokenWord }) => {
    const result = handleCanarySessionVerify({ sessionId, spokenWord })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // CANARY Group tools — multi-member symmetric verification with duress
  // ---------------------------------------------------------------------------

  server.registerTool('canary-group-create', {
    description:
      'Create an encrypted CANARY verification group. All members share a secret seed ' +
      'that generates time-rotating verification words. Any member can verify any other. ' +
      'Presets: "family" (weekly, casual), "field-ops" (daily, high-security), ' +
      '"enterprise" (48h, corporate), "event" (4h, conferences). ' +
      'The active identity is automatically added as creator and admin.',
    inputSchema: {
      name: z.string().min(1).max(256).describe('Group name'),
      members: z.array(hexId).describe('Member pubkeys (64-char hex). Creator is auto-added if missing.'),
      preset: z.enum(['family', 'field-ops', 'enterprise', 'event']).optional().describe('Threat-profile preset'),
      rotationInterval: z.number().int().positive().optional().describe('Custom rotation interval in seconds (overrides preset)'),
      wordCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Words per verification challenge (1, 2, or 3)'),
      tolerance: z.number().int().min(0).max(10).optional().describe('Counter tolerance window (default: 1)'),
      beaconInterval: z.number().int().positive().optional().describe('Beacon broadcast interval in seconds (default: 300)'),
      beaconPrecision: z.number().int().min(1).max(11).optional().describe('Geohash precision for beacons, 1-11 (default: 6)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, members, preset, rotationInterval, wordCount, tolerance, beaconInterval, beaconPrecision }) => {
    const result = handleCanaryGroupCreate(deps.ctx, {
      name, members, preset, rotationInterval, wordCount, tolerance, beaconInterval, beaconPrecision,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-group-join', {
    description:
      'Join an existing CANARY group using a shared seed (received via NIP-17 DM). ' +
      'Reconstructs the group state locally so you can verify words and beacons.',
    inputSchema: {
      groupId: z.string().optional().default('').describe('Group ID (optional, auto-generated if empty)'),
      seed: z.string().regex(/^[0-9a-f]{64}$/).describe('Group seed (64-char hex, received from group creator)'),
      name: z.string().min(1).describe('Group name'),
      members: z.array(hexId).describe('Member pubkeys'),
      rotationInterval: z.number().int().positive().optional().describe('Rotation interval in seconds'),
      wordCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Words per challenge'),
      tolerance: z.number().int().min(0).max(10).optional().describe('Counter tolerance'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ groupId, seed, name, members, rotationInterval, wordCount, tolerance }) => {
    const result = handleCanaryGroupJoin(deps.ctx, {
      groupId, seed, name, members, rotationInterval, wordCount, tolerance,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-group-current', {
    description:
      'Get the current verification word for a CANARY group. ' +
      'All group members derive the same word from the shared seed and current time window.',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID from canary-group-create or canary-group-join'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId }) => {
    const result = handleCanaryGroupCurrent({ groupId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-group-verify', {
    description:
      'Verify a spoken word against a CANARY group. ' +
      'Returns "verified" (exact match), "duress" (coercion signal from a specific member), ' +
      '"stale" (valid but from an adjacent time window), or "failed" (no match).',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID'),
      spokenWord: z.string().min(1).describe('The word spoken by a group member'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId, spokenWord }) => {
    const result = handleCanaryGroupVerify({ groupId, spokenWord })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-group-members', {
    description: 'List members and admins of a CANARY group.',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId }) => {
    const result = handleCanaryGroupMembers({ groupId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // CANARY Beacon tools — encrypted liveness signals
  // ---------------------------------------------------------------------------

  server.registerTool('canary-beacon-create', {
    description:
      'Create an encrypted liveness beacon for a CANARY group. ' +
      'Encrypts the location with the group\'s beacon key (AES-256-GCM). ' +
      'Returns encrypted content suitable for publishing as a Nostr event.',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID'),
      geohash: z.string().min(1).max(11).describe('Geohash string for the location'),
      precision: z.number().int().min(1).max(11).describe('Geohash precision level (1-11)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ groupId, geohash, precision }) => {
    const result = await handleCanaryBeaconCreate({ groupId, geohash, precision })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-beacon-check', {
    description:
      'Check a CANARY beacon\'s status. Pass a beaconId to check a locally tracked beacon, ' +
      'or pass groupId + encrypted content to decrypt and check an incoming beacon. ' +
      'Returns status: "alive" (within expected interval), "overdue" (missed 2+ intervals).',
    inputSchema: {
      beaconId: z.string().optional().describe('Beacon ID from canary-beacon-create'),
      groupId: z.string().optional().describe('Group ID (required with encrypted)'),
      encrypted: z.string().optional().describe('Base64-encoded beacon ciphertext to decrypt'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ beaconId, groupId, encrypted }) => {
    const result = await handleCanaryBeaconCheck({ beaconId, groupId, encrypted })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // CANARY Duress tools — silent coercion signals
  // ---------------------------------------------------------------------------

  server.registerTool('canary-duress-signal', {
    description:
      'Generate a duress signal for a CANARY group. Returns the duress word (indistinguishable ' +
      'from a normal verification word to anyone without the group secret) and an encrypted ' +
      'alert payload. Speaking the duress word silently triggers the alarm for other group members.',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID'),
      geohash: z.string().min(1).max(11).optional().describe('Current location geohash (for the duress alert)'),
      precision: z.number().int().min(1).max(11).optional().describe('Geohash precision'),
      locationSource: z.enum(['beacon', 'verifier', 'none']).optional().describe('How the location was obtained'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ groupId, geohash, precision, locationSource }) => {
    const result = await handleCanaryDuressSignal(deps.ctx, { groupId, geohash, precision, locationSource })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('canary-duress-detect', {
    description:
      'Check if a spoken verification word is a duress signal. ' +
      'Returns whether the word matches a member\'s duress token and which member(s) signalled.',
    inputSchema: {
      groupId: z.string().min(1).describe('Group ID'),
      spokenWord: z.string().min(1).describe('The word to check for duress'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId, spokenWord }) => {
    const result = handleCanaryDuressDetect({ groupId, spokenWord })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
