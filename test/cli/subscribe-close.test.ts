/**
 * `subscribe` when the relay ends the subscription.
 *
 * Runs the built CLI (dist/cli.js), so run after `npm run build`, as the smoke
 * suite does. Each case starts its own relay on an ephemeral port.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'

const CLI = 'dist/cli.js'
const CONFIG_HOME = mkdtempSync(join(tmpdir(), 'bray-subscribe-close-'))
// Deterministic test identity, as in the smoke suite. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

afterAll(() => rmSync(CONFIG_HOME, { recursive: true, force: true }))

type Ending = 'closed' | 'dropped' | 'auth-required' | 'stays-open'

/**
 * A relay that answers bray's own lookups with EOSE and ends the kind 1
 * subscription as `ending` says:
 * - closed: EOSE, then CLOSED and a 1008 close, as wokd does when a member is removed
 * - dropped: EOSE, then the socket goes away with no CLOSED
 * - auth-required: CLOSED auth-required at once, as an auth-gated relay does
 * - stays-open: EOSE and nothing more
 */
async function relay(ending: Ending) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  let subscribed = false
  wss.on('connection', ws => {
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] !== 'REQ') return
      const [, id, ...filters] = msg
      const isTail = filters.some((f: { kinds?: number[] }) => f.kinds?.includes(1))
      if (!isTail) return ws.send(JSON.stringify(['EOSE', id]))
      subscribed = true
      if (ending === 'auth-required') return ws.send(JSON.stringify(['CLOSED', id, 'auth-required: sign in first']))
      ws.send(JSON.stringify(['EOSE', id]))
      if (ending === 'closed') {
        setTimeout(() => {
          ws.send(JSON.stringify(['CLOSED', id, 'restricted: sheltered authority changed']))
          ws.close(1008, 'closing: see the preceding CLOSED frame')
        }, 100)
      } else if (ending === 'dropped') {
        setTimeout(() => ws.terminate(), 100)
      }
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    subscribed: () => subscribed,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

function subscribe(url: string) {
  const child = spawn('node', [CLI, 'subscribe', '--kinds', '1', '--relay', url], {
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
  let stderr = ''
  child.stderr.on('data', d => { stderr += d })
  const exited = new Promise<number | null>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null) }, 10_000)
    child.on('exit', code => { clearTimeout(timer); resolve(code) })
  })
  return { child, exited, stderr: () => stderr }
}

// A case that hangs is reported by its exit code (null, after the 10 s kill), not a test timeout.
describe('subscribe when the relay ends it', { timeout: 15_000 }, () => {
  const relays: Array<{ close(): Promise<void> }> = []
  afterEach(async () => {
    while (relays.length) await relays.pop()!.close()
  })

  it('exits 1 with the reason when the relay sends CLOSED and closes the socket', async () => {
    const r = await relay('closed')
    relays.push(r)
    const run = subscribe(r.url)
    const code = await run.exited
    expect(code).toBe(1)
    expect(run.stderr()).toContain('restricted: sheltered authority changed')
    expect(run.stderr()).not.toContain('unsettled top-level await')
  })

  it('exits 1 with a reason when the socket drops without CLOSED', async () => {
    const r = await relay('dropped')
    relays.push(r)
    const run = subscribe(r.url)
    const code = await run.exited
    expect(code).toBe(1)
    // nostr-tools reports a socket that goes away as closed, or as failed if it errors first
    expect(run.stderr()).toMatch(/relay connection (closed|failed)/)
    expect(run.stderr()).not.toContain('unsettled top-level await')
  })

  it('exits 1 and says how to authenticate when the relay needs AUTH and auth is off', async () => {
    const r = await relay('auth-required')
    relays.push(r)
    const run = subscribe(r.url)
    const code = await run.exited
    expect(code).toBe(1)
    expect(run.stderr()).toContain('auth-required: sign in first')
    expect(run.stderr()).toContain('NOSTR_AUTH=1')
  })

  it('still exits 0 and quietly on Ctrl-C', async () => {
    const r = await relay('stays-open')
    relays.push(r)
    const run = subscribe(r.url)
    for (let i = 0; i < 200 && !r.subscribed(); i++) await new Promise(resolve => setTimeout(resolve, 25))
    expect(r.subscribed()).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 100))
    run.child.kill('SIGINT')
    const code = await run.exited
    expect(code).toBe(0)
    expect(run.stderr()).not.toContain('subscription ended')
  })
})
