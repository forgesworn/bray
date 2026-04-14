import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import { resolveRecipient, resolveRecipients, resolveWithProfile } from '../resolve.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'
import { flatOrWrapped, mergeFlatAndWrapped } from '../util/schema.js'
import { VeilScoring } from '../veil/scoring.js'
import { TrustCache } from '../veil/cache.js'
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
  handlePublishEvent,
} from './handlers.js'
import { handleDmSend, handleDmRead, handleDmConversation } from './dm.js'
import { handleNotifications, handleFeed } from './notifications.js'
import { handleNipPublish, handleNipRead } from './nips.js'
import {
  handleBlossomUpload,
  handleBlossomList,
  handleBlossomDelete,
  handleBlossomMirror,
  handleBlossomCheck,
  handleBlossomDiscover,
  handleBlossomVerify,
  handleBlossomRepair,
  handleBlossomUsage,
  handleBlossomServersGet,
  handleBlossomServersSet,
} from './blossom.js'
import {
  handleGroupInfo, handleGroupChat, handleGroupSend, handleGroupMembers,
  handleGroupCreate, handleGroupUpdate, handleGroupAddUser, handleGroupRemoveUser, handleGroupSetRoles,
} from './groups.js'
import { handleArticlePublish, handleArticleRead, handleArticleList } from './articles.js'
import { handleSearchNotes, handleSearchProfiles, handleHashtagFeed } from './search.js'
import { handleCalendarCreate, handleCalendarRead, handleCalendarRsvp } from './calendar.js'
import { handleBadgeCreate, handleBadgeAward, handleBadgeAccept, handleBadgeList } from './badges.js'
import { handleCommunityCreate, handleCommunityFeed, handleCommunityPost, handleCommunityApprove, handleCommunityList } from './communities.js'
import { handleWikiPublish, handleWikiRead, handleWikiList } from './wiki.js'
import { handlePostSchedule, handlePostQueueList, handlePostQueueCancel } from './scheduled.js'

