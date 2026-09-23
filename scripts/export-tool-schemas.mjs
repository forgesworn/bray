#!/usr/bin/env node
// Harvest every tool's description + Zod inputSchema (JSON Schema) from the
// compiled server by handing each register* function a capture-only proxy.
// Output: site/tools-manifest.json — consumed by any AI client that wants
// canonical parameter schemas without booting the MCP runtime.
//
// Prereq: `npm run build` (imports from dist/).

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Synthetic identities file so registerDispatchTools registers its 13 tools.
// The handlers aren't invoked here; the map just has to be non-empty.
const tmpDir = mkdtempSync(join(tmpdir(), 'bray-manifest-'))
const fakeIdentitiesPath = join(tmpDir, 'identities.md')
writeFileSync(
  fakeIdentitiesPath,
  '| Name | Hex Pubkey |\n| --- | --- |\n| stub | ' + 'a'.repeat(64) + ' |\n',
)

const stubDeps = {
  ctx: new Proxy({}, { get: () => () => undefined }),
  pool: new Proxy({}, { get: () => () => undefined }),
  nip65: new Proxy({}, { get: () => () => undefined }),
  trust: new Proxy({}, { get: () => () => undefined }),
  nwcUri: undefined,
  walletsFile: undefined,
  nip04Enabled: false,
  veilCacheTtl: 300_000,
  veilCacheMax: 500,
  dispatchIdentitiesPath: fakeIdentitiesPath,
}

const collected = []
const captureServer = {
  registerTool(name, definition) {
    collected.push({
      name,
      description: definition.description ?? '',
      annotations: definition.annotations,
      inputSchema: definition.inputSchema ?? {},
    })
  },
}

function zodFieldsToJsonSchema(fields) {
  if (!fields || Object.keys(fields).length === 0) {
    return { type: 'object', properties: {}, additionalProperties: false }
  }
  try {
    return z.toJSONSchema(z.object(fields), { target: 'draft-2020-12' })
  } catch (e) {
    return { type: 'object', properties: {}, _error: `schema conversion failed: ${e.message}` }
  }
}

// The same registration the MCP server runs, with every optional group on:
// dispatch identities configured and the opt-in wallet service enabled.
const { registerAllTools } = await import('../dist/tool-groups.js')
const { ActionCatalog, PROMOTED_TOOLS } = await import('../dist/catalog.js')
registerAllTools(captureServer, stubDeps, {
  veilCacheTtl: stubDeps.veilCacheTtl,
  veilCacheMax: stubDeps.veilCacheMax,
  dispatchIdentitiesPath: fakeIdentitiesPath,
  walletService: true,
})

// search-actions and execute-action are tools too. Give them a catalog of
// everything not promoted, as the server does, so their descriptions match.
const catalog = new ActionCatalog()
for (const tool of collected) {
  if (!PROMOTED_TOOLS.has(tool.name)) catalog.add(tool.name, tool, async () => ({ content: [] }))
}
catalog.registerMetaTools(captureServer)
const promotedCount = collected.filter(t => PROMOTED_TOOLS.has(t.name)).length

rmSync(tmpDir, { recursive: true, force: true })

collected.sort((a, b) => a.name.localeCompare(b.name))

const manifest = {
  name: pkg.name,
  mcpName: pkg.mcpName,
  version: pkg.version,
  description: pkg.description,
  homepage: 'https://bray.forgesworn.dev',
  totalTools: collected.length,
  promotedTools: promotedCount,
  note:
    'Parameter schemas for every registered tool. Most tools live in the catalog ' +
    `(discoverable via search-actions + execute-action); ${promotedCount} promoted tools and the two ` +
    'meta-tools are exposed directly on the MCP server. This manifest covers all of them, including ' +
    'wallet-grant, wallet-refill and wallet-serve, which are registered only with BRAY_WALLET_SERVICE=1, ' +
    'and the dispatch tools, which need DISPATCH_IDENTITIES.',
  tools: collected.map(t => ({
    name: t.name,
    description: t.description,
    annotations: t.annotations,
    inputSchema: zodFieldsToJsonSchema(t.inputSchema),
  })),
}

const outPath = new URL('../site/tools-manifest.json', import.meta.url)
writeFileSync(outPath, JSON.stringify(manifest, null, 2))
console.error(`Wrote ${collected.length} tool schemas to site/tools-manifest.json`)
