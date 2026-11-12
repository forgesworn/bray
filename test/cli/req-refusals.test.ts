/**
 * `req` when relays refuse the REQ, and when there is no relay to ask.
 *
 * Runs the built CLI (dist/cli.js), so run after `npm run build`. Each case
 * starts its own relay on an ephemeral port.
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
const CONFIG_HOME = mkdtempSync(join(tmpdir(), 'bray-req-refusals-'))
// Deterministic test identity, as in the smoke suite. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

afterAll(() => rmSync(CONFIG_HOME, { recursive: true, force: true }))

/**
 * A relay that answers bray's own lookups with EOSE and the kind 1 REQ with
 * `answer`: a stored note then EOSE, or CLOSED with a reason.
 */
async function relay(answer: { closed: string } | 'one note') {
  const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'stored' }, generateSecretKey())
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  wss.on('connection', ws => {
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] !== 'REQ') return
      const [, id, ...filters] = msg
      const isNotes = filters.some((f: { kinds?: number[] }) => f.kinds?.includes(1))
      if (!isNotes) return ws.send(JSON.stringify(['EOSE', id]))
      if (answer === 'one note') {
        ws.send(JSON.stringify(['EVENT', id, note]))
        return ws.send(JSON.stringify(['EOSE', id]))
      }
      ws.send(JSON.stringify(['CLOSED', id, answer.closed]))
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    note,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

function req(relays: string | undefined, ...args: string[]) {
  const child = spawn('node', [CLI, 'req', '--kinds', '1', ...args], {
    env: {
      NOSTR_SECRET_KEY: TEST_NSEC,
      PATH: process.env.PATH!,
      HOME: CONFIG_HOME,
      XDG_CONFIG_HOME: CONFIG_HOME,
      BRAY_ALLOW_PRIVATE_RELAYS: '1',
      ...(relays ? { NOSTR_RELAYS: relays } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += d })
  child.stderr.on('data', d => { stderr += d })
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

// A case that hangs is reported by its exit code (null, after the 10 s kill), not a test timeout.
describe('req when relays refuse, or there are none', { timeout: 15_000 }, () => {
  const relays: Array<{ close(): Promise<void> }> = []
  afterEach(async () => {
    while (relays.length) await relays.pop()!.close()
  })

  it('exits 1 with the reason when the relay refuses the REQ', async () => {
    const r = await relay({ closed: 'restricted: this key has no sheltered access' })
    relays.push(r)
    const run = await req(r.url)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('restricted: this key has no sheltered access')
  })

  it('says how to authenticate when the relay needs AUTH and auth is off', async () => {
    const r = await relay({ closed: 'auth-required: sign in first' })
    relays.push(r)
    const run = await req(r.url, '--relay', r.url)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('auth-required: sign in first')
    expect(run.stderr).toContain('NOSTR_AUTH=1')
  })

  it('still exits 0 and quietly when the relay answers', async () => {
    const r = await relay('one note')
    relays.push(r)
    const run = await req(r.url)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain(r.note.id)
    expect(run.stderr).not.toMatch(/restricted:|auth-required:/)
  })

  it('exits 1 with "No relays available" when no relay is configured', async () => {
    const run = await req(undefined)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('No relays available')
  })
})
