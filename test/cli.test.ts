import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

const CLI_PATH = 'dist/cli.js'
const ENV = {
  NOSTR_SECRET_KEY: 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8',
  NOSTR_RELAYS: 'wss://relay.damus.io',
  PATH: process.env.PATH,
}

function run(...args: string[]): string {
  return execFileSync('node', [CLI_PATH, ...args], { env: ENV, encoding: 'utf-8', timeout: 10_000 }).trim()
}

function runExpectFail(...args: string[]): string {
  try {
    execFileSync('node', [CLI_PATH, ...args], { env: ENV, encoding: 'utf-8', timeout: 10_000, stdio: 'pipe' })
    return ''
  } catch (e: any) {
    return e.stderr?.toString() ?? e.message
  }
}

describe('CLI', () => {
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

  it('whoami is deterministic for same secret', () => {
    expect(run('whoami')).toBe(run('whoami'))
  })

  it('list returns JSON array with master identity', () => {
    const output = JSON.parse(run('list'))
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

  it('prove returns linkage proof', () => {
    const output = JSON.parse(run('prove', 'blind'))
    expect(output.masterPubkey).toBeDefined()
    expect(output.childPubkey).toBeDefined()
    expect(output.signature).toBeDefined()
  })

  it('unknown command shows help and exits non-zero', () => {
    const stderr = runExpectFail('nonexistent')
    expect(stderr).toContain('Unknown command')
  })

  it('missing args shows usage', () => {
    const stderr = runExpectFail('derive')
    expect(stderr).toContain('Usage')
  })
})
