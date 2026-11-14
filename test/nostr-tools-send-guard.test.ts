import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { SimplePool } from 'nostr-tools/pool'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import { finalizeEvent, generateSecretKey, type EventTemplate } from 'nostr-tools/pure'
import { guardRelaySends, setAutomaticAuth } from '../src/nostr-tools-guards.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** A relay that challenges on connect; `drop()` cuts the client off. */
async function challengingRelay() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const connected = deferred<WebSocket>()
  const auths: unknown[] = []
  wss.on('connection', ws => {
    connected.resolve(ws)
    ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] === 'AUTH') auths.push(msg[1])
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}/`,
    auths,
    drop: async () => (await connected.promise).terminate(),
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

/** Collect unhandled rejections for the duration of a test. */
function watchUnhandled() {
  const seen: unknown[] = []
  const listener = (reason: unknown) => { seen.push(reason) }
  process.on('unhandledRejection', listener)
  return { seen, stop: () => process.off('unhandledRejection', listener) }
}

/** Resolves once the relay has seen its connection close. */
function closedSignal(relay: AbstractRelay): Promise<void> {
  const closed = deferred()
  const onclose = relay.onclose
  relay.onclose = () => { onclose?.(); closed.resolve() }
  return closed.promise
}

/**
 * A signer that holds its answer until released, as a remote signer waiting
 * for a button press does.
 */
function heldSigner() {
  const sk = generateSecretKey()
  const asked = deferred()
  const release = deferred()
  const sign = async (evt: EventTemplate) => {
    asked.resolve()
    await release.promise
    return finalizeEvent(evt, sk)
  }
  return { sign, asked: asked.promise, release: release.resolve }
}

// A turn of the event loop, so a rejection nothing handles is reported.
const turn = () => new Promise(resolve => setTimeout(resolve, 50))

describe('an AUTH signed after the relay connection closed', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  async function setUp() {
    const relay = await challengingRelay()
    const pool = new SimplePool()
    guardRelaySends(pool)
    const unhandled = watchUnhandled()
    cleanups.push(relay.close, () => pool.destroy(), unhandled.stop)
    return { relay, pool, unhandled }
  }

  it('does not leave an unhandled rejection on the automatic answer', async () => {
    const { relay, pool, unhandled } = await setUp()
    const signer = heldSigner()
    setAutomaticAuth(pool, () => signer.sign)
    const conn = await pool.ensureRelay(relay.url)
    const closed = closedSignal(conn)

    await signer.asked
    await relay.drop()
    await closed
    signer.release()
    const settled = await (conn as unknown as { authPromise: Promise<string> }).authPromise
      .then(() => 'resolved', (err: Error) => err.name)
    await turn()

    expect(unhandled.seen).toEqual([])
    expect(settled).toBe('SendingOnClosedConnection')
    expect(relay.auths).toEqual([])
  })

  it('fails an explicit auth() at once with the closed connection', async () => {
    const { relay, pool, unhandled } = await setUp()
    const conn = await pool.ensureRelay(relay.url)
    const closed = closedSignal(conn)
    // Wait for the challenge without answering it.
    while (!(conn as unknown as { challenge?: string }).challenge) await new Promise(resolve => setImmediate(resolve))
    const signer = heldSigner()

    const attempt = conn.auth(signer.sign)
    await signer.asked
    await relay.drop()
    await closed
    const started = Date.now()
    signer.release()
    const err = await attempt.then(() => undefined, (e: Error) => e)
    await turn()

    expect(unhandled.seen).toEqual([])
    expect(err?.name).toBe('SendingOnClosedConnection')
    // nostr-tools would otherwise report "auth timed out" after its 4.4 s publish timeout.
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
