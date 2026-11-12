import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAuthFlags } from '../../src/cli/auth-flags.js'

describe('parseAuthFlags', () => {
  it('reads --auth before the command as on-demand and strips it', () => {
    expect(parseAuthFlags(['--auth', 'req', '--kinds', '1'])).toEqual({ mode: 'on-demand', rest: ['req', '--kinds', '1'] })
  })

  it('reads --eager-auth before the command as eager', () => {
    expect(parseAuthFlags(['--eager-auth', 'event', '-k', '1'])).toEqual({ mode: 'eager', rest: ['event', '-k', '1'] })
  })

  it('lets --eager-auth win when both lead', () => {
    expect(parseAuthFlags(['--eager-auth', '--auth', 'req']).mode).toBe('eager')
    expect(parseAuthFlags(['--auth', '--eager-auth', 'req']).mode).toBe('eager')
  })

  it('reports a mode flag after the command as misplaced, and does not act on it', () => {
    expect(parseAuthFlags(['event', '-k', '1', '--auth'])).toEqual({ rest: ['event', '-k', '1', '--auth'], misplaced: '--auth' })
    expect(parseAuthFlags(['relay', 'set', 'wss://a.example', '--eager-auth']).misplaced).toBe('--eager-auth')
  })

  it('leaves --auth alone for the commands that own it', () => {
    expect(parseAuthFlags(['relay', 'curl', 'https://a.example', '--auth']).misplaced).toBeUndefined()
    expect(parseAuthFlags(['relay-curl', 'https://a.example', '--auth']).misplaced).toBeUndefined()
    expect(parseAuthFlags(['serve', '--auth', '--eager-auth']).misplaced).toBeUndefined()
  })

  it('reports nothing for no command (the MCP server)', () => {
    expect(parseAuthFlags([])).toEqual({ rest: [] })
    expect(parseAuthFlags(['--auth'])).toEqual({ mode: 'on-demand', rest: [] })
  })
})

describe('the CLI on a misplaced --auth', () => {
  // Runs dist/cli.js: run after `npm run build`. whoami is offline.
  const home = mkdtempSync(join(tmpdir(), 'bray-auth-flags-'))
  afterAll(() => rmSync(home, { recursive: true, force: true }))
  const run = (...args: string[]) => spawnSync('node', ['dist/cli.js', ...args], {
    env: {
      NOSTR_SECRET_KEY: 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8',
      PATH: process.env.PATH!,
      HOME: home,
      XDG_CONFIG_HOME: home,
    },
    encoding: 'utf-8',
    timeout: 15_000,
  })

  it('warns that it only takes effect before the command', () => {
    const result = run('whoami', '--auth')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('--auth only takes effect before the command')
  })

  it('says nothing when it leads', () => {
    const result = run('--auth', 'whoami')
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('only takes effect before the command')
  })
})
