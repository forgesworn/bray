import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAllTools } from '../src/tool-groups.js'
import { ActionCatalog, PROMOTED_TOOLS } from '../src/catalog.js'

// One tool count, generated from what the server actually registers, and
// quoted the same everywhere. When this fails after adding or removing a
// tool, run `npm run build` (which regenerates site/tools-manifest.json)
// and update the figures it names.

const root = new URL('..', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

function registeredTools(): string[] {
  const names: string[] = []
  const capture = {
    registerTool: (name: string) => { names.push(name) },
  } as any
  const stub = new Proxy({}, { get: () => () => undefined }) as any
  const directory = mkdtempSync(join(tmpdir(), 'bray-count-'))
  try {
    const identities = join(directory, 'identities.md')
    writeFileSync(identities, `| Name | Hex Pubkey |\n| --- | --- |\n| stub | ${'a'.repeat(64)} |\n`)
    registerAllTools(capture, { ctx: stub, pool: stub, nip65: stub, walletsFile: '' }, {
      veilCacheTtl: 300_000,
      veilCacheMax: 500,
      dispatchIdentitiesPath: identities,
      walletService: true,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  new ActionCatalog().registerMetaTools(capture)
  return names
}

describe('tool count', () => {
  const tools = registeredTools()
  const total = tools.length

  it('registers each tool once, and every promoted tool exists', () => {
    expect(new Set(tools).size).toBe(total)
    for (const name of PROMOTED_TOOLS) expect(tools).toContain(name)
  })

  it('matches the generated manifest', () => {
    const manifest = JSON.parse(read('site/tools-manifest.json'))
    expect(manifest.totalTools).toBe(total)
    expect(manifest.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([...tools].sort())
    expect(manifest.promotedTools).toBe(PROMOTED_TOOLS.size)
  })

  it.each([
    'README.md',
    'llms.txt',
    'llms-full.txt',
    'server.json',
    'site/mcp.json',
    'site/index.html',
    'AGENTS.md',
    'CLAUDE.md',
  ])('is quoted correctly in %s', (file) => {
    const quoted = [...read(file).matchAll(/\b(\d{3}) tools\b/g)].map((match) => Number(match[1]))
    expect(quoted.length).toBeGreaterThan(0)
    expect(new Set(quoted)).toEqual(new Set([total]))
  })

  it('is the capability count in site/mcp.json', () => {
    expect(JSON.parse(read('site/mcp.json')).capabilities.tools).toBe(total)
  })

  it('adds up in the startup split quoted in AGENTS.md', () => {
    const [, promoted, catalogued, sum] = read('AGENTS.md').match(/(\d+) promoted tools \+ (\d+) cataloged \((\d+) total\)/)!
    expect(Number(promoted)).toBe(PROMOTED_TOOLS.size)
    expect(Number(promoted) + Number(catalogued) + 2).toBe(total)
    expect(Number(sum)).toBe(total)
  })
})
