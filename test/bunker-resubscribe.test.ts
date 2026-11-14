import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { encrypt, getConversationKey } from 'nostr-tools/nip44'
import { startBunker } from '../src/bunker.js'
import { holdProcessOpen } from '../src/hold-open.js'
import { IdentityContext } from '../src/context.js'

// Deterministic test identity, as in the other bunker tests. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, ms = 3_000): Promise<void> {
  for (let waited = 0; !check() && waited < ms; waited += 20) await pause(20)
}

/**
 * A relay that can go away and come back on the same port, as a restart does.
 * It records each REQ it receives and each EVENT published to it, and `inject`
 * pushes an event into the live subscriptions.
 */
function restartableRelay() {
  let wss: WebSocketServer | null = null
  let port = 0
  const reqs: Array<{ filter: Record<string, unknown> }> = []
  const published: Array<Record<string, unknown>> = []
  const live: Array<{ send(data: string): void; id: string }> = []

  const listen = async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port })
    await new Promise(resolve => server.once('listening', resolve))
    port = (server.address() as { port: number }).port
    server.on('connection', ws => {
      ws.on('message', data => {
        const msg = JSON.parse(String(data))
        if (msg[0] === 'REQ') {
          reqs.push({ filter: msg[2] })
          live.push({ send: d => ws.send(d), id: msg[1] })
          ws.send(JSON.stringify(['EOSE', msg[1]]))
        } else if (msg[0] === 'EVENT') {
          published.push(msg[1])
          ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
        }
      })
    })
    wss = server
  }
  const stop = async () => {
    const server = wss
    wss = null
    live.length = 0
    if (!server) return
    for (const client of server.clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  return {
    listen,
    stop,
    get url() { return `ws://127.0.0.1:${port}` },
    reqs,
    published,
    inject: (event: unknown) => { for (const sub of live) sub.send(JSON.stringify(['EVENT', sub.id, event])) },
  }
}

describe('bunker daemon when a relay drops its subscription', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  function start(relays: string[]) {
    const stateDir = mkdtempSync(join(tmpdir(), 'bray-bunker-resub-'))
    const ctx = new IdentityContext(TEST_NSEC, 'nsec')
    const bunker = startBunker({ ctx, relays, quiet: true, stateDir, resubscribeDelayMs: 30 })
    cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }), () => ctx.destroy(), () => bunker.close())
    return bunker
  }

  // A request the bunker answers with a refusal, so its reply shows it is serving.
  function request(bunkerPubkey: string, id: string) {
    const clientSk = generateSecretKey()
    const body = JSON.stringify({ id, method: 'connect', params: [bunkerPubkey, 'not-the-secret'] })
    return finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', bunkerPubkey]],
      content: encrypt(body, getConversationKey(clientSk, bunkerPubkey)),
    }, clientSk)
  }

  it('subscribes again once the relay is back, and answers requests', async () => {
    const r = restartableRelay()
    await r.listen()
    cleanups.push(r.stop)
    const bunker = start([r.url])
    await until(() => r.reqs.length === 1)
    expect(r.reqs).toHaveLength(1)

    await r.stop()
    await pause(150)
    await r.listen()
    await until(() => r.reqs.length === 2)

    expect(r.reqs).toHaveLength(2)
    // The new subscription asks only for recent requests, not the whole history.
    expect(r.reqs[1].filter).toMatchObject({ kinds: [24133], '#p': [bunker.pubkey] })
    expect(typeof r.reqs[1].filter.since).toBe('number')

    r.inject(request(bunker.pubkey, 'after-restart'))
    await until(() => r.published.length > 0)
    expect(r.published).toHaveLength(1)
    expect(r.published[0].kind).toBe(24133)
  })

  it('keeps trying while the relay stays down', async () => {
    const r = restartableRelay()
    await r.listen()
    cleanups.push(r.stop)
    start([r.url])
    await until(() => r.reqs.length === 1)

    await r.stop()
    await pause(400)
    await r.listen()
    await until(() => r.reqs.length === 2, 5_000)
    expect(r.reqs).toHaveLength(2)
  })

  it('restores a relay that drops while another stays up', async () => {
    const steady = restartableRelay()
    const flaky = restartableRelay()
    await steady.listen()
    await flaky.listen()
    cleanups.push(steady.stop, flaky.stop)
    start([steady.url, flaky.url])
    await until(() => steady.reqs.length === 1 && flaky.reqs.length === 1)

    await flaky.stop()
    await pause(150)
    await flaky.listen()
    await until(() => flaky.reqs.length === 2)

    expect(flaky.reqs).toHaveLength(2)
    expect(steady.reqs).toHaveLength(1)
  })

  it('answers a request that two relays both deliver only once', async () => {
    const a = restartableRelay()
    const b = restartableRelay()
    await a.listen()
    await b.listen()
    cleanups.push(a.stop, b.stop)
    const bunker = start([a.url, b.url])
    await until(() => a.reqs.length === 1 && b.reqs.length === 1)

    const event = request(bunker.pubkey, 'twice')
    a.inject(event)
    b.inject(event)
    await until(() => a.published.length + b.published.length > 0)
    await pause(200)
    // One reply, published to each relay: handled twice it would be two each.
    expect(a.published).toHaveLength(1)
    expect(b.published).toHaveLength(1)
  })

  it('does not subscribe again after close()', async () => {
    const r = restartableRelay()
    await r.listen()
    cleanups.push(r.stop)
    const bunker = start([r.url])
    await until(() => r.reqs.length === 1)

    await r.stop()
    bunker.close()
    await r.listen()
    await pause(300)
    expect(r.reqs).toHaveLength(1)
  })
})

describe('holdProcessOpen', () => {
  it('keeps a process with no sockets alive until released', () => {
    // The pre-fix daemon ended in `await new Promise(() => {})`, which holds no
    // event-loop handle: Node exits 13 ("unsettled top-level await") as soon as
    // the last socket closes. Both children have nothing else to wait for.
    const run = (body: string) => spawnSync(process.execPath, [
      '--input-type=module', '-e',
      `import { holdProcessOpen } from ${JSON.stringify(new URL('../src/hold-open.ts', import.meta.url).href)}\n${body}`,
    ], { encoding: 'utf8', timeout: 4_000, killSignal: 'SIGKILL' })

    const bare = run(`await new Promise(() => {})`)
    expect(bare.status).toBe(13)

    const held = run(`const hold = holdProcessOpen(); await hold.done`)
    // Still running when the timeout killed it: no exit code, killed by the signal.
    expect(held.status).toBeNull()
    expect(held.signal).toBe('SIGKILL')

    const released = run(`const hold = holdProcessOpen(); setTimeout(() => hold.release(), 300); await hold.done; console.log('released')`)
    expect(released.status).toBe(0)
    expect(released.stdout).toContain('released')
  }, 15_000)

  it('holds one timer, and clears it on release', async () => {
    const timers = () => process.getActiveResourcesInfo().filter(name => name === 'Timeout').length
    const before = timers()
    const hold = holdProcessOpen()
    expect(timers()).toBe(before + 1)
    hold.release()
    await hold.done
    expect(timers()).toBe(before)
  })
})
