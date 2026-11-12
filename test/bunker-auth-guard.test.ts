import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { encrypt, getConversationKey } from 'nostr-tools/nip44'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'

// Deterministic test identity, as in the other bunker tests. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

/**
 * A relay for the bunker to listen on. `challenge` sends an AUTH challenge on
 * connect and refuses the answer; `refuseEvents` refuses every EVENT. `inject`
 * pushes an event into the bunker's subscription, as if a client had sent it.
 */
async function relay(opts: { challenge?: boolean; refuseEvents?: boolean }) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const subs: Array<{ send(data: string): void; id: string }> = []
  wss.on('connection', ws => {
    if (opts.challenge) ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] === 'AUTH') ws.send(JSON.stringify(['OK', msg[1].id, false, 'restricted: this key is not on the list']))
      else if (msg[0] === 'REQ') {
        subs.push({ send: d => ws.send(d), id: msg[1] })
        ws.send(JSON.stringify(['EOSE', msg[1]]))
      } else if (msg[0] === 'EVENT') {
        ws.send(JSON.stringify(['OK', msg[1].id, !opts.refuseEvents, opts.refuseEvents ? 'restricted: not accepting events' : '']))
      }
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    subscribed: () => subs.length > 0,
    inject: (event: unknown) => { for (const sub of subs) sub.send(JSON.stringify(['EVENT', sub.id, event])) },
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

/** A loopback port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('bunker daemon against relays that refuse it', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
    vi.restoreAllMocks()
  })

  function start(relays: string[], quiet: boolean) {
    const stateDir = mkdtempSync(join(tmpdir(), 'bray-bunker-auth-guard-'))
    const ctx = new IdentityContext(TEST_NSEC, 'nsec')
    const bunker = startBunker({ ctx, relays, quiet, stateDir })
    cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }), () => ctx.destroy(), () => bunker.close())
    return bunker
  }

  it('survives a relay that refuses its automatic AUTH', async () => {
    const r = await relay({ challenge: true })
    cleanups.push(r.close)
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', listener)
    cleanups.push(() => process.off('unhandledRejection', listener))

    start([r.url], true)
    for (let i = 0; i < 100 && !r.subscribed(); i++) await pause(20)
    await pause(200)

    expect(r.subscribed()).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('logs a response no relay accepted as not delivered, not as sent', async () => {
    const r = await relay({ refuseEvents: true })
    cleanups.push(r.close)
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')) })

    // One relay refuses the response, the other cannot be reached: nostr-tools
    // resolves the unreachable one with "connection failure", which is not delivery.
    const bunker = start([r.url, `ws://127.0.0.1:${await closedPort()}`], false)
    for (let i = 0; i < 100 && !r.subscribed(); i++) await pause(20)

    // A connect with the wrong secret, which the bunker answers with a refusal.
    const clientSk = generateSecretKey()
    const request = JSON.stringify({ id: 'r1', method: 'connect', params: [bunker.pubkey, 'not-the-secret'] })
    r.inject(finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', bunker.pubkey]],
      content: encrypt(request, getConversationKey(clientSk, bunker.pubkey)),
    }, clientSk))
    for (let i = 0; i < 100 && !lines.some(l => l.includes('Response r1')); i++) await pause(20)

    const response = lines.filter(l => l.includes('Response r1'))
    expect(response).toHaveLength(1)
    expect(response[0]).toContain('not delivered')
    expect(response[0]).toContain('restricted: not accepting events')
  })
})

describe('automatic NIP-42 answers', () => {
  it('are installed only through setAutomaticAuth, which guards a refused AUTH', () => {
    // nostr-tools rethrows a refused automatic AUTH where nothing can catch it,
    // so a pool must not set automaticallyAuth directly (see nostr-tools-guards.ts).
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts')) files.push(path)
      }
    }
    walk('src')
    const direct = files
      .filter(path => !path.endsWith('nostr-tools-guards.ts'))
      .filter(path => /\.automaticallyAuth\s*=/.test(readFileSync(path, 'utf8')))
    expect(direct).toEqual([])
  })
})
