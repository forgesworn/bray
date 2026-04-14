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

const registerModules = [
  ['identity', () => import('../dist/identity/tools.js')],
  ['social', () => import('../dist/social/tools.js')],
  ['trust', () => import('../dist/trust/tools.js')],
  ['relay', () => import('../dist/relay/tools.js')],
  ['relay-intel', () => import('../dist/relay/intelligence-tools.js')],
  ['zap', () => import('../dist/zap/tools.js')],
  ['safety', () => import('../dist/safety/tools.js')],
  ['util', () => import('../dist/util/tools.js')],
  ['workflow', () => import('../dist/workflow/tools.js')],
  ['marketplace', () => import('../dist/marketplace/tools.js')],
  ['privacy', () => import('../dist/privacy/tools.js')],
  ['moderation', () => import('../dist/moderation/tools.js')],
  ['signet', () => import('../dist/signet/tools.js')],
  ['vault', () => import('../dist/vault/tools.js')],
  ['dispatch', () => import('../dist/dispatch/tools.js')],
  ['handler', () => import('../dist/handler/tools.js')],
]

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

for (const [groupName, loader] of registerModules) {
  const mod = await loader()
  const registerFn = Object.values(mod).find(v => typeof v === 'function' && v.name.startsWith('register'))
  if (!registerFn) {
    console.error(`skipping ${groupName}: no register* export`)
    continue
  }
  try {
    registerFn(captureServer, stubDeps)
  } catch (e) {
    console.error(`failed to capture ${groupName}:`, e.message)
  }
}

rmSync(tmpDir, { recursive: true, force: true })

collected.sort((a, b) => a.name.localeCompare(b.name))

const manifest = {
  name: pkg.name,
  mcpName: pkg.mcpName,
  version: pkg.version,
  description: pkg.description,
  homepage: 'https://bray.forgesworn.dev',
  generated: new Date().toISOString(),
  totalTools: collected.length,
  note:
    'Parameter schemas for every registered tool. Most tools live in the catalog ' +
    '(discoverable via search-actions + execute-action); ~48 promoted tools are ' +
    'exposed directly on the MCP server. This manifest covers both.',
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
