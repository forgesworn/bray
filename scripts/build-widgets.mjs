/**
 * Build script for MCP app widgets.
 *
 * Reads the ext-apps browser bundle, converts its ES module exports to globals,
 * injects it into each HTML template at the /*__EXT_APPS_BUNDLE__*​/ marker,
 * and writes the final HTML files to dist/widgets/.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Read and convert the ext-apps browser bundle from ESM exports to globalThis assignment
const bundle = readFileSync(
  require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'),
  'utf8',
).replace(/export\{([^}]+)\};?\s*$/, (_, body) =>
  'globalThis.ExtApps={' +
  body.split(',').map((p) => {
    const [local, exported] = p.split(' as ').map((s) => s.trim())
    return `${exported ?? local}:${local}`
  }).join(',') + '};',
)

const outDir = join(__dirname, '..', 'dist', 'widgets')
mkdirSync(outDir, { recursive: true })

const widgets = ['social-feed', 'identity-picker', 'dm-thread']

for (const name of widgets) {
  const templatePath = join(__dirname, '..', 'widgets', 'templates', `${name}.html`)
  const html = readFileSync(templatePath, 'utf8')
    .replace('/*__EXT_APPS_BUNDLE__*/', () => bundle)
  writeFileSync(join(outDir, `${name}.html`), html)
}

console.error(`Built ${widgets.length} widgets to ${outDir}`)
