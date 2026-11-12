/**
 * `count` against one relay: a NIP-45 COUNT through the relay pool.
 *
 * Runs the built CLI (dist/cli.js), so run after `npm run build`.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'

const CLI = 'dist/cli.js'
const CONFIG_HOME = mkdtempSync(join(tmpdir(), 'bray-count-'))
// Deterministic test identity, as in the smoke suite. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

afterAll(() => rmSync(CONFIG_HOME, { recursive: true, force: true }))

/**
 * A relay whose COUNT says 7 but which serves only 2 notes to a REQ, so the
 * output shows which one the CLI used. `gated` needs AUTH first.
 */
async function relay(gated: boolean) {
  const sk = generateSecretKey()
  const notes = [0, 1].map(i => finalizeEvent({ kind: 1, created_at: 1_700_000_000 + i, tags: [], content: `n${i}` }, sk))
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const frames: string[] = []
  wss.on('connection', ws => {
    let authed = false
    if (gated) ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      frames.push(msg[0])
      if (msg[0] === 'AUTH') { authed = true; return ws.send(JSON.stringify(['OK', msg[1].id, true, ''])) }
      const isNotes = msg.slice(2).some((f: { kinds?: number[] }) => f.kinds?.includes(1))
      if (msg[0] === 'REQ' && !isNotes) return ws.send(JSON.stringify(['EOSE', msg[1]]))
      if (gated && !authed) return ws.send(JSON.stringify(['CLOSED', msg[1], 'auth-required: sign in first']))
      if (msg[0] === 'COUNT') return ws.send(JSON.stringify(['COUNT', msg[1], { count: 7 }]))
      if (msg[0] === 'REQ') {
        for (const note of notes) ws.send(JSON.stringify(['EVENT', msg[1], note]))
        ws.send(JSON.stringify(['EOSE', msg[1]]))
      }
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    frames,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

function count(url: string, ...lead: string[]) {
  const child = spawn('node', [CLI, ...lead, 'count', '--kinds', '1', '--json'], {
    env: {
      NOSTR_SECRET_KEY: TEST_NSEC,
      PATH: process.env.PATH!,
      HOME: CONFIG_HOME,
      XDG_CONFIG_HOME: CONFIG_HOME,
      BRAY_ALLOW_PRIVATE_RELAYS: '1',
      NOSTR_RELAYS: url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += d })
  child.stderr.on('data', d => { stderr += d })
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

describe('count against one relay', { timeout: 20_000 }, () => {
  const relays: Array<{ close(): Promise<void> }> = []
  afterEach(async () => {
    while (relays.length) await relays.pop()!.close()
  })

  it('sends a NIP-45 COUNT and reports its count', async () => {
    const r = await relay(false)
    relays.push(r)
    const run = await count(r.url)
    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout).count).toBe(7)
    expect(r.frames).toContain('COUNT')
  })

  it('authenticates with --auth on an auth-gated relay, then counts', async () => {
    const r = await relay(true)
    relays.push(r)
    const run = await count(r.url, '--auth')
    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout).count).toBe(7)
    expect(r.frames.lastIndexOf('COUNT')).toBeGreaterThan(r.frames.indexOf('AUTH'))
  })

  it('exits 1 and says how to authenticate when auth is off on an auth-gated relay', async () => {
    const r = await relay(true)
    relays.push(r)
    const run = await count(r.url)
    expect(run.code).toBe(1)
    expect(run.stdout).toContain('auth-required: sign in first')
    expect(run.stdout).toContain('NOSTR_AUTH=1')
  })
})
