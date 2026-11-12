import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../src/relay-pool.js'

/**
 * A relay that challenges on connect and refuses every AUTH, as a members-only
 * relay does for a key it does not know, or for an AUTH naming another URL.
 * `gated` relays also refuse events and REQs until authenticated; `open` ones
 * serve them anyway, as a public relay that only uses AUTH for extras does.
 */
async function refusingRelay(kind: 'gated' | 'open') {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const auths: unknown[] = []
  wss.on('connection', ws => {
    ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] === 'AUTH') {
        auths.push(msg[1])
        ws.send(JSON.stringify(['OK', msg[1].id, false, 'restricted: this key is not on the list']))
      } else if (msg[0] === 'EVENT') {
        ws.send(JSON.stringify(kind === 'open'
          ? ['OK', msg[1].id, true, '']
          : ['OK', msg[1].id, false, 'auth-required: sign in first']))
      } else if (msg[0] === 'REQ') {
        ws.send(JSON.stringify(kind === 'open'
          ? ['EOSE', msg[1]]
          : ['CLOSED', msg[1], 'auth-required: sign in first']))
      }
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    auths,
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

const settle = () => new Promise(resolve => setTimeout(resolve, 100))

describe('RelayPool eager NIP-42 against a relay that refuses the AUTH', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  async function setUp(kind: 'gated' | 'open') {
    const relay = await refusingRelay(kind)
    const sk = generateSecretKey()
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, authMode: 'eager' })
    pool.setAuthSigner(async evt => finalizeEvent(evt, sk))
    const unhandled = watchUnhandled()
    cleanups.push(relay.close, () => pool.close(), unhandled.stop)
    const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello' }, sk)
    return { relay, pool, unhandled, note }
  }

  it('reports the refusal in the publish result instead of crashing', async () => {
    const { relay, pool, unhandled, note } = await setUp('gated')
    const result = await pool.publishDirect([relay.url], note)
    await settle()

    expect(unhandled.seen).toEqual([])
    expect(relay.auths).toHaveLength(1)
    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('restricted: this key is not on the list')
  })

  it('still publishes to a relay that refuses the AUTH but accepts the event', async () => {
    const { relay, pool, unhandled, note } = await setUp('open')
    const result = await pool.publishDirect([relay.url], note)
    await settle()

    expect(unhandled.seen).toEqual([])
    expect(relay.auths).toHaveLength(1)
    expect(result.success).toBe(true)
  })

  it('returns an empty query instead of crashing', async () => {
    const { relay, pool, unhandled } = await setUp('gated')
    const events = await pool.queryDirect([relay.url], { kinds: [1] })
    await settle()

    expect(unhandled.seen).toEqual([])
    expect(events).toEqual([])
  })
})
