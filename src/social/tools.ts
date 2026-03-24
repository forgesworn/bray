import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import {
  handleSocialPost,
  handleSocialReply,
  handleSocialReact,
  handleSocialProfileGet,
  handleSocialProfileSet,
} from './handlers.js'

export function registerSocialTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('social_post', {
    description: 'Post a text note (kind 1) as the active identity. Returns the signed event.',
    inputSchema: {
      content: z.string().describe('Text content of the note'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ content }) => {
    const result = await handleSocialPost(deps.ctx, deps.pool, { content })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        pubkey: result.event.pubkey,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('social_reply', {
    description: 'Reply to a Nostr event (kind 1 with e-tag and p-tag) as the active identity.',
    inputSchema: {
      content: z.string().describe('Reply text'),
      replyTo: z.string().describe('Event ID being replied to (hex)'),
      replyToPubkey: z.string().describe('Pubkey of the event author (hex)'),
      relay: z.string().optional().describe('Relay URL where the parent event was seen'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ content, replyTo, replyToPubkey, relay }) => {
    const result = await handleSocialReply(deps.ctx, deps.pool, { content, replyTo, replyToPubkey, relay })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('social_react', {
    description: 'React to a Nostr event (kind 7) as the active identity. Default reaction is "+".',
    inputSchema: {
      eventId: z.string().describe('Event ID to react to (hex)'),
      eventPubkey: z.string().describe('Pubkey of the event author (hex)'),
      reaction: z.string().default('+').describe('Reaction content (default "+", or emoji)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ eventId, eventPubkey, reaction }) => {
    const result = await handleSocialReact(deps.ctx, deps.pool, { eventId, eventPubkey, reaction })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('social_profile_get', {
    description: 'Fetch the kind 0 profile for a Nostr pubkey. Returns parsed profile fields.',
    inputSchema: {
      pubkeyHex: z.string().describe('Hex pubkey to fetch profile for'),
      npub: z.string().optional().describe('Bech32 npub (used for relay routing, defaults to active identity)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkeyHex, npub }) => {
    const resolvedNpub = npub ?? deps.ctx.activeNpub
    const profile = await handleSocialProfileGet(deps.pool, resolvedNpub, pubkeyHex)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }],
    }
  })

  server.registerTool('social_profile_set', {
    description: 'Set the kind 0 profile for the active identity. Warns if profile already exists — set confirm: true to overwrite.',
    inputSchema: {
      name: z.string().optional().describe('Display name'),
      about: z.string().optional().describe('About / bio text'),
      picture: z.string().optional().describe('Profile picture URL'),
      nip05: z.string().optional().describe('NIP-05 identifier'),
      banner: z.string().optional().describe('Banner image URL'),
      lud16: z.string().optional().describe('Lightning address'),
      confirm: z.boolean().default(false).describe('Set true to overwrite existing profile'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ confirm, ...fields }) => {
    // Filter out undefined fields
    const profile: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) profile[k] = v
    }
    const result = await handleSocialProfileSet(deps.ctx, deps.pool, { profile, confirm })
    if (!result.published && result.warning) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          warning: result.warning,
          diff: result.diff,
        }, null, 2) }],
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        published: true,
        id: result.event.id,
      }, null, 2) }],
    }
  })
}
