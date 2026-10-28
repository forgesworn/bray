import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// src/state.ts fixes its directory when first imported, and the static imports
// below load it. Point it at an empty directory first, so a bunker URI saved on
// the machine running the tests is never picked up.
const HOME = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'bray-read-only-'))
  process.env.HOME = dir
  process.env.XDG_CONFIG_HOME = dir
  return dir
})
import { registerAllTools } from '../src/tool-groups.js'
import { ActionCatalog, createCatalogProxy, PROMOTED_TOOLS } from '../src/catalog.js'
import {
  ReadOnlyContext,
  READ_ONLY_EXCLUDED,
  READ_ONLY_MESSAGE,
  createReadOnlyFilter,
  isReadOnlyTool,
} from '../src/read-only.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const TEST_NPUB_HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const TEST_NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'
// Paths that do not exist: if read-only mode ever opened one, readFileSync
// would throw ENOENT and the test would fail.
const MISSING = join(HOME, 'does-not-exist')

afterAll(() => rmSync(HOME, { recursive: true, force: true }))

const ENV_KEYS = [
  'NOSTR_SECRET_KEY', 'NOSTR_SECRET_KEY_FILE', 'NOSTR_RELAYS', 'NWC_URI', 'NWC_URI_FILE',
  'BUNKER_URI', 'BUNKER_URI_FILE', 'NOSTR_NCRYPTSEC', 'NOSTR_NCRYPTSEC_FILE',
  'NOSTR_NCRYPTSEC_PASSWORD', 'NOSTR_NCRYPTSEC_PASSWORD_FILE', 'BRAY_CONFIG', 'TOR_PROXY',
  'BRAY_READ_ONLY', 'NOSTR_PUBKEY', 'NOSTR_AUTH', 'BRAY_WALLET_SERVICE', 'DISPATCH_IDENTITIES',
  'BRAY_WALLETS_FILE',
]

