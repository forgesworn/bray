import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import {
  handleSocialPost,
  handleSocialReply,
  handleSocialReact,
  handleSocialProfileGet,
  handleSocialProfileSet,
  handleContactsGet,
  handleContactsSearch,
  handleContactsFollow,
  handleContactsUnfollow,
  handleSocialDelete,
  handleSocialRepost,
} from './handlers.js'
import { handleDmSend, handleDmRead } from './dm.js'
import { handleNotifications, handleFeed } from './notifications.js'
import { handleNipPublish, handleNipRead } from './nips.js'
import { handleBlossomUpload, handleBlossomList, handleBlossomDelete } from './blossom.js'
import { handleGroupInfo, handleGroupChat, handleGroupSend, handleGroupMembers } from './groups.js'

export function registerSocialTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('social-post', {
    description: 'Post a text note (kind 1) signed by the active identity and publish to relays. Returns { id, pubkey, publish: { success, accepted, rejected } }. The most common social action.',
    inputSchema: {
      content: z.string().describe('Text content of the note'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
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

  server.registerTool('social-reply', {
    description: 'Reply to a Nostr event (kind 1) with correct threading tags. You need the event ID and the author\'s pubkey — get these from social_feed or social_notifications.',
    inputSchema: {
      content: z.string().describe('Reply text'),
      replyTo: hexId.describe('Event ID being replied to (hex)'),
      replyToPubkey: hexId.describe('Pubkey of the event author (hex)'),
      relay: z.string().optional().describe('Relay URL where the parent event was seen'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ content, replyTo, replyToPubkey, relay }) => {
    const result = await handleSocialReply(deps.ctx, deps.pool, { content, replyTo, replyToPubkey, relay })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('social-react', {
    description: 'React to a Nostr event (kind 7). Pass "+" for like, or any emoji (🤙, ❤️, 🔥). You need the event ID and author pubkey.',
    inputSchema: {
      eventId: hexId.describe('Event ID to react to (hex)'),
      eventPubkey: hexId.describe('Pubkey of the event author (hex)'),
      reaction: z.string().default('+').describe('Reaction content (default "+", or emoji)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ eventId, eventPubkey, reaction }) => {
    const result = await handleSocialReact(deps.ctx, deps.pool, { eventId, eventPubkey, reaction })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('social-delete', {
    description: 'Request deletion of an event you published (kind 5). Relays may or may not honour the request.',
    inputSchema: {
      eventId: hexId.describe('Event ID to delete (hex)'),
      reason: z.string().optional().describe('Reason for deletion'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ eventId, reason }) => {
    const result = await handleSocialDelete(deps.ctx, deps.pool, { eventId, reason })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('social-repost', {
    description: 'Repost/boost a Nostr event (kind 6) as the active identity.',
    inputSchema: {
      eventId: hexId.describe('Event ID to repost (hex)'),
      eventPubkey: hexId.describe('Pubkey of the original author (hex)'),
      relay: z.string().optional().describe('Relay URL where the event was seen'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ eventId, eventPubkey, relay }) => {
    const result = await handleSocialRepost(deps.ctx, deps.pool, { eventId, eventPubkey, relay })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('social-profile-get', {
    description: 'Fetch the kind 0 profile for a Nostr pubkey. Returns parsed profile fields.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to fetch profile for'),
      npub: z.string().optional().describe('Bech32 npub (used for relay routing, defaults to active identity)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkeyHex, npub, output }) => {
    const resolvedNpub = npub ?? deps.ctx.activeNpub
    const profile = await handleSocialProfileGet(deps.pool, resolvedNpub, pubkeyHex)
    return toolResponse(profile, output, fmt.formatProfile)
  })

  server.registerTool('social-profile-set', {
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
    annotations: { readOnlyHint: false, destructiveHint: true },
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

  server.registerTool('dm-send', {
    description: 'Send an encrypted direct message. Default: NIP-17 gift wrap (most private — sender identity hidden behind ephemeral key). Set nip04: true for legacy NIP-04 (only if NIP04_ENABLED=1). Returns { protocol, id, publish }.',
    inputSchema: {
      recipientPubkeyHex: hexId.describe('Recipient hex pubkey'),
      message: z.string().describe('Message text'),
      nip04: z.boolean().default(false).describe('Use legacy NIP-04 instead of NIP-17'),
      recipientRelay: z.string().optional().describe('Relay URL hint for recipient'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ recipientPubkeyHex, message, nip04, recipientRelay }) => {
    const result = await handleDmSend(deps.ctx, deps.pool, {
      recipientPubkeyHex,
      message,
      nip04,
      nip04Enabled: false, // TODO: wire from config
      recipientRelay,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        protocol: result.protocol,
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('dm-read', {
    description: 'Read direct messages addressed to the active identity. Decrypts both NIP-17 (gift wrap) and NIP-04 (legacy). Each message includes { from, content, protocol, decrypted }. Gracefully handles decryption failures without crashing.',
    inputSchema: {
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ output }) => {
    const messages = await handleDmRead(deps.ctx, deps.pool)
    return toolResponse(messages, output, fmt.formatDms)
  })

  server.registerTool('social-notifications', {
    description: 'Fetch notifications for the active identity — mentions, replies, reactions, and zap receipts.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only fetch notifications after this time'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max notifications to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, limit, output }) => {
    const notifications = await handleNotifications(deps.ctx, deps.pool, { since, limit })
    return toolResponse(notifications, output, fmt.formatNotifications)
  })

  server.registerTool('social-feed', {
    description: 'Fetch the kind 1 text note feed. Optionally filter by authors.',
    inputSchema: {
      authors: z.array(hexId).optional().describe('Hex pubkeys to filter by'),
      since: z.number().optional().describe('Unix timestamp — only fetch posts after this time'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max posts to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ authors, since, limit, output }) => {
    const feed = await handleFeed(deps.ctx, deps.pool, { authors, since, limit })
    return toolResponse(feed, output, fmt.formatFeed)
  })

  server.registerTool('contacts-get', {
    description: 'Fetch the contact list (kind 3 follows) for a pubkey. Returns pubkeys, relay hints, and petnames.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to fetch contacts for'),
      npub: z.string().optional().describe('Bech32 npub for relay routing (defaults to active identity)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkeyHex, npub, output }) => {
    const contacts = await handleContactsGet(deps.pool, npub ?? deps.ctx.activeNpub, pubkeyHex)
    return toolResponse(contacts, output, fmt.formatContacts)
  })

  server.registerTool('contacts-search', {
    description: 'Search your contacts by name, display name, or NIP-05. Resolves profiles in one batch — much faster than fetching each individually. Use this to find a contact when you know their name but not their pubkey.',
    inputSchema: {
      query: z.string().describe('Search string (matches name, display_name, nip05, petname — case insensitive)'),
      pubkeyHex: hexId.optional().describe('Hex pubkey whose contacts to search (defaults to active identity)'),
      npub: z.string().optional().describe('Bech32 npub for relay routing (defaults to active identity)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, pubkeyHex, npub, output }) => {
    const resolvedNpub = npub ?? deps.ctx.activeNpub
    const resolvedPubkey = pubkeyHex ?? deps.ctx.activePublicKeyHex
    const results = await handleContactsSearch(deps.pool, resolvedNpub, resolvedPubkey, query)
    return toolResponse(results, output, fmt.formatContactSearch)
  })

  server.registerTool('contacts-follow', {
    description: 'Follow a Nostr pubkey. Fetches current contact list, adds the pubkey, publishes updated kind 3.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to follow'),
      relay: z.string().optional().describe('Relay hint for the contact'),
      petname: z.string().optional().describe('Local petname for the contact'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ pubkeyHex, relay, petname }) => {
    const result = await handleContactsFollow(deps.ctx, deps.pool, { pubkeyHex, relay, petname })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        followCount: result.event.tags.filter(t => t[0] === 'p').length,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('contacts-unfollow', {
    description: 'Unfollow a Nostr pubkey. Fetches current contact list, removes the pubkey, publishes updated kind 3.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to unfollow'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ pubkeyHex }) => {
    const result = await handleContactsUnfollow(deps.ctx, deps.pool, { pubkeyHex })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        followCount: result.event.tags.filter(t => t[0] === 'p').length,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('nip-publish', {
    description: 'Publish a community NIP (kind 30817) — a custom protocol specification on Nostr.',
    inputSchema: {
      identifier: z.string().describe('URL-safe slug for the NIP (e.g. "sovereign-identity")'),
      title: z.string().describe('Human-readable title'),
      content: z.string().describe('Full NIP specification in Markdown'),
      kinds: z.array(z.number().int()).optional().describe('Event kinds defined by this NIP'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ identifier, title, content, kinds }) => {
    const result = await handleNipPublish(deps.ctx, deps.pool, { identifier, title, content, kinds })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }],
    }
  })

  server.registerTool('nip-read', {
    description: 'Fetch community NIPs (kind 30817) from relays. Filter by author, identifier, or defined kind.',
    inputSchema: {
      author: hexId.optional().describe('Author hex pubkey'),
      identifier: z.string().optional().describe('NIP identifier (d-tag)'),
      kind: z.number().int().optional().describe('Event kind defined by the NIP'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, identifier, kind }) => {
    const nips = await handleNipRead(deps.pool, deps.ctx.activeNpub, { author, identifier, kind })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(nips, null, 2) }],
    }
  })

  // --- Blossom ---

  server.registerTool('blossom-upload', {
    description: 'Upload a file to a blossom media server. Returns the blob URL and SHA-256 hash.',
    inputSchema: {
      server: z.string().describe('Blossom server URL (e.g. https://blossom.example.com)'),
      filePath: z.string().describe('Path to the file to upload'),
      contentType: z.string().optional().describe('MIME type (default: application/octet-stream)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ server, filePath, contentType }) => {
    const result = await handleBlossomUpload(deps.ctx, { server, filePath, contentType })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-list', {
    description: 'List blobs uploaded by a pubkey on a blossom server.',
    inputSchema: {
      server: z.string().describe('Blossom server URL'),
      pubkeyHex: hexId.describe('Hex pubkey to list blobs for'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ server, pubkeyHex }) => {
    const blobs = await handleBlossomList({ server, pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(blobs, null, 2) }] }
  })

  server.registerTool('blossom-delete', {
    description: 'Delete a blob from a blossom media server by SHA-256 hash.',
    inputSchema: {
      server: z.string().describe('Blossom server URL'),
      sha256: z.string().describe('SHA-256 hash of the blob'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ server, sha256 }) => {
    const result = await handleBlossomDelete(deps.ctx, { server, sha256 })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  // --- NIP-29 Groups ---

  server.registerTool('group-info', {
    description: 'Fetch group metadata (name, about, picture) for a NIP-29 group.',
    inputSchema: {
      relay: z.string().describe('Relay hosting the group'),
      groupId: z.string().describe('Group identifier'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ relay, groupId }) => {
    const info = await handleGroupInfo(deps.pool, deps.ctx.activeNpub, { relay, groupId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] }
  })

  server.registerTool('group-chat', {
    description: 'Fetch recent chat messages from a NIP-29 group.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max messages'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId, limit }) => {
    const messages = await handleGroupChat(deps.pool, deps.ctx.activeNpub, { groupId, limit })
    return { content: [{ type: 'text' as const, text: JSON.stringify(messages, null, 2) }] }
  })

  server.registerTool('group-send', {
    description: 'Send a message to a NIP-29 group.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      content: z.string().describe('Message text'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ groupId, content }) => {
    const result = await handleGroupSend(deps.ctx, deps.pool, { groupId, content })
    return { content: [{ type: 'text' as const, text: JSON.stringify({ id: result.event.id, publish: result.publish }, null, 2) }] }
  })

  server.registerTool('group-members', {
    description: 'List members of a NIP-29 group.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ groupId }) => {
    const members = await handleGroupMembers(deps.pool, deps.ctx.activeNpub, { groupId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(members, null, 2) }] }
  })
}
