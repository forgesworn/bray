/**
 * MCP App Widget registration.
 *
 * Widget tools MUST be registered on the real McpServer instance, not the
 * CatalogProxy, because registerAppTool injects _meta.ui.resourceUri which
 * the proxy would swallow.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { hexId } from '../validation.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { Nip65Manager } from '../nip65.js'
import { handleFeedWidget } from './feed-widget-handler.js'
import { handleIdentityPickerWidget } from './identity-picker-handler.js'
import { handleDmThreadWidget } from './dm-thread-handler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadWidget(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'dist', 'widgets', `${name}.html`),
    'utf8',
  )
}

export interface WidgetDeps {
  ctx: IdentityContext
  pool: RelayPool
  nip65: Nip65Manager
}

export function registerWidgets(server: McpServer, deps: WidgetDeps): void {
  let feedHtml: string
  let pickerHtml: string
  let dmHtml: string

  try {
    feedHtml = loadWidget('social-feed')
    pickerHtml = loadWidget('identity-picker')
    dmHtml = loadWidget('dm-thread')
  } catch {
    console.error('Widget HTML not found — run build first. Widget tools not registered.')
    return
  }

  // --- Social Feed Widget ---

  registerAppTool(
    server,
    'social-feed-widget',
    {
      description:
        'Display the social feed as an interactive widget with avatars, timestamps, and action buttons. ' +
        'Falls back to JSON on non-widget hosts. Returns enriched feed entries with profile images.',
      inputSchema: {
        authors: z.array(hexId).optional().describe('Hex pubkeys to filter by'),
        since: z.number().optional().describe('Unix timestamp — only fetch posts after this time'),
        limit: z.number().int().min(1).max(100).default(20).describe('Max posts to return'),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: 'ui://bray/social-feed.html' } },
    },
    async ({ authors, since, limit }) => {
      const result = await handleFeedWidget(deps.ctx, deps.pool, { authors, since, limit })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )

  registerAppResource(
    server,
    'Social Feed',
    'ui://bray/social-feed.html',
    { description: 'Interactive social feed widget with post cards, avatars, and action buttons' },
    async () => ({
      contents: [{
        uri: 'ui://bray/social-feed.html',
        mimeType: RESOURCE_MIME_TYPE,
        text: feedHtml,
      }],
    }),
  )

  // --- Identity Picker Widget ---

  registerAppTool(
    server,
    'identity-picker-widget',
    {
      description:
        'Display identity picker as an interactive widget with avatar cards and active badge. ' +
        'Falls back to JSON on non-widget hosts. Returns identities with profile images.',
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: 'ui://bray/identity-picker.html' } },
    },
    async () => {
      const result = await handleIdentityPickerWidget(deps.ctx, deps.pool)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )

  registerAppResource(
    server,
    'Identity Picker',
    'ui://bray/identity-picker.html',
    { description: 'Interactive identity picker widget with avatar grid and switching' },
    async () => ({
      contents: [{
        uri: 'ui://bray/identity-picker.html',
        mimeType: RESOURCE_MIME_TYPE,
        text: pickerHtml,
      }],
    }),
  )

  // --- DM Thread Widget ---

  registerAppTool(
    server,
    'dm-thread-widget',
    {
      description:
        'Display a DM conversation as an interactive chat widget with message bubbles and protocol badges. ' +
        'Falls back to JSON on non-widget hosts. ' +
        'WARNING: Decrypted message content is processed by the hosting AI platform. ' +
        'Only use when the user has consented to sharing message content with the AI.',
      inputSchema: {
        withPubkeyHex: hexId.describe('Hex pubkey of the conversation partner'),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: 'ui://bray/dm-thread.html' } },
    },
    async ({ withPubkeyHex }) => {
      const result = await handleDmThreadWidget(deps.ctx, deps.pool, { withPubkeyHex })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )

  registerAppResource(
    server,
    'DM Thread',
    'ui://bray/dm-thread.html',
    { description: 'Interactive DM conversation widget with chat bubbles and reply input' },
    async () => ({
      contents: [{
        uri: 'ui://bray/dm-thread.html',
        mimeType: RESOURCE_MIME_TYPE,
        text: dmHtml,
      }],
    }),
  )
}