describe('read-only config', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.HOME = HOME
    process.env.XDG_CONFIG_HOME = HOME
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
  })

  afterEach(() => { process.env = savedEnv })

  it('keeps the hard error for callers that do not opt in (CLI, SDK)', async () => {
    const { loadConfig } = await import('../src/config.js')
    await expect(loadConfig()).rejects.toThrow(/secret key/i)
  })

  it('starts read-only with no signer when the MCP server opts in', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = await loadConfig({ allowReadOnly: true })
    expect(config.readOnly).toBe(true)
    expect(config.readOnlyPubkey).toBeUndefined()
    expect(config.secretKey).toBe('')
    expect(config.bunkerUri).toBeUndefined()
  })

  it('a configured key is unchanged: not read-only', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    const config = await loadConfig({ allowReadOnly: true })
    expect(config.readOnly).toBe(false)
    expect(config.secretKey).toBe(TEST_NSEC)
  })

  it('a bunker URI saved by `bunker connect` still means bunker mode, not read-only', async () => {
    const { loadConfig } = await import('../src/config.js')
    const { mkdirSync } = await import('node:fs')
    const savedUri = `bunker://${'ab'.repeat(32)}?relay=wss%3A%2F%2Frelay.saved.example.com`
    mkdirSync(join(HOME, 'bray'), { recursive: true })
    const saved = join(HOME, 'bray', 'bunker-uri')
    writeFileSync(saved, JSON.stringify({ uri: savedUri }))
    try {
      const config = await loadConfig({ allowReadOnly: true })
      expect(config.readOnly).toBe(false)
      expect(config.bunkerUri).toBe(savedUri)
    } finally {
      rmSync(saved, { force: true })
    }
  })

  it('BRAY_READ_ONLY=1 ignores a saved bunker URI', async () => {
    const { loadConfig } = await import('../src/config.js')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(HOME, 'bray'), { recursive: true })
    const saved = join(HOME, 'bray', 'bunker-uri')
    writeFileSync(saved, JSON.stringify({ uri: `bunker://${'ab'.repeat(32)}?relay=wss%3A%2F%2Frelay.saved.example.com` }))
    process.env.BRAY_READ_ONLY = '1'
    try {
      const config = await loadConfig({ allowReadOnly: true })
      expect(config.readOnly).toBe(true)
      expect(config.bunkerUri).toBeUndefined()
    } finally {
      rmSync(saved, { force: true })
    }
  })

  it('BRAY_READ_ONLY=1 never opens key, bunker, ncryptsec or wallet files', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.BRAY_READ_ONLY = '1'
    process.env.NOSTR_SECRET_KEY_FILE = MISSING
    process.env.BUNKER_URI_FILE = MISSING
    process.env.NOSTR_NCRYPTSEC_FILE = MISSING
    process.env.NOSTR_NCRYPTSEC_PASSWORD_FILE = MISSING
    process.env.NWC_URI_FILE = MISSING
    const config = await loadConfig({ allowReadOnly: true })
    expect(config.readOnly).toBe(true)
    expect(config.secretKey).toBe('')
    expect(config.nwcUri).toBeUndefined()
    // The secret env vars are still scrubbed from the process.
    expect(process.env.NOSTR_SECRET_KEY_FILE).toBeUndefined()
    expect(process.env.BUNKER_URI_FILE).toBeUndefined()
    expect(process.env.NWC_URI_FILE).toBeUndefined()
  })

  it('BRAY_READ_ONLY=1 beats an inline key and bunker', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.BRAY_READ_ONLY = '1'
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.BUNKER_URI = `bunker://${'ab'.repeat(32)}?relay=wss%3A%2F%2Frelay.example.com`
    const config = await loadConfig({ allowReadOnly: true })
    expect(config.readOnly).toBe(true)
    expect(config.secretKey).toBe('')
    expect(config.bunkerUri).toBeUndefined()
    expect(process.env.NOSTR_SECRET_KEY).toBeUndefined()
  })

  it('read-only switches off wallets, wallet service, dispatch and NIP-42 auth', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.BRAY_READ_ONLY = '1'
    process.env.BRAY_WALLET_SERVICE = '1'
    process.env.DISPATCH_IDENTITIES = MISSING
    process.env.NOSTR_AUTH = 'eager'
    process.env.BRAY_WALLETS_FILE = MISSING
    const config = await loadConfig({ allowReadOnly: true })
    expect(config.walletService).toBe(false)
    expect(config.walletsFile).toBe('')
    expect(config.dispatchIdentities).toBeUndefined()
    expect(config.authMode).toBe('off')
  })

  it('BRAY_READ_ONLY is refused, not ignored, by callers that need a signer', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.BRAY_READ_ONLY = '1'
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    await expect(loadConfig()).rejects.toThrow(/MCP server only/)
  })

  it('rejects an unrecognised BRAY_READ_ONLY value', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.BRAY_READ_ONLY = 'please'
    await expect(loadConfig({ allowReadOnly: true })).rejects.toThrow(/BRAY_READ_ONLY/)
  })

  it('an empty key file is an error, not read-only', async () => {
    const { loadConfig } = await import('../src/config.js')
    const empty = join(HOME, 'empty-key')
    writeFileSync(empty, '  \n')
    process.env.NOSTR_SECRET_KEY_FILE = empty
    await expect(loadConfig({ allowReadOnly: true })).rejects.toThrow(/configured but empty/)
  })

  it('reads NOSTR_PUBKEY as npub or hex', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_PUBKEY = TEST_NPUB
    expect((await loadConfig({ allowReadOnly: true })).readOnlyPubkey).toBe(TEST_NPUB_HEX)
    process.env.NOSTR_PUBKEY = TEST_NPUB_HEX.toUpperCase()
    expect((await loadConfig({ allowReadOnly: true })).readOnlyPubkey).toBe(TEST_NPUB_HEX)
  })

  it('rejects an nsec in NOSTR_PUBKEY without echoing it', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_PUBKEY = TEST_NSEC
    const err = await loadConfig({ allowReadOnly: true }).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/secret key/)
    expect(err?.message).not.toContain(TEST_NSEC)
  })

  it('rejects a malformed NOSTR_PUBKEY without echoing it', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_PUBKEY = 'npub1notreallyakey'
    const err = await loadConfig({ allowReadOnly: true }).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/npub or 64 hex/)
    expect(err?.message).not.toContain('notreallyakey')
  })
})

describe('ReadOnlyContext', () => {
  it('refuses to sign, encrypt or decrypt', async () => {
    const ctx = new ReadOnlyContext(TEST_NPUB_HEX)
    expect(() => ctx.getSigningFunction()).toThrow(READ_ONLY_MESSAGE)
    await expect(ctx.nip44Encrypt()).rejects.toThrow(READ_ONLY_MESSAGE)
    await expect(ctx.nip44Decrypt()).rejects.toThrow(READ_ONLY_MESSAGE)
  })

  it('reads as NOSTR_PUBKEY when given one', async () => {
    const ctx = new ReadOnlyContext(TEST_NPUB_HEX)
    expect(ctx.activeNpub).toBe(TEST_NPUB)
    expect(ctx.activePublicKeyHex).toBe(TEST_NPUB_HEX)
    expect(await ctx.listIdentities()).toEqual([{ npub: TEST_NPUB }])
  })

  it('without NOSTR_PUBKEY, routes by default relays but has no identity', async () => {
    const ctx = new ReadOnlyContext()
    expect(ctx.activeNpub).toBe('')
    expect(() => ctx.activePublicKeyHex).toThrow(/NOSTR_PUBKEY/)
    expect(await ctx.listIdentities()).toEqual([])
  })
})

