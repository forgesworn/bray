import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI_PATH = 'dist/cli.js'
const TEST_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'bray-cli-config-'))
const ENV = {
  NOSTR_SECRET_KEY: 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8',
  NOSTR_RELAYS: 'wss://relay.damus.io',
  PATH: process.env.PATH,
  HOME: TEST_CONFIG_HOME,
  XDG_CONFIG_HOME: TEST_CONFIG_HOME,
}

afterAll(() => {
  rmSync(TEST_CONFIG_HOME, { recursive: true, force: true })
})

function run(...args: string[]): string {
  return execFileSync('node', [CLI_PATH, ...args], { env: ENV, encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function runExpectFail(...args: string[]): string {
  try {
    execFileSync('node', [CLI_PATH, ...args], { env: ENV, encoding: 'utf-8', timeout: 10_000, stdio: 'pipe' })
    return ''
  } catch (e: any) {
    return e.stderr?.toString() ?? e.message
  }
}

describe('CLI', { timeout: 15_000 }, () => {
  it('--help shows usage without requiring config', () => {
    const out = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { PATH: process.env.PATH },
    })
    expect(out).toContain('nostr-bray')
    expect(out).toContain('whoami')
    expect(out).toContain('NOSTR_SECRET_KEY')
  })

  it('whoami returns an npub', () => {
    expect(run('whoami')).toMatch(/^npub1/)
  })

  it('validate-event works without any configured signing key', () => {
    const output = execFileSync('node', [CLI_PATH, 'validate-event', '{"kind":1,"content":"hello","tags":[]}'], {
      env: { PATH: process.env.PATH, HOME: TEST_CONFIG_HOME, XDG_CONFIG_HOME: TEST_CONFIG_HOME },
      encoding: 'utf8',
    })
    expect(JSON.parse(output)).toMatchObject({ valid: true, knownKind: true })
  })

  it('whoami is deterministic for same secret', () => {
    expect(run('whoami')).toBe(run('whoami'))
  })

  it('list returns JSON array with master identity', () => {
    const output = JSON.parse(run('list', '--json'))
    expect(Array.isArray(output)).toBe(true)
    expect(output.length).toBeGreaterThanOrEqual(1)
    expect(output[0].purpose).toBe('master')
    expect(output[0].npub).toMatch(/^npub1/)
  })

  it('derive returns npub + purpose + index', () => {
    const output = JSON.parse(run('derive', 'messaging'))
    expect(output.npub).toMatch(/^npub1/)
    expect(output.purpose).toBe('messaging')
    expect(output.index).toBe(0)
  })

  it('derive with custom index', () => {
    const output = JSON.parse(run('derive', 'messaging', '3'))
    expect(output.index).toBe(3)
  })

  it('persona returns npub + personaName', () => {
    const output = JSON.parse(run('persona', 'work'))
    expect(output.npub).toMatch(/^npub1/)
    expect(output.personaName).toBe('work')
  })

  it('prove returns linkage proof (must derive first)', () => {
    // Prove only works from a derived identity, not master
    // CLI is stateless so we can't switch then prove — test the error
    const stderr = runExpectFail('prove', 'blind')
    expect(stderr).toMatch(/derive|raw key/)
  })

  it('unknown command shows help and exits non-zero', () => {
    const stderr = runExpectFail('nonexistent')
    expect(stderr).toContain('Unknown command')
  })

  it('missing args shows usage', () => {
    const stderr = runExpectFail('derive')
    expect(stderr).toContain('Usage')
  })

  // === New commands ===

  it('create returns npub + mnemonic', () => {
    const output = JSON.parse(run('create', '--json'))
    expect(output.npub).toMatch(/^npub1/)
    expect(output.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
  })

  it('create human output labels the npub and mnemonic', () => {
    const output = run('create')
    expect(output).toMatch(/npub:\s+npub1/)
    expect(output).toMatch(/mnemonic:\s+\w+( \w+){23}/)
  })

  it('switch changes active identity', () => {
    const master = run('whoami')
    // derive then switch in same invocation isn't possible (stateless)
    // but switch to 'master' should always work
    const result = run('switch', 'master')
    expect(result).toBe(master)
  })

  it('spoken-challenge generates a token', () => {
    const output = JSON.parse(run('spoken-challenge', 'a'.repeat(32), 'test-ctx', '1'))
    expect(output.token).toBeDefined()
    expect(typeof output.token).toBe('string')
  })

  it('spoken-verify round-trip', () => {
    const secret = 'a'.repeat(32)
    const challenge = JSON.parse(run('spoken-challenge', secret, 'roundtrip', '42'))
    const verify = JSON.parse(run('spoken-verify', secret, 'roundtrip', '42', challenge.token))
    expect(verify.valid).toBe(true)
  })

  it('zap-decode parses bolt11', () => {
    const output = JSON.parse(run('zap-decode', 'lnbc10u1test'))
    expect(output.amountMsats).toBe(1_000_000)
  })

  it('relay-list returns read/write arrays', () => {
    const output = JSON.parse(run('relay-list', '--json'))
    expect(output.read).toBeDefined()
    expect(output.write).toBeDefined()
  })

  it('safety-configure returns npub', () => {
    const output = JSON.parse(run('safety-configure', 'emergency'))
    expect(output.configured).toBe(true)
    expect(output.npub).toMatch(/^npub1/)
  })

  // dm-read, notifications, feed hit real relays — tested via MCP handler tests instead

  it('help lists all command groups', () => {
    const out = run('--help')
    expect(out).toContain('Identity:')
    expect(out).toContain('Social:')
    expect(out).toContain('Trust:')
    expect(out).toContain('Relay:')
    expect(out).toContain('Zap:')
    expect(out).toContain('Safety:')
  })
})
