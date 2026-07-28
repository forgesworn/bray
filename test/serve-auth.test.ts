import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { startRelay } from '../src/serve.js'

let relay: ReturnType<typeof startRelay>
let url: string

const sk = generateSecretKey()
const pk = getPublicKey(sk)

/** Open a socket and collect messages until `done` says we have enough. */
function converse(
  send: (ws: WebSocket, messages: unknown[][]) => void,
  done: (messages: unknown[][]) => boolean,
  timeoutMs = 5_000,
): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const received: unknown[][] = []
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`timed out; received ${JSON.stringify(received)}`))
    }, timeoutMs)

    ws.on('open', () => send(ws, received))
    ws.on('message', raw => {
      received.push(JSON.parse(raw.toString()))
      if (done(received)) {
        clearTimeout(timer)
        ws.close()
        resolve(received)
      }
    })
    ws.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

function authEvent(challenge: string, overrides: Partial<{ kind: number; created_at: number; challenge: string }> = {}) {
  return finalizeEvent({
    kind: overrides.kind ?? 22242,
    created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
    tags: [['relay', url], ['challenge', overrides.challenge ?? challenge]],
    content: '',
  }, sk)
}

describe('serve --auth', () => {
  beforeAll(async () => {
    relay = startRelay({ port: 0, quiet: true, auth: true })
    await relay.ready
    url = relay.url
  })
  afterAll(() => relay?.close())

  it('rejects a REQ before authentication and offers a challenge', async () => {
    const msgs = await converse(
      ws => ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }])),
      m => m.some(x => x[0] === 'CLOSED'),
    )
    const auth = msgs.find(m => m[0] === 'AUTH')
    const closed = msgs.find(m => m[0] === 'CLOSED')
    expect(auth).toBeDefined()
    expect(typeof auth![1]).toBe('string')
    expect(String(closed![2])).toMatch(/auth-required/)
  })

  it('rejects an EVENT before authentication', async () => {
    const evt = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hi' }, sk)
    const msgs = await converse(
      ws => ws.send(JSON.stringify(['EVENT', evt])),
      m => m.some(x => x[0] === 'OK'),
    )
    const ok = msgs.find(m => m[0] === 'OK')!
    expect(ok[2]).toBe(false)
    expect(String(ok[3])).toMatch(/auth-required/)
  })

  it('accepts a valid auth event and then serves the REQ', async () => {
    const msgs = await converse(
      ws => {
        ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }]))
        ws.once('message', raw => {
          const first = JSON.parse(raw.toString())
          if (first[0] === 'AUTH') {
            ws.send(JSON.stringify(['AUTH', authEvent(first[1])]))
            ws.send(JSON.stringify(['REQ', 'sub2', { kinds: [1] }]))
          }
        })
      },
      m => m.some(x => x[0] === 'EOSE' && x[1] === 'sub2'),
    )
    // The auth event itself is acknowledged, and the retried REQ is served
    expect(msgs.some(m => m[0] === 'OK' && m[2] === true)).toBe(true)
    expect(msgs.some(m => m[0] === 'EOSE' && m[1] === 'sub2')).toBe(true)
  })

  it('rejects an auth event carrying the wrong challenge', async () => {
    // The core replay protection: an auth event lifted from another
    // connection names a different challenge and must not be accepted here.
    const msgs = await converse(
      ws => {
        ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }]))
        ws.once('message', () => {
          ws.send(JSON.stringify(['AUTH', authEvent('not-the-challenge')]))
        })
      },
      m => m.some(x => x[0] === 'OK' && x[2] === false && /challenge mismatch/.test(String(x[3]))),
    )
    expect(msgs.some(m => /challenge mismatch/.test(String(m[3])))).toBe(true)
  })

  it('rejects an auth event of the wrong kind', async () => {
    const msgs = await converse(
      ws => {
        ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }]))
        ws.once('message', raw => {
          const first = JSON.parse(raw.toString())
          ws.send(JSON.stringify(['AUTH', authEvent(first[1], { kind: 1 })]))
        })
      },
      m => m.some(x => x[0] === 'OK' && x[2] === false && /22242/.test(String(x[3]))),
    )
    expect(msgs.some(m => /expected kind 22242/.test(String(m[3])))).toBe(true)
  })

  it('rejects a stale auth event', async () => {
    const msgs = await converse(
      ws => {
        ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }]))
        ws.once('message', raw => {
          const first = JSON.parse(raw.toString())
          ws.send(JSON.stringify(['AUTH', authEvent(first[1], { created_at: Math.floor(Date.now() / 1000) - 4000 })]))
        })
      },
      m => m.some(x => x[0] === 'OK' && x[2] === false && /timestamp/.test(String(x[3]))),
    )
    expect(msgs.some(m => /timestamp too far/.test(String(m[3])))).toBe(true)
  })
})

describe('serve --eager-auth', () => {
  let eager: ReturnType<typeof startRelay>

  beforeAll(async () => {
    eager = startRelay({ port: 0, quiet: true, auth: true, eagerAuth: true })
    await eager.ready
    url = eager.url
  })
  afterAll(() => eager?.close())

  it('sends the challenge on connect, before any request', async () => {
    const msgs = await converse(() => {}, m => m.length > 0)
    expect(msgs[0][0]).toBe('AUTH')
    expect(typeof msgs[0][1]).toBe('string')
  })
})

describe('serve without --auth', () => {
  let open: ReturnType<typeof startRelay>

  beforeAll(async () => {
    open = startRelay({ port: 0, quiet: true })
    await open.ready
    url = open.url
  })
  afterAll(() => open?.close())

  it('serves a REQ with no authentication at all', async () => {
    const msgs = await converse(
      ws => ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }])),
      m => m.some(x => x[0] === 'EOSE'),
    )
    expect(msgs.some(m => m[0] === 'EOSE')).toBe(true)
    expect(msgs.some(m => m[0] === 'AUTH')).toBe(false)
  })
})