describe('read-only tool filter', () => {
  function register(readOnly: boolean) {
    const promoted: string[] = []
    const all: Array<{ name: string; readOnlyHint?: boolean }> = []
    const server = {
      registerTool: (name: string, definition: any) => {
        promoted.push(name)
        all.push({ name, readOnlyHint: definition?.annotations?.readOnlyHint })
      },
    } as any
    const catalog = new ActionCatalog()
    const catalogProxy = createCatalogProxy(server, catalog, PROMOTED_TOOLS)
    const dropped: string[] = []
    const proxy = readOnly ? createReadOnlyFilter(catalogProxy, dropped) : catalogProxy
    const stub = new Proxy({}, { get: () => () => undefined }) as any
    const directory = mkdtempSync(join(tmpdir(), 'bray-ro-filter-'))
    try {
      const identities = join(directory, 'identities.md')
      writeFileSync(identities, `| Name | Hex Pubkey |\n| --- | --- |\n| stub | ${'a'.repeat(64)} |\n`)
      // Register as if every optional group were on, so the filter is tested
      // against the full set even though read-only mode never enables them.
      registerAllTools(proxy, { ctx: stub, pool: stub, nip65: stub, trust: stub, walletsFile: '' } as any, {
        veilCacheTtl: 300_000,
        veilCacheMax: 500,
        dispatchIdentitiesPath: identities,
        walletService: true,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    return { promoted, catalog, dropped }
  }

  const full = register(false)
  const ro = register(true)

  it('drops every tool not marked read-only, promoted or catalogued', () => {
    expect(ro.dropped.length).toBeGreaterThan(100)
    for (const name of ro.promoted) expect(isReadOnlyTool(name, { annotations: { readOnlyHint: true } })).toBe(true)
    expect(ro.promoted.length + ro.catalog.size + ro.dropped.length).toBe(full.promoted.length + full.catalog.size)
  })

  it('leaves out the tools that sign, publish, pay or handle secrets', () => {
    const kept = new Set([...ro.promoted, ...(ro.catalog as any).entries.keys()])
    const signing = [
      'social-post', 'social-reply', 'social-react', 'social-delete', 'dm-send', 'zap-send',
      'marketplace-pay', 'wallet-grant', 'wallet-serve', 'publish-event', 'identity-switch',
      'identity-create', 'identity-derive', 'trust-attest', 'relay-auth', 'relay-set',
      'dispatch-send', 'article-publish', 'nip-publish', 'blossom-upload', 'vault-create',
    ]
    for (const name of signing) {
      expect(kept.has(name), name).toBe(false)
      expect(ro.dropped, name).toContain(name)
    }
    for (const name of READ_ONLY_EXCLUDED) {
      expect(kept.has(name), name).toBe(false)
    }
  })

  it('every excluded name is a real tool, so a rename cannot silently re-admit it', () => {
    const allNames = new Set([...full.promoted, ...(full.catalog as any).entries.keys()])
    for (const name of READ_ONLY_EXCLUDED) expect(allNames.has(name), name).toBe(true)
  })

  it('without NOSTR_PUBKEY, tool errors say how to give bray an identity', async () => {
    const captured: Record<string, (args: unknown) => Promise<unknown>> = {}
    const server = { registerTool: (name: string, _d: unknown, h: any) => { captured[name] = h } } as any
    const failing = async () => { throw new Error('invalid string length: 0') }
    createReadOnlyFilter(server, [], { hasIdentity: false })
      .registerTool('mine', { annotations: { readOnlyHint: true } } as any, failing as any)
    await expect(captured.mine({})).rejects.toThrow(/invalid string length: 0.*set NOSTR_PUBKEY/)
    createReadOnlyFilter(server, [], { hasIdentity: true })
      .registerTool('mine2', { annotations: { readOnlyHint: true } } as any, failing as any)
    await expect(captured.mine2({})).rejects.toThrow(/^invalid string length: 0$/)
  })

  it('execute-action on a left-out tool explains read-only mode', async () => {
    ro.catalog.markUnavailable(ro.dropped, READ_ONLY_MESSAGE)
    const result = await ro.catalog.execute('zap-send', {})
    expect(JSON.parse(result.content[0].text).error).toBe(READ_ONLY_MESSAGE)
    const unknown = await ro.catalog.execute('no-such-tool', {})
    expect(JSON.parse(unknown.content[0].text).error).toMatch(/Unknown action/)
  })
})
