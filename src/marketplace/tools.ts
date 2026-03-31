import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId, relayUrl } from '../validation.js'
import { resolveRecipient } from '../resolve.js'
import {
  handleMarketplaceDiscover,
  handleMarketplaceInspect,
  handleMarketplaceSearch,
  handleMarketplaceReputation,
  handleMarketplaceCompare,
  handleMarketplaceProbe,
  handleMarketplaceCall,
  handleMarketplaceAnnounce,
  handleMarketplaceUpdate,
  handleMarketplaceRetire,
  storeCredential,
  clearCredentials,
  extractBolt11AmountSats,
  parseL402ChallengeHeader,
} from './handlers.js'
import { handleZapSend, handleZapDecode } from '../zap/handlers.js'
import {
  handleListingCreate,
  handleListingRead,
  handleListingSearch,
  handleListingClose,
} from './listings.js'
import { resolveRecipient } from '../resolve.js'
import { toolResponse } from '../tool-response.js'
import * as fmt from '../format.js'

export function registerMarketplaceTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('marketplace-discover', {
    description:
      'Discover L402/x402 paid API services announced on Nostr (kind 31402). ' +
      'Filter by topic, payment method, provider, or maximum price.',
    inputSchema: {
      topics: z.array(z.string()).optional().describe('Filter by topic tags (e.g. ["ai", "weather"])'),
      paymentMethod: z.string().optional().describe('Filter by payment rail (e.g. "l402", "x402", "cashu")'),
      authors: z.array(hexId).optional().describe('Filter by provider hex pubkeys'),
      maxPrice: z.number().optional().describe('Maximum price (in currency units)'),
      currency: z.string().optional().describe('Currency for maxPrice filter (e.g. "sats", "USD")'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum services to return (default 50)'),
      relays: z.array(relayUrl).optional().describe('Explicit relays to query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ topics, paymentMethod, authors, maxPrice, currency, limit, relays }) => {
    const services = await handleMarketplaceDiscover(deps.pool, deps.ctx.activeNpub, {
      topics, paymentMethod, authors, maxPrice, currency, limit, relays,
    })
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ count: services.length, services }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-inspect', {
    description:
      'Get full details of a specific L402 service by event ID, or by provider pubkey + identifier.',
    inputSchema: {
      eventId: hexId.optional().describe('Event ID of the kind 31402 announcement'),
      pubkey: z.string().optional().describe('Provider — name, NIP-05, npub, or hex pubkey (requires identifier)'),
      identifier: z.string().optional().describe('Service d-tag identifier (requires pubkey)'),
      relays: z.array(relayUrl).optional().describe('Explicit relays to query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ eventId, pubkey, identifier, relays }) => {
    const resolvedPubkey = pubkey ? (await resolveRecipient(pubkey)).pubkeyHex : undefined
    const service = await handleMarketplaceInspect(deps.pool, deps.ctx.activeNpub, {
      eventId, pubkey: resolvedPubkey, identifier, relays,
    })
    if (!service) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ found: false }, null, 2) }],
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(service, null, 2) }],
    }
  })

  server.registerTool('marketplace-search', {
    description:
      'Full-text search across L402 service names, descriptions, topics, and capabilities.',
    inputSchema: {
      query: z.string().describe('Search query text'),
      topics: z.array(z.string()).optional().describe('Narrow by topic tags'),
      paymentMethod: z.string().optional().describe('Narrow by payment rail'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 20)'),
      relays: z.array(relayUrl).optional().describe('Explicit relays to query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, topics, paymentMethod, limit, relays }) => {
    const services = await handleMarketplaceSearch(deps.pool, deps.ctx.activeNpub, {
      query, topics, paymentMethod, limit, relays,
    })
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ count: services.length, services }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-reputation', {
    description:
      'Check a service provider\'s reputation — number of active services, announcement history, and topics covered.',
    inputSchema: {
      pubkey: z.string().describe('Provider to check — name, NIP-05, npub, or hex pubkey'),
      relays: z.array(relayUrl).optional().describe('Explicit relays to query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, relays }) => {
    const resolved = await resolveRecipient(pubkey)
    const result = await handleMarketplaceReputation(deps.pool, deps.ctx.activeNpub, {
      pubkey: resolved.pubkeyHex, relays,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('marketplace-compare', {
    description:
      'Compare two or more L402 services side by side — pricing, capabilities, and shared features. ' +
      'Provide event IDs; the tool fetches and compares them.',
    inputSchema: {
      eventIds: z.array(hexId).min(2).describe('Event IDs of kind 31402 services to compare'),
      relays: z.array(relayUrl).optional().describe('Explicit relays to query'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ eventIds, relays }) => {
    // Fetch all services by ID
    const services = await Promise.all(
      eventIds.map(id =>
        handleMarketplaceInspect(deps.pool, deps.ctx.activeNpub, {
          eventId: id, relays,
        }),
      ),
    )
    const found = services.filter((s): s is NonNullable<typeof s> => s !== null)
    if (found.length < 2) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: `Need at least 2 services to compare. Found ${found.length} of ${eventIds.length} requested.`,
          }, null, 2),
        }],
      }
    }
    const comparison = handleMarketplaceCompare(found)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(comparison, null, 2) }],
    }
  })

  server.registerTool('marketplace-probe', {
    description:
      'Send an HTTP request to an endpoint and inspect the response. ' +
      'If the server returns 402, the L402 challenge (macaroon + invoice) is extracted and the cost in sats is estimated.',
    inputSchema: {
      url: z.string().url().describe('HTTP(S) URL to probe'),
      method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'DELETE']).default('GET').describe('HTTP method'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ url, method }) => {
    const result = await handleMarketplaceProbe(url, method)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('marketplace-pay', {
    description:
      'Pay an L402 invoice via NWC and store credentials for authenticated API calls. ' +
      'SPENDS REAL SATS. Decodes the invoice first — set confirm: true to execute payment. ' +
      'Returns an opaque credential ID for use with marketplace-call.',
    inputSchema: {
      macaroon: z.string().describe('Base64-encoded macaroon from L402 challenge'),
      invoice: z.string().describe('Bolt11 Lightning invoice from L402 challenge'),
      confirm: z.boolean().default(false).describe('Set true to execute payment (preview by default)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ macaroon, invoice, confirm }) => {
    const decoded = handleZapDecode(invoice)
    const costSats = extractBolt11AmountSats(invoice)

    if (!confirm) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            preview: true,
            amountMsats: decoded.amountMsats,
            costSats,
            message: `This will pay ${decoded.amountMsats ?? 'unknown'} msats (${costSats ?? 'unknown'} sats). Set confirm: true to execute.`,
          }, null, 2),
        }],
      }
    }

    // Pay via NWC (same as zap-send) — resolve per-identity wallet
    const { resolveNwcUri } = await import('../zap/handlers.js')
    const payResult = await handleZapSend(deps.ctx, deps.pool, {
      invoice,
      nwcUri: resolveNwcUri(deps.ctx, deps.walletsFile, deps.nwcUri),
    })

    // Store credentials keyed by event ID (opaque to caller)
    const credentialId = payResult.event.id
    // In a real L402 flow the preimage comes from the payment result.
    // NWC pay_invoice returns asynchronously — use the payment hash as placeholder
    // until the wallet confirms. For now we store with the event id as preimage proxy.
    storeCredential(credentialId, macaroon, credentialId)

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          paid: true,
          credentialId,
          costSats,
          amountMsats: decoded.amountMsats,
          note: 'Use this credentialId with marketplace-call to make authenticated requests.',
        }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-call', {
    description:
      'Make an authenticated API call using L402 credentials obtained from marketplace-pay. ' +
      'The credential ID maps to a stored macaroon + preimage — never exposed directly.',
    inputSchema: {
      url: z.string().url().describe('HTTP(S) endpoint URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
      credentialId: z.string().describe('Credential ID returned by marketplace-pay'),
      body: z.string().optional().describe('Request body (for POST/PUT/PATCH)'),
      headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ url, method, credentialId, body, headers }) => {
    const result = await handleMarketplaceCall({
      url, method, credentialId, body, headers,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('marketplace-announce', {
    description:
      'Publish a kind 31402 service announcement on Nostr. ' +
      'Advertises your API with pricing, capabilities, and payment methods so other agents can discover and pay for it.',
    inputSchema: {
      identifier: z.string().min(1).max(256).describe('Unique service identifier (d-tag)'),
      name: z.string().min(1).max(256).describe('Human-readable service name'),
      urls: z.array(z.string().url()).min(1).max(10).describe('Service endpoint URLs'),
      about: z.string().min(1).max(4096).describe('Service description'),
      pricing: z.array(z.object({
        capability: z.string().describe('Capability name this price applies to'),
        price: z.number().min(0).describe('Price amount'),
        currency: z.string().describe('Currency (e.g. "sats", "USD")'),
      })).min(1).max(100).describe('Pricing entries'),
      paymentMethods: z.array(z.array(z.string()).min(1)).min(1).describe(
        'Payment method tuples — first element is the rail (l402, x402, cashu, xcashu, payment), rest are params',
      ),
      picture: z.string().url().optional().describe('Service icon/logo URL'),
      topics: z.array(z.string()).optional().describe('Topic tags for discovery'),
      capabilities: z.array(z.object({
        name: z.string().describe('Capability name'),
        description: z.string().describe('What this capability does'),
        endpoint: z.string().optional().describe('Specific endpoint path'),
      })).optional().describe('Structured capability list'),
      version: z.string().max(64).optional().describe('Service version string'),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const result = await handleMarketplaceAnnounce(deps.ctx, deps.pool, args)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          published: true,
          id: result.event.id,
          identifier: args.identifier,
          publish: result.publish,
        }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-update', {
    description:
      'Update an existing kind 31402 service announcement. Same pubkey + identifier replaces the previous version (NIP-33 replaceable).',
    inputSchema: {
      identifier: z.string().min(1).max(256).describe('Service identifier (d-tag) to update'),
      name: z.string().min(1).max(256).describe('Updated service name'),
      urls: z.array(z.string().url()).min(1).max(10).describe('Updated endpoint URLs'),
      about: z.string().min(1).max(4096).describe('Updated description'),
      pricing: z.array(z.object({
        capability: z.string().describe('Capability name'),
        price: z.number().min(0).describe('Price amount'),
        currency: z.string().describe('Currency'),
      })).min(1).max(100).describe('Updated pricing'),
      paymentMethods: z.array(z.array(z.string()).min(1)).min(1).describe('Updated payment methods'),
      picture: z.string().url().optional().describe('Updated icon URL'),
      topics: z.array(z.string()).optional().describe('Updated topics'),
      capabilities: z.array(z.object({
        name: z.string().describe('Capability name'),
        description: z.string().describe('What this capability does'),
        endpoint: z.string().optional().describe('Specific endpoint path'),
      })).optional().describe('Updated capabilities'),
      version: z.string().max(64).optional().describe('Updated version string'),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const result = await handleMarketplaceUpdate(deps.ctx, deps.pool, args)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          updated: true,
          id: result.event.id,
          identifier: args.identifier,
          publish: result.publish,
        }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-retire', {
    description:
      'Retire (delete) a service announcement by publishing a kind 5 deletion event. The service will no longer appear in discovery results.',
    inputSchema: {
      identifier: z.string().min(1).describe('Service identifier (d-tag) to retire'),
      reason: z.string().optional().describe('Optional reason for retirement'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ identifier, reason }) => {
    const result = await handleMarketplaceRetire(deps.ctx, deps.pool, { identifier, reason })
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          retired: true,
          id: result.event.id,
          identifier,
          publish: result.publish,
        }, null, 2),
      }],
    }
  })

  server.registerTool('marketplace-credentials-clear', {
    description:
      'Clear all stored L402 credentials from memory. Use when switching identity or cleaning up.',
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async () => {
    clearCredentials()
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ cleared: true }, null, 2) }],
    }
  })

  // --- NIP-99 Classified Listings (kind 30402) ---

  server.registerTool('listing-create', {
    description:
      'Create a classified listing (NIP-99, kind 30402). Publishes a replaceable event with title, ' +
      'description, price, and optional location/hashtags. The slug (d-tag) defaults to a slugified title.',
    inputSchema: {
      title: z.string().min(1).describe('Listing title'),
      content: z.string().min(1).describe('Full listing description (markdown)'),
      price: z.object({
        amount: z.string().describe('Price amount as string (e.g. "100")'),
        currency: z.string().describe('Currency code (e.g. "USD", "SAT", "GBP")'),
        frequency: z.string().optional().describe('Pricing frequency (e.g. "per hour", "per month") — omit for one-off'),
      }).describe('Price tuple'),
      summary: z.string().optional().describe('Short summary'),
      location: z.string().optional().describe('Human-readable location'),
      geohash: z.string().optional().describe('Geohash for location-based search'),
      hashtags: z.array(z.string()).optional().describe('Hashtags for discovery (e.g. ["furniture", "london"])'),
      image: z.string().url().optional().describe('Image URL'),
      slug: z.string().optional().describe('Custom d-tag identifier — defaults to slugified title'),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const result = await handleListingCreate(deps.ctx, deps.pool, args)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          published: true,
          id: result.event.id,
          slug: result.event.tags.find((t: string[]) => t[0] === 'd')?.[1],
          publish: result.publish,
        }, null, 2),
      }],
    }
  })

  server.registerTool('listing-read', {
    description:
      'Read classified listing(s) (NIP-99, kind 30402) by author and optional slug. ' +
      'Accepts any identifier for author: name, NIP-05, npub, or hex pubkey.',
    inputSchema: {
      author: z.string().optional().describe('Author — name, NIP-05, npub, or hex pubkey'),
      slug: z.string().optional().describe('Listing slug (d-tag) — omit to fetch all listings by author'),
      limit: z.number().int().min(1).max(200).default(50).describe('Maximum listings to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ author, slug, limit, output }) => {
    let authorHex: string | undefined
    if (author) {
      const resolved = await resolveRecipient(author)
      authorHex = resolved.pubkeyHex
    }
    const listings = await handleListingRead(deps.pool, deps.ctx.activeNpub, {
      author: authorHex, slug, limit,
    })
    return toolResponse(listings, output, fmt.formatListings)
  })

  server.registerTool('listing-search', {
    description:
      'Search classified listings (NIP-99, kind 30402) by hashtag or geohash location. ' +
      'Provide at least one of hashtag or geohash.',
    inputSchema: {
      hashtag: z.string().optional().describe('Hashtag to search for (e.g. "furniture")'),
      geohash: z.string().optional().describe('Geohash prefix for location-based search'),
      limit: z.number().int().min(1).max(200).default(50).describe('Maximum listings to return'),
      output: z.enum(['json', 'human']).default('human').describe('Response format'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ hashtag, geohash, limit, output }) => {
    const listings = await handleListingSearch(deps.pool, deps.ctx.activeNpub, {
      hashtag, geohash, limit,
    })
    return toolResponse(listings, output, fmt.formatListings)
  })

  server.registerTool('listing-close', {
    description:
      'Mark a classified listing as sold or closed (NIP-99, kind 30402). ' +
      'Fetches the existing listing, preserves all tags, and republishes with a status tag.',
    inputSchema: {
      slug: z.string().describe('Listing slug (d-tag) to close'),
      status: z.enum(['sold', 'closed']).describe('New status — "sold" or "closed"'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ slug, status }) => {
    const result = await handleListingClose(deps.ctx, deps.pool, { slug, status })
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          closed: true,
          slug,
          status,
          id: result.event.id,
          publish: result.publish,
        }, null, 2),
      }],
    }
  })
}
