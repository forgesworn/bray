import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import {
  handleLabelCreate,
  handleLabelSelf,
  handleLabelRead,
  handleLabelSearch,
  handleLabelRemove,
  handleListMute,
  handleListMuteRead,
  handleListCheckMuted,
  handleListPin,
  handleListPinRead,
  handleListFollowSetCreate,
  handleListFollowSetManage,
  handleListFollowSetRead,
  handleListBookmark,
  handleListBookmarkRead,
  handleModerationFilter,
} from './handlers.js'

export function registerModerationTools(server: McpServer, deps: ToolDeps): void {

  // ---------------------------------------------------------------------------
  // NIP-32 Label tools (kind 1985)
  // ---------------------------------------------------------------------------

  server.registerTool('label-create', {
    description:
      'Label an event, pubkey, or addressable event using NIP-32 (kind 1985). ' +
      'Requires a namespace (L tag) and label value (l tag). ' +
      'Provide at least one target: targetEventId (e-tag), targetPubkey (p-tag), or targetAddress (a-tag).',
    inputSchema: {
      namespace: z.string().min(1).describe('Label namespace (L tag) — e.g. "ugc", "social.example.com", "org.example.ontology"'),
      label: z.string().min(1).describe('Label value (l tag) — e.g. "spam", "nsfw", "funny"'),
      targetEventId: hexId.optional().describe('Event ID to label (e-tag)'),
      targetPubkey: hexId.optional().describe('Pubkey to label (p-tag)'),
      targetAddress: z.string().optional().describe('Addressable event coordinate to label (a-tag, e.g. "30023:pubkey:slug")'),
      content: z.string().optional().describe('Optional content for the label event'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ namespace, label, targetEventId, targetPubkey, targetAddress, content }) => {
    const result = await handleLabelCreate(deps.ctx, deps.pool, {
      namespace, label, targetEventId, targetPubkey, targetAddress, content,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('label-self', {
    description:
      'Self-label your own content (kind 1985). Useful for content warnings, categories, ' +
      'or classification. The event must be one you authored.',
    inputSchema: {
      namespace: z.string().min(1).describe('Label namespace (L tag)'),
      label: z.string().min(1).describe('Label value (l tag) — e.g. "nsfw", "content-warning/spoiler"'),
      eventId: hexId.describe('Your event ID to self-label'),
      content: z.string().optional().describe('Optional content (e.g. content warning text)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ namespace, label, eventId, content }) => {
    const result = await handleLabelSelf(deps.ctx, deps.pool, {
      namespace, label, eventId, content,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('label-read', {
    description:
      'Query NIP-32 labels for a target event, pubkey, or address. ' +
      'Optionally filter by namespace or labeller pubkey.',
    inputSchema: {
      targetEventId: hexId.optional().describe('Event ID to look up labels for'),
      targetPubkey: hexId.optional().describe('Pubkey to look up labels for'),
      targetAddress: z.string().optional().describe('Addressable event coordinate to look up labels for'),
      namespace: z.string().optional().describe('Filter by label namespace'),
      labeller: hexId.optional().describe('Filter by labeller pubkey'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ targetEventId, targetPubkey, targetAddress, namespace, labeller }) => {
    const labels = await handleLabelRead(deps.pool, deps.ctx.activeNpub, {
      targetEventId, targetPubkey, targetAddress, namespace, labeller,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }],
    }
  })

  server.registerTool('label-search', {
    description:
      'Find all events/pubkeys that have been given a specific label in a namespace. ' +
      'Returns label events matching the namespace + value pair.',
    inputSchema: {
      namespace: z.string().min(1).describe('Label namespace to search within'),
      label: z.string().min(1).describe('Label value to search for'),
      labeller: hexId.optional().describe('Filter by labeller pubkey'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ namespace, label, labeller }) => {
    const labels = await handleLabelSearch(deps.pool, deps.ctx.activeNpub, {
      namespace, label, labeller,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }],
    }
  })

  server.registerTool('label-remove', {
    description: 'Delete a label event via kind 5 deletion. Only works for labels you authored.',
    inputSchema: {
      labelEventId: hexId.describe('Event ID of the label to delete'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ labelEventId }) => {
    const result = await handleLabelRemove(deps.ctx, deps.pool, { labelEventId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // NIP-51 Mute list (kind 10000)
  // ---------------------------------------------------------------------------

  server.registerTool('list-mute', {
    description:
      'Manage your mute list (NIP-51, kind 10000). Add or remove pubkeys, event IDs, keywords, or hashtags. ' +
      'Publishes the updated replaceable event.',
    inputSchema: {
      action: z.enum(['add', 'remove']).describe('Whether to add or remove entries'),
      entries: z.array(z.object({
        type: z.enum(['pubkey', 'event', 'keyword', 'hashtag']).describe('Entry type'),
        value: z.string().min(1).describe('Entry value (hex pubkey, hex event ID, keyword string, or hashtag)'),
      })).min(1).describe('Entries to add or remove'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ action, entries }) => {
    const result = await handleListMute(deps.ctx, deps.pool, { action, entries })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
        totalEntries: result.entries.length,
      }, null, 2) }],
    }
  })

  server.registerTool('list-mute-read', {
    description: 'Read your current mute list (NIP-51, kind 10000). Returns all muted pubkeys, events, keywords, and hashtags.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await handleListMuteRead(deps.pool, deps.ctx.activeNpub)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('list-check-muted', {
    description:
      'Check if a pubkey, event ID, keyword, or hashtag is on your mute list. ' +
      'Returns whether the target is muted and what matched.',
    inputSchema: {
      pubkey: hexId.optional().describe('Pubkey to check'),
      eventId: hexId.optional().describe('Event ID to check'),
      keyword: z.string().optional().describe('Keyword to check (case-insensitive)'),
      hashtag: z.string().optional().describe('Hashtag to check (case-insensitive)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, eventId, keyword, hashtag }) => {
    const result = await handleListCheckMuted(deps.pool, deps.ctx.activeNpub, {
      pubkey, eventId, keyword, hashtag,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // NIP-51 Pinned events (kind 10001)
  // ---------------------------------------------------------------------------

  server.registerTool('list-pin', {
    description: 'Manage pinned events (NIP-51, kind 10001). Add or remove event IDs from your pin list.',
    inputSchema: {
      action: z.enum(['add', 'remove']).describe('Whether to add or remove pins'),
      eventIds: z.array(hexId).min(1).describe('Event IDs to pin or unpin'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ action, eventIds }) => {
    const result = await handleListPin(deps.ctx, deps.pool, { action, eventIds })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
        totalPinned: result.pinned.length,
      }, null, 2) }],
    }
  })

  server.registerTool('list-pin-read', {
    description: 'Read your pinned events list (NIP-51, kind 10001).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await handleListPinRead(deps.pool, deps.ctx.activeNpub)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // NIP-51 Follow sets (kind 30000)
  // ---------------------------------------------------------------------------

  server.registerTool('list-followset-create', {
    description:
      'Create a named follow set (NIP-51, kind 30000). ' +
      'Group contacts into named lists (e.g. "developers", "local-community").',
    inputSchema: {
      name: z.string().min(1).describe('Set name (d-tag identifier)'),
      description: z.string().optional().describe('Human-readable description of the set'),
      pubkeys: z.array(hexId).min(1).describe('Initial member pubkeys'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, description, pubkeys }) => {
    const result = await handleListFollowSetCreate(deps.ctx, deps.pool, {
      name, description, pubkeys,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('list-followset-manage', {
    description: 'Add or remove pubkeys from a named follow set (NIP-51, kind 30000).',
    inputSchema: {
      name: z.string().min(1).describe('Set name (d-tag identifier)'),
      action: z.enum(['add', 'remove']).describe('Whether to add or remove members'),
      pubkeys: z.array(hexId).min(1).describe('Pubkeys to add or remove'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, action, pubkeys }) => {
    const result = await handleListFollowSetManage(deps.ctx, deps.pool, {
      name, action, pubkeys,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
        totalMembers: result.members.length,
      }, null, 2) }],
    }
  })

  server.registerTool('list-followset-read', {
    description: 'Read a named follow set by name (NIP-51, kind 30000).',
    inputSchema: {
      name: z.string().min(1).describe('Set name (d-tag identifier)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ name }) => {
    const result = await handleListFollowSetRead(deps.pool, deps.ctx.activeNpub, { name })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // NIP-51 Bookmarks (kind 10003 general, kind 30001 named sets)
  // ---------------------------------------------------------------------------

  server.registerTool('list-bookmark', {
    description:
      'Manage bookmarks (NIP-51). Without a name, manages general bookmarks (kind 10003). ' +
      'With a name, manages a named bookmark set (kind 30001). ' +
      'Supports event IDs, addressable event coordinates, URLs, and hashtags.',
    inputSchema: {
      name: z.string().optional().describe('Bookmark set name (omit for general bookmarks)'),
      action: z.enum(['add', 'remove']).describe('Whether to add or remove bookmarks'),
      eventIds: z.array(hexId).optional().describe('Event IDs to bookmark'),
      addresses: z.array(z.string()).optional().describe('Addressable event coordinates (a-tags)'),
      urls: z.array(z.string().url()).optional().describe('URLs to bookmark'),
      hashtags: z.array(z.string()).optional().describe('Hashtags to bookmark'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, action, eventIds, addresses, urls, hashtags }) => {
    const result = await handleListBookmark(deps.ctx, deps.pool, {
      name, action, eventIds, addresses, urls, hashtags,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('list-bookmark-read', {
    description:
      'Read bookmarks. Without a name, reads general bookmarks (kind 10003). ' +
      'With a name, reads a named bookmark set (kind 30001).',
    inputSchema: {
      name: z.string().optional().describe('Bookmark set name (omit for general bookmarks)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ name }) => {
    const result = await handleListBookmarkRead(deps.pool, deps.ctx.activeNpub, { name })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  // ---------------------------------------------------------------------------
  // Integration: moderation filter
  // ---------------------------------------------------------------------------

  server.registerTool('moderation-filter', {
    description:
      'Filter a set of events against the active identity\'s mute list. ' +
      'Returns allowed events and blocked events with reasons. ' +
      'Checks pubkeys, event IDs, keywords (in content), and hashtags (in t-tags).',
    inputSchema: {
      events: z.array(z.object({
        id: hexId.describe('Event ID'),
        pubkey: hexId.describe('Author pubkey'),
        content: z.string().describe('Event content'),
        tags: z.array(z.array(z.string())).describe('Event tags'),
      })).describe('Events to filter'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ events }) => {
    const result = await handleModerationFilter(deps.pool, deps.ctx.activeNpub, { events })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
}