export function registerSocialTools(server: McpServer, deps: ToolDeps): void {
  const trustCache = new TrustCache({
    ttl: deps.veilCacheTtl ?? 300_000,
    maxEntries: deps.veilCacheMax ?? 500,
  })

  server.registerTool('social-post', {
    description: 'Post a text note (kind 1) signed by the active identity and publish to relays. Returns { id, pubkey, publish: { success, allAccepted, accepted, rejected } } where success is the majority-quorum signal (true when at least one relay accepted and at least half of attempted relays accepted) and allAccepted is true only when every attempted relay accepted. The most common social action.',
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
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const result = await handleSocialReply(deps.ctx, deps.pool, { content, replyTo, replyToPubkey, relay, _scoring: scoring })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        publish: result.publish,
        ...(result.trustWarning ? { trustWarning: result.trustWarning } : {}),
        ...(result.authorTrustScore !== undefined ? { authorTrustScore: result.authorTrustScore } : {}),
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
    description: 'Fetch the kind 0 profile for a Nostr identity. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      pubkey: z.string().describe('Identity to look up — name, NIP-05, npub, or hex pubkey'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, output }) => {
    const resolved = await resolveWithProfile(pubkey, deps.pool, deps.ctx.activeNpub)
    if (resolved.profile) {
      return toolResponse(resolved.profile, output, fmt.formatProfile)
    }
    // Fallback to standard fetch if resolveWithProfile didn't get the profile
    const profile = await handleSocialProfileGet(deps.pool, deps.ctx.activeNpub, resolved.pubkeyHex)
    return toolResponse(profile, output, fmt.formatProfile)
  })

  server.registerTool('social-profile-set', {
    description: 'Set the kind 0 profile for the active identity. Warns if profile already exists — set confirm: true to overwrite. Profile fields may be supplied either as top-level arguments or wrapped in a single "profile" object (both shapes are accepted).',
    inputSchema: {
      ...flatOrWrapped({
        name: z.string().optional().describe('Display name'),
        about: z.string().optional().describe('About / bio text'),
        picture: z.string().optional().describe('Profile picture URL'),
        nip05: z.string().optional().describe('NIP-05 identifier'),
        banner: z.string().optional().describe('Banner image URL'),
        lud16: z.string().optional().describe('Lightning address'),
      }, 'profile'),
      confirm: z.boolean().default(false).describe('Set true to overwrite existing profile'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args) => {
    // Honour either the canonical flat shape or a nested `profile` wrapper. The
    // handler's own interface takes `{ profile, confirm }`, so clients reading
    // that contract naturally send the wrapped shape. Without the merge the
    // MCP SDK strips the unknown top-level key and `handleSocialProfileSet`
    // receives an empty profile, which with `confirm: true` would wipe the
    // user's kind 0 content.
    const { confirm } = args as { confirm?: boolean }
    const merged = mergeFlatAndWrapped<{
      name?: string
      about?: string
      picture?: string
      nip05?: string
      banner?: string
      lud16?: string
    }>(args, 'profile')
    // Re-strip `confirm` which lives at the top level alongside the profile
    // fields but is not part of the kind 0 content.
    const profile: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) {
      if (k === 'confirm') continue
      if (v !== undefined) profile[k] = v
    }
    // Data-loss guard: refuse to publish a kind 0 event with no content even
    // when `confirm: true` is set. This is belt-and-braces against future
    // regressions of the wrapper-stripping bug: if every profile field is
    // stripped somewhere upstream, we stop here rather than signing an empty
    // event that would wipe the user's existing profile.
    if (Object.keys(profile).length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: 'Refusing to publish an empty profile. Supply at least one field (name, about, picture, nip05, banner, or lud16), either at the top level or inside a "profile" object.',
        }, null, 2) }],
      }
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
        id: result.event?.id,
      }, null, 2) }],
    }
  })

  server.registerTool('dm-send', {
    description: 'Send an encrypted direct message. Accepts any identifier: name, NIP-05, npub, or hex pubkey. Default: NIP-17 gift wrap (most private). Set nip04: true for legacy NIP-04 (only if NIP04_ENABLED=1). Use dm-by-name to search your contacts if you are unsure of the exact identity.',
    inputSchema: {
      to: z.string().describe('Recipient — name, NIP-05 ("user@domain"), npub, nprofile, or hex pubkey'),
      message: z.string().describe('Message text'),
      nip04: z.boolean().default(false).describe('Use legacy NIP-04 instead of NIP-17'),
      recipientRelay: z.string().optional().describe('Relay URL hint for recipient'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ to, message, nip04, recipientRelay }) => {
    const resolved = await resolveRecipient(to)
    const result = await handleDmSend(deps.ctx, deps.pool, {
      recipientPubkeyHex: resolved.pubkeyHex,
      message,
      nip04,
      nip04Enabled: deps.nip04Enabled ?? false,
      recipientRelay,
      nip65: deps.nip65,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        protocol: result.protocol,
        id: result.event.id,
        publish: result.publish,
        senderCopyPublish: result.senderCopyPublish,
        ...(result.relayWarning ? { relayWarning: result.relayWarning } : {}),
      }, null, 2) }],
    }
  })

  server.registerTool('dm-read', {
    description: 'Read direct messages addressed to the active identity. Decrypts both NIP-17 (gift wrap) and NIP-04 (legacy). Each message includes { from, content, protocol, decrypted }. Gracefully handles decryption failures without crashing.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only return DMs after this time'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, output }) => {
    const messages = await handleDmRead(deps.ctx, deps.pool, { since })
    return toolResponse(messages, output, fmt.formatDms)
  })

  server.registerTool('dm-by-name', {
    description: 'Send an encrypted DM to a contact by name — no pubkey needed. Searches your contacts, finds the match, and sends the message. Returns an error if zero or multiple matches are found (use contacts-search to disambiguate).',
    inputSchema: {
      name: z.string().describe('Contact name to search for (matches name, display_name, nip05 — case insensitive)'),
      message: z.string().describe('Message text'),
      nip04: z.boolean().default(false).describe('Use legacy NIP-04 instead of NIP-17'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ name, message, nip04 }) => {
    // Search contacts for the name
    const matches = await handleContactsSearch(
      deps.pool, deps.ctx.activeNpub, deps.ctx.activePublicKeyHex, name,
    )

    if (matches.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `No contact found matching "${name}". Use contacts-search to check your contacts.`,
        }, null, 2) }],
      }
    }

    if (matches.length > 1) {
      const names = matches.map(m => m.displayName || m.name || m.pubkey.slice(0, 12) + '...')
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `Multiple contacts match "${name}": ${names.join(', ')}. Be more specific or use dm-send with the exact pubkey.`,
          matches: matches.map(m => ({ pubkey: m.pubkey, name: m.name, displayName: m.displayName })),
        }, null, 2) }],
      }
    }

    const recipient = matches[0]
    const result = await handleDmSend(deps.ctx, deps.pool, {
      recipientPubkeyHex: recipient.pubkey,
      message,
      nip04,
      nip04Enabled: deps.nip04Enabled ?? false,
      nip65: deps.nip65,
    })

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        sentTo: recipient.displayName || recipient.name || recipient.pubkey.slice(0, 12) + '...',
        recipientPubkey: recipient.pubkey,
        protocol: result.protocol,
        id: result.event.id,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('dm-conversation', {
    description: 'Read DM conversation with a specific person. Accepts any identifier: name, NIP-05, npub, or hex pubkey. Shows messages in chronological order.',
    inputSchema: {
      with: z.string().describe('Person to show conversation with — name, NIP-05, npub, or hex pubkey'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max messages to fetch before filtering'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ with: withId, limit, output }) => {
    const resolved = await resolveRecipient(withId)
    const messages = await handleDmConversation(deps.ctx, deps.pool, { withPubkeyHex: resolved.pubkeyHex, limit })
    return toolResponse(messages, output, fmt.formatConversation)
  })

  server.registerTool('social-notifications', {
    description: 'Fetch notifications for the active identity — mentions, replies, reactions, and zap receipts.',
    inputSchema: {
      since: z.number().optional().describe('Unix timestamp — only fetch notifications after this time'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max notifications to return'),
      trust: z.enum(['strict', 'annotate', 'off']).default('strict')
        .describe('Trust filter mode: strict (hide untrusted), annotate (show scores), off (no filtering)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ since, limit, trust, output }) => {
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const notifications = await handleNotifications(deps.ctx, deps.pool, { since, limit, trust, _scoring: scoring })
    return toolResponse(notifications, output, fmt.formatNotifications)
  })

  server.registerTool('social-feed', {
    description: 'Fetch the kind 1 text note feed. Optionally filter by authors.',
    inputSchema: {
      authors: z.array(hexId).optional().describe('Hex pubkeys to filter by'),
      since: z.number().optional().describe('Unix timestamp — only fetch posts after this time'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max posts to return'),
      trust: z.enum(['strict', 'annotate', 'off']).default('strict')
        .describe('Trust filter mode: strict (hide untrusted), annotate (show scores), off (no filtering)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ authors, since, limit, trust, output }) => {
    const scoring = new VeilScoring(deps.pool, trustCache, deps.ctx.activeNpub)
    const feed = await handleFeed(deps.ctx, deps.pool, { authors, since, limit, trust, _scoring: scoring })
    return toolResponse(feed, output, fmt.formatFeed)
  })

  server.registerTool('feed-by-name', {
    description: 'Fetch recent posts by a contact, searching by name instead of pubkey. Returns an error if zero or multiple contacts match.',
    inputSchema: {
      name: z.string().describe('Contact name to search for (case insensitive)'),
      since: z.number().optional().describe('Unix timestamp — only fetch posts after this time'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max posts to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ name, since, limit, output }) => {
    const matches = await handleContactsSearch(
      deps.pool, deps.ctx.activeNpub, deps.ctx.activePublicKeyHex, name,
    )

    if (matches.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `No contact found matching "${name}".`,
        }, null, 2) }],
      }
    }
    if (matches.length > 1) {
      const names = matches.map(m => m.displayName || m.name || m.pubkey.slice(0, 12) + '...')
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `Multiple contacts match "${name}": ${names.join(', ')}. Be more specific.`,
          matches: matches.map(m => ({ pubkey: m.pubkey, name: m.name, displayName: m.displayName })),
        }, null, 2) }],
      }
    }

    const contact = matches[0]
    const feed = await handleFeed(deps.ctx, deps.pool, { authors: [contact.pubkey], since, limit })
    return toolResponse(
      { contact: { name: contact.displayName || contact.name, pubkey: contact.pubkey }, posts: feed },
      output,
      (data: any) => {
        const header = `Posts by ${data.contact.name ?? data.contact.pubkey.slice(0, 12) + '...'}:`
        if (data.posts.length === 0) return `${header}\n  No posts found.`
        return `${header}\n${fmt.formatFeed(data.posts)}`
      },
    )
  })

  server.registerTool('profile-by-name', {
    description: 'Look up a contact\'s full profile by name — no pubkey needed. Searches your contacts and returns the kind 0 profile for the match.',
    inputSchema: {
      name: z.string().describe('Contact name to search for (case insensitive)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ name, output }) => {
    const matches = await handleContactsSearch(
      deps.pool, deps.ctx.activeNpub, deps.ctx.activePublicKeyHex, name,
    )

    if (matches.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `No contact found matching "${name}".`,
        }, null, 2) }],
      }
    }
    if (matches.length > 1) {
      const names = matches.map(m => m.displayName || m.name || m.pubkey.slice(0, 12) + '...')
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: `Multiple contacts match "${name}": ${names.join(', ')}. Be more specific.`,
          matches: matches.map(m => ({ pubkey: m.pubkey, name: m.name, displayName: m.displayName })),
        }, null, 2) }],
      }
    }

    const contact = matches[0]
    const profile = await handleSocialProfileGet(deps.pool, deps.ctx.activeNpub, contact.pubkey)
    return toolResponse(
      { ...profile, _pubkey: contact.pubkey },
      output,
      (data: any) => {
        const { _pubkey, ...fields } = data
        return `Pubkey: ${_pubkey}\n${fmt.formatProfile(fields)}`
      },
    )
  })

  server.registerTool('contacts-get', {
    description: 'Fetch the contact list (kind 3 follows) for a Nostr identity. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      pubkey: z.string().describe('Identity to fetch contacts for — name, NIP-05, npub, or hex pubkey'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, output }) => {
    const resolved = await resolveRecipient(pubkey)
    const contacts = await handleContactsGet(deps.pool, deps.ctx.activeNpub, resolved.pubkeyHex)
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
    description: 'Follow a Nostr pubkey. Fetches current contact list, adds the pubkey, publishes updated kind 3. If the list would shrink by >20%, returns a guarded warning — pass confirm: true to proceed.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to follow'),
      relay: z.string().optional().describe('Relay hint for the contact'),
      petname: z.string().optional().describe('Local petname for the contact'),
      confirm: z.boolean().optional().describe('Set true to bypass the contacts safety guard'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ pubkeyHex, relay, petname, confirm }) => {
    const result = await handleContactsFollow(deps.ctx, deps.pool, { pubkeyHex, relay, petname, confirm })
    if ('guarded' in result) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        followCount: result.event.tags.filter(t => t[0] === 'p').length,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('contacts-unfollow', {
    description: 'Unfollow a Nostr pubkey. Fetches current contact list, removes the pubkey, publishes updated kind 3. If the list would shrink by >20%, returns a guarded warning — pass confirm: true to proceed.',
    inputSchema: {
      pubkeyHex: hexId.describe('Hex pubkey to unfollow'),
      confirm: z.boolean().optional().describe('Set true to bypass the contacts safety guard'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ pubkeyHex, confirm }) => {
    const result = await handleContactsUnfollow(deps.ctx, deps.pool, { pubkeyHex, confirm })
    if ('guarded' in result) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    }
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

  server.registerTool('blossom-mirror', {
    description: 'Upload a file to multiple blossom servers for redundancy. Provide a source URL (existing blob), file path, or data. Uploads to each server in parallel and returns per-server results with verified SHA-256 hash.',
    inputSchema: {
      servers: z.array(z.string()).min(1).max(10).describe('Target blossom server URLs to mirror to'),
      sourceUrl: z.string().optional().describe('URL of an existing blob to mirror (fetched and re-uploaded)'),
      filePath: z.string().optional().describe('Path to a local file to mirror'),
      contentType: z.string().optional().describe('MIME type (default: application/octet-stream)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ servers, sourceUrl, filePath, contentType }) => {
    const result = await handleBlossomMirror(deps.ctx, { servers, sourceUrl, filePath, contentType })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-check', {
    description: 'Verify a blob exists and is intact on a blossom server. HEAD request to check existence, optionally downloads and verifies SHA-256 hash matches.',
    inputSchema: {
      server: z.string().describe('Blossom server URL'),
      sha256: z.string().describe('Expected SHA-256 hash of the blob'),
      verify: z.boolean().default(false).describe('Download and verify hash integrity (slower but thorough)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ server, sha256, verify }) => {
    const result = await handleBlossomCheck({ server, sha256, verify })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-discover', {
    description: 'Discover blossom servers used by contacts. Fetches kind 10063 (NIP-B7 server list) events from the given pubkeys and aggregates unique server URLs. Use contacts-get first to get pubkeys.',
    inputSchema: {
      pubkeys: z.array(hexId).min(1).describe('Hex pubkeys to discover servers from (e.g. your contacts)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkeys }) => {
    const result = await handleBlossomDiscover(deps.pool, deps.ctx.activeNpub, { pubkeys })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-verify', {
    description: 'Verify all media URLs in a note are still accessible. Pass the note content and get back alive/broken status per URL. Optionally verifies SHA-256 hash integrity for blossom URLs.',
    inputSchema: {
      content: z.string().describe('Note content containing media URLs to verify'),
      verifyHash: z.boolean().default(false).describe('Also verify SHA-256 hashes for blossom URLs (slower)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ content, verifyHash }) => {
    const result = await handleBlossomVerify({ content, verifyHash })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-repair', {
    description: 'Find a broken blob on other blossom servers by SHA-256 hash and optionally re-upload to a target server. Searches each server, verifies hash integrity, and re-uploads if found.',
    inputSchema: {
      sha256: z.string().describe('SHA-256 hash of the missing/broken blob'),
      searchServers: z.array(z.string()).min(1).max(20).describe('Blossom servers to search for the blob'),
      targetServer: z.string().optional().describe('Server to re-upload to if found (omit to just locate)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ sha256, searchServers, targetServer }) => {
    const result = await handleBlossomRepair(deps.ctx, { sha256, searchServers, targetServer })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-usage', {
    description: 'Check storage usage across blossom servers for a pubkey. Returns per-server blob count and total size, plus aggregate totals.',
    inputSchema: {
      servers: z.array(z.string()).min(1).max(20).describe('Blossom server URLs to check'),
      pubkeyHex: hexId.describe('Hex pubkey to check usage for'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ servers, pubkeyHex }) => {
    const result = await handleBlossomUsage({ servers, pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('blossom-servers', {
    description: 'Read or update your preferred blossom server list (kind 10063). Without servers parameter, reads the current list. With servers parameter, publishes a new list.',
    inputSchema: {
      servers: z.array(z.string()).optional().describe('New server list to publish (omit to read current list)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ servers }) => {
    if (servers && servers.length > 0) {
      const result = await handleBlossomServersSet(deps.ctx, deps.pool, { servers })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    }
    const result = await handleBlossomServersGet(deps.pool, deps.ctx.activeNpub, deps.ctx.activePublicKeyHex)
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

  // --- NIP-29 group admin write ops ---

  server.registerTool('group-create', {
    description: 'Create a NIP-29 group (kind 9004 admin event). The relay assigns membership state from the event. Optionally supply a group ID; the relay may derive its own from the event ID.',
    inputSchema: {
      groupId: z.string().optional().describe('Desired group identifier (relay may override)'),
      name: z.string().optional().describe('Group display name'),
      about: z.string().optional().describe('Group description'),
      picture: z.string().optional().describe('Group picture URL'),
      isOpen: z.boolean().optional().describe('True = open (anyone can join); false = closed (invite-only)'),
    },
  }, async ({ groupId, name, about, picture, isOpen }) => {
    const result = await handleGroupCreate(deps.ctx, deps.pool, { groupId, name, about, picture, isOpen })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('group-update', {
    description: 'Update NIP-29 group metadata (kind 9002 admin event). Supply only the fields you want to change.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      name: z.string().optional().describe('New group display name'),
      about: z.string().optional().describe('New group description'),
      picture: z.string().optional().describe('New group picture URL'),
      isOpen: z.boolean().optional().describe('True = open; false = closed'),
    },
  }, async ({ groupId, name, about, picture, isOpen }) => {
    const result = await handleGroupUpdate(deps.ctx, deps.pool, { groupId, name, about, picture, isOpen })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('group-add-user', {
    description: 'Add or update a user\'s membership in a NIP-29 group (kind 9000 admin event). Optionally assign a role.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      pubkeyHex: z.string().describe('Member\'s public key in hex'),
      role: z.string().optional().describe('Role name (e.g. admin, moderator)'),
    },
  }, async ({ groupId, pubkeyHex, role }) => {
    const result = await handleGroupAddUser(deps.ctx, deps.pool, { groupId, pubkeyHex, role })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('group-remove-user', {
    description: 'Remove a user from a NIP-29 group (kind 9001 admin event).',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      pubkeyHex: z.string().describe('Member\'s public key in hex'),
    },
  }, async ({ groupId, pubkeyHex }) => {
    const result = await handleGroupRemoveUser(deps.ctx, deps.pool, { groupId, pubkeyHex })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('group-set-roles', {
    description: 'Define role names and their permissions in a NIP-29 group (kind 9007 admin event). Each role entry is { name, permissions? }.',
    inputSchema: {
      groupId: z.string().describe('Group identifier'),
      roles: z.array(z.object({
        name: z.string().describe('Role name'),
        permissions: z.array(z.string()).optional().describe('Permission strings (e.g. write, delete, ban)'),
      })).describe('Roles to define'),
    },
  }, async ({ groupId, roles }) => {
    const result = await handleGroupSetRoles(deps.ctx, deps.pool, { groupId, roles })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  // --- NIP-23 Long-form Articles ---

  server.registerTool('article-publish', {
    description: 'Publish a long-form article (NIP-23, kind 30023). Creates a replaceable event with title, markdown content, and optional metadata. The slug (d-tag) defaults to a slugified version of the title.',
    inputSchema: {
      title: z.string().describe('Article title'),
      content: z.string().describe('Article body in Markdown'),
      summary: z.string().optional().describe('Short summary / abstract'),
      image: z.string().optional().describe('Header image URL'),
      published_at: z.string().optional().describe('Publication date as ISO string (defaults to now)'),
      hashtags: z.array(z.string()).optional().describe('Hashtag labels (without #)'),
      slug: z.string().optional().describe('URL-safe identifier (d-tag) — defaults to slugified title'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ title, content, summary, image, published_at, hashtags, slug }) => {
    const result = await handleArticlePublish(deps.ctx, deps.pool, {
      title, content, summary, image, published_at, hashtags, slug,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        pubkey: result.event.pubkey,
        slug: result.event.tags.find(t => t[0] === 'd')?.[1],
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('article-read', {
    description: 'Read long-form article(s) (NIP-23, kind 30023) by author. Optionally fetch a specific article by slug. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      author: z.string().describe('Author — name, NIP-05, npub, or hex pubkey'),
      slug: z.string().optional().describe('Article slug (d-tag) — omit to fetch all articles by author'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, slug, output }) => {
    const resolved = await resolveRecipient(author)
    const articles = await handleArticleRead(deps.pool, deps.ctx.activeNpub, {
      author: resolved.pubkeyHex, slug,
    })
    return toolResponse(articles, output, fmt.formatArticle)
  })

  server.registerTool('article-list', {
    description: 'List long-form article metadata (NIP-23, kind 30023) by author — titles, slugs, summaries, and dates without full content. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      author: z.string().describe('Author — name, NIP-05, npub, or hex pubkey'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max articles to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, limit, output }) => {
    const resolved = await resolveRecipient(author)
    const articles = await handleArticleList(deps.pool, deps.ctx.activeNpub, {
      author: resolved.pubkeyHex, limit,
    })
    return toolResponse(articles, output, fmt.formatArticleList)
  })

  // --- NIP-50 Search ---

  server.registerTool('search-notes', {
    description: 'Full-text search for notes (kind 1) using NIP-50. Requires relay support for NIP-50 — if results are empty, try relay-info to check NIP support. Optionally specify relays known to support NIP-50.',
    inputSchema: {
      query: z.string().describe('Search query string'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max results to return'),
      since: z.number().optional().describe('Unix timestamp — only notes after this time'),
      relays: z.array(z.string()).optional().describe('Explicit relay URLs to search (use relays known to support NIP-50)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit, since, relays, output }) => {
    const results = await handleSearchNotes(deps.pool, deps.ctx.activeNpub, { query, limit, since, relays })
    return toolResponse(results, output, fmt.formatSearchResults)
  })

  server.registerTool('search-profiles', {
    description: 'Search for Nostr profiles (kind 0) by keyword using NIP-50. Requires relay support for NIP-50 — if results are empty, try relay-info to check NIP support.',
    inputSchema: {
      query: z.string().describe('Search query (name, about, NIP-05, etc.)'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max profiles to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit, output }) => {
    const results = await handleSearchProfiles(deps.pool, deps.ctx.activeNpub, { query, limit })
    return toolResponse(results, output, fmt.formatProfileSearchResults)
  })

  server.registerTool('hashtag-feed', {
    description: 'Fetch notes (kind 1) with a specific hashtag. Uses standard tag filtering — works on all relays, no NIP-50 required.',
    inputSchema: {
      hashtag: z.string().describe('Hashtag to search for (without the #)'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max notes to return'),
      since: z.number().optional().describe('Unix timestamp — only notes after this time'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ hashtag, limit, since, output }) => {
    const results = await handleHashtagFeed(deps.pool, deps.ctx.activeNpub, { hashtag, limit, since })
    return toolResponse(results, output, fmt.formatSearchResults)
  })

  // --- NIP-52 Calendar Events ---

  server.registerTool('calendar-create', {
    description: 'Create a calendar event (NIP-52). Auto-detects date-based (kind 31922, YYYY-MM-DD) vs time-based (kind 31923, ISO datetime). Returns the signed event and publish result.',
    inputSchema: {
      title: z.string().describe('Event title'),
      content: z.string().describe('Event description'),
      start: z.string().describe('Start — YYYY-MM-DD for date-based, ISO datetime for time-based (auto-detected)'),
      end: z.string().optional().describe('End — same format as start'),
      location: z.string().optional().describe('Location name or address'),
      geohash: z.string().optional().describe('Geohash for the location'),
      participants: z.array(z.string()).optional().describe('Participant identifiers — name, NIP-05, npub, or hex pubkey'),
      hashtags: z.array(z.string()).optional().describe('Hashtag labels (without #)'),
      image: z.string().optional().describe('Event image URL'),
      slug: z.string().optional().describe('URL-safe identifier (d-tag) — defaults to slugified title'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ title, content, start, end, location, geohash, participants, hashtags, image, slug }) => {
    // Resolve participant identifiers to hex pubkeys
    let resolvedParticipants: string[] | undefined
    if (participants && participants.length > 0) {
      const resolved = await resolveRecipients(participants)
      resolvedParticipants = resolved.map(r => r.pubkeyHex)
    }

    const result = await handleCalendarCreate(deps.ctx, deps.pool, {
      title, content, start, end, location, geohash,
      participants: resolvedParticipants, hashtags, image, slug,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        pubkey: result.event.pubkey,
        kind: result.event.kind,
        slug: result.event.tags.find(t => t[0] === 'd')?.[1],
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('calendar-read', {
    description: 'Fetch calendar events (NIP-52, kinds 31922 + 31923) by author and/or date range. Accepts any identifier for author: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      author: z.string().optional().describe('Author — name, NIP-05, npub, or hex pubkey'),
      since: z.string().optional().describe('Only events starting after this date (ISO datetime or YYYY-MM-DD)'),
      until: z.string().optional().describe('Only events starting before this date (ISO datetime or YYYY-MM-DD)'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max events to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, since, until, limit, output }) => {
    let authorHex: string | undefined
    if (author) {
      const resolved = await resolveRecipient(author)
      authorHex = resolved.pubkeyHex
    }
    const events = await handleCalendarRead(deps.pool, deps.ctx.activeNpub, {
      author: authorHex, since, until, limit,
    })
    return toolResponse(events, output, fmt.formatCalendarEvents)
  })

  server.registerTool('calendar-rsvp', {
    description: 'RSVP to a calendar event (NIP-52, kind 31925). Pass the event coordinate (kind:pubkey:d-tag format) and your status.',
    inputSchema: {
      eventCoordinate: z.string().describe('Event coordinate — kind:pubkey:d-tag format (e.g. 31923:abc123:my-event)'),
      status: z.enum(['accepted', 'declined', 'tentative']).describe('RSVP status'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ eventCoordinate, status }) => {
    const result = await handleCalendarRsvp(deps.ctx, deps.pool, { eventCoordinate, status })
    return {
      content: [{ type: 'text' as const, text: fmt.formatRsvp(result) }],
    }
  })

  // --- NIP-58 Badges ---

  server.registerTool('badge-create', {
    description: 'Define a new badge (NIP-58, kind 30009). Creates a replaceable badge definition with name, description, and optional image.',
    inputSchema: {
      slug: z.string().describe('Badge identifier (d-tag)'),
      name: z.string().describe('Human-readable badge name'),
      description: z.string().describe('What the badge represents'),
      image: z.string().optional().describe('Badge image URL'),
      thumb: z.string().optional().describe('Badge thumbnail URL'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ slug, name, description, image, thumb, output }) => {
    const result = await handleBadgeCreate(deps.ctx, deps.pool, { slug, name, description, image, thumb })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('badge-award', {
    description: 'Award a badge to one or more recipients (NIP-58, kind 8). The badge must be defined first via badge-create.',
    inputSchema: {
      badge_slug: z.string().describe('Badge identifier (d-tag from badge-create)'),
      recipients: z.array(z.string()).describe('Recipients — names, NIP-05, npubs, or hex pubkeys'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ badge_slug, recipients, output }) => {
    const resolved = await resolveRecipients(recipients)
    const result = await handleBadgeAward(deps.ctx, deps.pool, {
      badgeSlug: badge_slug,
      recipients: resolved.map(r => r.pubkeyHex),
    })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('badge-accept', {
    description: 'Accept a badge and add it to your profile badges (NIP-58, kind 30008). Updates your profile badge list preserving existing badges.',
    inputSchema: {
      badge_coord: z.string().describe('Badge definition coordinate (e.g. "30009:pubkey:slug")'),
      award_event_id: z.string().describe('Event ID of the badge award (kind 8)'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ badge_coord, award_event_id, output }) => {
    const result = await handleBadgeAccept(deps.ctx, deps.pool, {
      badgeDefinitionCoord: badge_coord,
      awardEventId: award_event_id,
    })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('badge-list', {
    description: 'List badges defined by an author or displayed on a profile (NIP-58). Mode "defined" shows badge definitions, "profile" shows accepted badges.',
    inputSchema: {
      pubkey: z.string().describe('Identity — name, NIP-05, npub, or hex pubkey'),
      mode: z.enum(['defined', 'profile']).describe('"defined" for badges created by this person, "profile" for badges they display'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, mode, output }) => {
    const resolved = await resolveRecipient(pubkey)
    const result = await handleBadgeList(deps.pool, deps.ctx.activeNpub, { pubkey: resolved.pubkeyHex, mode })
    return toolResponse(result, output, fmt.formatBadges)
  })

  // --- NIP-72 Communities ---

  server.registerTool('community-create', {
    description: 'Create a moderated community (NIP-72, kind 34550). Communities are open and approval-based, different from NIP-29 closed groups.',
    inputSchema: {
      name: z.string().describe('Community name (d-tag identifier)'),
      description: z.string().describe('Community description'),
      image: z.string().optional().describe('Community image URL'),
      rules: z.string().optional().describe('Community rules'),
      moderators: z.array(z.string()).optional().describe('Moderator identities — names, NIP-05, npubs, or hex pubkeys'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ name, description, image, rules, moderators, output }) => {
    const resolvedMods = moderators ? await resolveRecipients(moderators) : []
    const result = await handleCommunityCreate(deps.ctx, deps.pool, {
      name, description, image, rules,
      moderators: resolvedMods.map(r => r.pubkeyHex),
    })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('community-feed', {
    description: 'Read approved posts in a community (NIP-72). Fetches kind 4550 approved posts and unwraps the original content.',
    inputSchema: {
      community: z.string().describe('Community coordinate (e.g. "34550:pubkey:name" or naddr)'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max posts to return'),
      since: z.number().optional().describe('Unix timestamp — only posts after this time'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ community, limit, since, output }) => {
    const result = await handleCommunityFeed(deps.pool, deps.ctx.activeNpub, { community, limit, since })
    return toolResponse(result, output, fmt.formatCommunityFeed)
  })

  server.registerTool('community-post', {
    description: 'Post to a community (NIP-72). Creates a kind 1 note with an a-tag pointing to the community. A moderator must approve it before it appears in the feed.',
    inputSchema: {
      community: z.string().describe('Community coordinate (e.g. "34550:pubkey:name" or naddr)'),
      content: z.string().describe('Post content'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ community, content, output }) => {
    const result = await handleCommunityPost(deps.ctx, deps.pool, { community, content })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('community-approve', {
    description: 'Approve a post in a community you moderate (NIP-72, kind 4550). Wraps the original event for inclusion in the community feed.',
    inputSchema: {
      community: z.string().describe('Community coordinate'),
      event_id: z.string().describe('Event ID of the post to approve'),
      event_pubkey: z.string().describe('Author of the post — name, NIP-05, npub, or hex pubkey'),
      output: z.enum(['json', 'human']).default('json').describe('Response format'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ community, event_id, event_pubkey, output }) => {
    const resolved = await resolveRecipient(event_pubkey)
    const result = await handleCommunityApprove(deps.ctx, deps.pool, {
      community, eventId: event_id, eventPubkey: resolved.pubkeyHex,
    })
    return toolResponse(result, output, fmt.formatPublish)
  })

  server.registerTool('community-list', {
    description: 'Discover communities on Nostr (NIP-72). Fetches kind 34550 community definitions.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe('Max communities to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit, output }) => {
    const result = await handleCommunityList(deps.pool, deps.ctx.activeNpub, { limit })
    return toolResponse(result, output, fmt.formatCommunities)
  })

  // --- NIP-54 Wiki ---

  server.registerTool('wiki-publish', {
    description: 'Publish or update a wiki article (NIP-54, kind 30818). Creates a replaceable event keyed by topic (d-tag). Content convention is Asciidoc but Markdown is widely accepted. Articles are collaborative — anyone can publish a revision for the same topic.',
    inputSchema: {
      topic: z.string().describe('Article topic / slug (d-tag) — lowercase, hyphens instead of spaces'),
      title: z.string().describe('Human-readable article title'),
      content: z.string().describe('Article body (Asciidoc or Markdown)'),
      summary: z.string().optional().describe('Short summary of the article'),
      hashtags: z.array(z.string()).optional().describe('Topic hashtags (without #)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ topic, title, content, summary, hashtags }) => {
    const result = await handleWikiPublish(deps.ctx, deps.pool, {
      topic, title, content, summary, hashtags,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        pubkey: result.event.pubkey,
        topic: result.event.tags.find(t => t[0] === 'd')?.[1],
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('wiki-read', {
    description: 'Read wiki article(s) by topic (NIP-54, kind 30818). Without an author, returns versions from multiple authors sorted by recency — readers pick the version from the author they trust most. Accepts any identifier for author: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      topic: z.string().describe('Article topic / slug (d-tag)'),
      author: z.string().optional().describe('Author — name, NIP-05, npub, or hex pubkey (omit to see all authors)'),
      limit: z.number().int().min(1).max(100).default(10).describe('Max articles to return (when no author specified)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ topic, author, limit, output }) => {
    let authorHex: string | undefined
    if (author) {
      const resolved = await resolveRecipient(author)
      authorHex = resolved.pubkeyHex
    }
    const articles = await handleWikiRead(deps.pool, deps.ctx.activeNpub, {
      topic, author: authorHex, limit,
    })
    return toolResponse(articles, output, fmt.formatWikiArticles)
  })

  server.registerTool('wiki-list', {
    description: 'List wiki topics (NIP-54, kind 30818). Returns unique topics with latest title, summary, and author. Optionally filter by author. Accepts any identifier: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      author: z.string().optional().describe('Author — name, NIP-05, npub, or hex pubkey (omit to list all topics)'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max topics to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, limit, output }) => {
    let authorHex: string | undefined
    if (author) {
      const resolved = await resolveRecipient(author)
      authorHex = resolved.pubkeyHex
    }
    const topics = await handleWikiList(deps.pool, deps.ctx.activeNpub, {
      author: authorHex, limit,
    })
    return toolResponse(topics, output, fmt.formatWikiList)
  })

  // --- Scheduled posting ---

  server.registerTool('post-schedule', {
    description: 'Schedule a Nostr event for future publication. Signs the event now and queues it on disk. Use nostr-bray publish-scheduled (via cron) to publish when due.',
    inputSchema: {
      content: z.string().describe('Event content (note text, article body, etc.)'),
      scheduled_at: z.string().describe('When to publish -- ISO datetime (e.g. "2026-04-01T14:00:00Z") or Unix timestamp'),
      kind: z.number().int().optional().default(1).describe('Event kind (1 for note, 30023 for article, etc.)'),
      tags: z.array(z.array(z.string())).optional().describe('Additional tags (e.g. [["t", "bitcoin"], ["d", "my-article"]])'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ content, scheduled_at, kind, tags, output }) => {
    const result = await handlePostSchedule(deps.ctx, {
      content,
      scheduledAt: scheduled_at,
      kind,
      tags,
      relays: deps.pool.getRelays(deps.ctx.activeNpub).write,
    })
    return toolResponse(result, output, fmt.formatScheduleResult)
  })

  server.registerTool('post-queue-list', {
    description: 'List all scheduled posts waiting to be published.',
    inputSchema: {
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ output }) => {
    const entries = handlePostQueueList()
    return toolResponse(entries, output, fmt.formatScheduledQueue)
  })

  // --- Arbitrary event publishing ---

  server.registerTool('publish-event', {
    description: 'Sign and publish a Nostr event with any kind, content, and tags. Use for custom or experimental event kinds not covered by dedicated tools.',
    inputSchema: {
      kind: z.number().int().min(0).describe('Event kind number'),
      content: z.string().describe('Event content'),
      tags: z.array(z.array(z.string())).optional().describe('Event tags as [[key, value, ...], ...]'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ kind, content, tags }) => {
    const result = await handlePublishEvent(deps.ctx, deps.pool, { kind, content, tags })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: result.event.id,
        pubkey: result.event.pubkey,
        kind: result.event.kind,
        tags: result.event.tags,
        publish: result.publish,
      }, null, 2) }],
    }
  })

  server.registerTool('post-queue-cancel', {
    description: 'Cancel a scheduled post by event ID. Removes it from the queue.',
    inputSchema: {
      event_id: z.string().describe('Event ID to cancel (from post-queue-list)'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ event_id, output }) => {
    const result = handlePostQueueCancel(event_id)
    return toolResponse(result, output, (r: any) => `Cancelled ${r.eventId.slice(0, 12)}...`)
  })

}
