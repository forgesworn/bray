import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = (p: string) => path.resolve(__dirname, 'dist', p)

export default defineConfig({
  resolve: {
    alias: [
      // Subpaths must come before the root alias
      { find: 'nostr-bray/types',       replacement: dist('types-public.js') },
      { find: 'nostr-bray/sdk',         replacement: dist('sdk.js') },
      { find: 'nostr-bray/identity',    replacement: dist('identity/index.js') },
      { find: 'nostr-bray/social',      replacement: dist('social/index.js') },
      { find: 'nostr-bray/trust',       replacement: dist('trust/index.js') },
      { find: 'nostr-bray/relay',       replacement: dist('relay/index.js') },
      { find: 'nostr-bray/zap',         replacement: dist('zap/index.js') },
      { find: 'nostr-bray/safety',      replacement: dist('safety/index.js') },
      { find: 'nostr-bray/event',       replacement: dist('event/index.js') },
      { find: 'nostr-bray/util',        replacement: dist('util/index.js') },
      { find: 'nostr-bray/workflow',    replacement: dist('workflow/index.js') },
      { find: 'nostr-bray/dispatch',    replacement: dist('dispatch/index.js') },
      { find: 'nostr-bray/marketplace', replacement: dist('marketplace/index.js') },
      { find: 'nostr-bray/privacy',     replacement: dist('privacy/index.js') },
      { find: 'nostr-bray/moderation',  replacement: dist('moderation/index.js') },
      { find: 'nostr-bray/signet',      replacement: dist('signet/index.js') },
      { find: 'nostr-bray/vault',       replacement: dist('vault/index.js') },
      { find: 'nostr-bray/handler',     replacement: dist('handler/index.js') },
      { find: 'nostr-bray/musig2',      replacement: dist('musig2/index.js') },
      { find: 'nostr-bray/sync',        replacement: dist('sync/index.js') },
      { find: 'nostr-bray/admin',       replacement: dist('admin/index.js') },
      { find: 'nostr-bray',             replacement: dist('exports.js') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', '.claude/**', 'dist/**'],
  },
})
