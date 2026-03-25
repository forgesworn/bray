import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startRelay } from '../src/serve.js'
import WebSocket from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'

let relay: ReturnType<typeof startRelay>
let url: string

function sendAndReceive(ws: WebSocket, msg: unknown[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
    ws.once('message', (data) => {
      clearTimeout(timeout)
      resolve(JSON.parse(data.toString()))
    })
    ws.send(JSON.stringify(msg))
  })
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function collectMessages(ws: WebSocket, count: number, timeoutMs = 3000): Promise<unknown[][]> {
  return new Promise((resolve) => {
    const messages: unknown[][] = []
    const timeout = setTimeout(() => resolve(messages), timeoutMs)
    const handler = (data: Buffer) => {
      messages.push(JSON.parse(data.toString()))
      if (messages.length >= count) {
        clearTimeout(timeout)
        ws.off('message', handler)
        resolve(messages)
      }
    }
    ws.on('message', handler)
  })
}

describe('serve — in-memory relay', () => {
  beforeAll(() => {
    relay = startRelay({ port: 0, quiet: true })
    // Extract actual port from url
    url = relay.url
    // startRelay uses the given port; for test isolation let's use a random one
  })

  // Use a fixed port for predictable tests
  beforeAll(() => {
    relay.close()
    relay = startRelay({ port: 19547, quiet: true })
    url = relay.url
  })

  afterAll(() => {
    relay.close()
  })

  it('accepts WebSocket connections', async () => {
    const ws = await connect()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('stores and retrieves events (EVENT + REQ round-trip)', async () => {
    const ws = await connect()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)

    const event = finalizeEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'hello from test',
    }, sk)

    // Publish
    const okMsg = await sendAndReceive(ws, ['EVENT', event])
    expect(okMsg[0]).toBe('OK')
    expect(okMsg[1]).toBe(event.id)
    expect(okMsg[2]).toBe(true)

    // Query
    const collecting = collectMessages(ws, 2) // EVENT + EOSE
    ws.send(JSON.stringify(['REQ', 'test-sub', { kinds: [1], authors: [pk] }]))
    const msgs = await collecting

    const eventMsg = msgs.find(m => m[0] === 'EVENT')
    expect(eventMsg).toBeDefined()
    expect((eventMsg![2] as any).content).toBe('hello from test')

    const eoseMsg = msgs.find(m => m[0] === 'EOSE')
    expect(eoseMsg).toBeDefined()

    ws.close()
  })

  it('rejects events with invalid signatures', async () => {
    const ws = await connect()
    const badEvent = {
      kind: 1,
      pubkey: 'a'.repeat(64),
      created_at: 1000,
      tags: [],
      content: 'bad sig',
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128),
    }
    const okMsg = await sendAndReceive(ws, ['EVENT', badEvent])
    expect(okMsg[0]).toBe('OK')
    expect(okMsg[2]).toBe(false)
    ws.close()
  })

  it('notifies subscribers of new events in real-time', async () => {
    const ws1 = await connect()
    const ws2 = await connect()
    const sk = generateSecretKey()

    // ws1 subscribes
    const subCollecting = collectMessages(ws1, 3, 3000) // EOSE + new EVENT later
    ws1.send(JSON.stringify(['REQ', 'live-sub', { kinds: [1] }]))

    // Wait a tick for subscription to register
    await new Promise(r => setTimeout(r, 100))

    // ws2 publishes
    const event = finalizeEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'real-time notification',
    }, sk)
    ws2.send(JSON.stringify(['EVENT', event]))

    const msgs = await subCollecting
    const liveEvent = msgs.find(m => m[0] === 'EVENT' && (m[2] as any)?.content === 'real-time notification')
    expect(liveEvent).toBeDefined()

    ws1.close()
    ws2.close()
  })

  it('supports CLOSE to unsubscribe', async () => {
    const ws = await connect()
    ws.send(JSON.stringify(['REQ', 'close-test', { kinds: [1] }]))
    // Wait for EOSE
    await new Promise(r => setTimeout(r, 200))
    const closeMsg = await sendAndReceive(ws, ['CLOSE', 'close-test'])
    expect(closeMsg[0]).toBe('CLOSED')
    ws.close()
  })

  it('supports COUNT', async () => {
    const ws = await connect()
    const countMsg = await sendAndReceive(ws, ['COUNT', 'count-sub', { kinds: [1] }])
    expect(countMsg[0]).toBe('COUNT')
    expect((countMsg[2] as any).count).toBeGreaterThanOrEqual(0)
    ws.close()
  })

  it('returns NOTICE for unknown message types', async () => {
    const ws = await connect()
    const noticeMsg = await sendAndReceive(ws, ['GARBAGE', 'test'])
    expect(noticeMsg[0]).toBe('NOTICE')
    ws.close()
  })

  it('serves NIP-11 relay info via HTTP', async () => {
    const httpUrl = url.replace('ws://', 'http://')
    const response = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
    })
    expect(response.ok).toBe(true)
    const info = await response.json() as any
    expect(info.name).toContain('nostr-bray')
    expect(info.supported_nips).toContain(1)
  })

  it('respects limit in REQ filters', async () => {
    const ws = await connect()
    const sk = generateSecretKey()

    // Publish 5 events
    for (let i = 0; i < 5; i++) {
      const event = finalizeEvent({
        kind: 7777,
        created_at: 1000 + i,
        tags: [],
        content: `limit-test-${i}`,
      }, sk)
      await sendAndReceive(ws, ['EVENT', event])
    }

    // Query with limit 2
    const collecting = collectMessages(ws, 3, 2000)
    ws.send(JSON.stringify(['REQ', 'limit-sub', { kinds: [7777], limit: 2 }]))
    const msgs = await collecting
    const events = msgs.filter(m => m[0] === 'EVENT')
    expect(events.length).toBe(2)

    ws.close()
  })
})
