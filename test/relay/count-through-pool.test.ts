import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../../src/relay-pool.js'
import type { AuthMode } from '../../src/relay-pool.js'
import { handleRelayCount } from '../../src/relay/count.js'
import { registerRelayTools } from '../../src/relay/tools.js'

/**
 * A relay that answers COUNT. `gated` challenges on connect and refuses COUNT
 * and REQ until a valid-looking AUTH; `nip45: false` refuses COUNT as
 * unsupported but serves REQ with `count` stored notes.
 */
async function relay(opts: { count: number; gated?: boolean; nip45?: boolean; approximate?: boolean }) {
  const sk = generateSecretKey()
  const notes = Array.from({ length: opts.count }, (_, i) =>
    finalizeEvent({ kind: 1, created_at: 1_700_000_000 + i, tags: [], content: `note ${i}` }, sk))
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const seen = { connections: 0, frames: [] as string[] }
  wss.on('connection', ws => {
    seen.connections++
    let authed = false
    if (opts.gated) ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      seen.frames.push(msg[0])
      if (msg[0] === 'AUTH') {
        authed = true
        return ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
      }
      if (opts.gated && !authed && (msg[0] === 'COUNT' || msg[0] === 'REQ')) {
        return ws.send(JSON.stringify(['CLOSED', msg[1], 'auth-required: sign in first']))
      }
      if (msg[0] === 'COUNT') {
        if (opts.nip45 === false) return ws.send(JSON.stringify(['CLOSED', msg[1], 'unsupported: COUNT']))
        return ws.send(JSON.stringify(['COUNT', msg[1], { count: opts.count, ...(opts.approximate ? { approximate: true } : {}) }]))
      }
      if (msg[0] === 'REQ') {
        for (const note of notes) ws.send(JSON.stringify(['EVENT', msg[1], note]))
        ws.send(JSON.stringify(['EOSE', msg[1]]))
      }
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    seen,
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

/**
 * Stand in for globalThis.WebSocket, recording every URL something opens
 * directly. It never connects: it fails on the next tick, so no traffic leaves
 * the machine. bray's pool uses the ws package with its own agent, not this.
 */
function recordDirectSockets() {
  const opened: string[] = []
  class RecordingWebSocket {
    onopen: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((e: unknown) => void) | null = null
    constructor(url: string) {
      opened.push(String(url))
      setTimeout(() => { this.onerror?.(new Error('blocked by test')); this.onclose?.() }, 0)
    }
    send() {}
    close() {}
  }
  vi.stubGlobal('WebSocket', RecordingWebSocket)
  return opened
}

const signer = (() => {
  const sk = generateSecretKey()
  return async (evt: any) => finalizeEvent(evt, sk) as any
})()

describe('handleRelayCount through the relay pool', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  function pool(authMode: AuthMode, extra: { torProxy?: string; allowClearnet?: boolean } = {}) {
    const p = new RelayPool({ allowClearnet: extra.allowClearnet ?? true, defaultRelays: [], allowPrivateRelays: true, authMode, torProxy: extra.torProxy })
    p.setAuthSigner(signer)
    cleanups.push(() => p.close())
    return p
  }

  it('counts with NIP-45 COUNT on the pool\'s connection', async () => {
    const r = await relay({ count: 7, approximate: true })
    cleanups.push(r.close)
    const result = await handleRelayCount([r.url], { kinds: [1] }, pool('off'))
    expect(result.counts).toEqual([{ relay: r.url, count: 7, estimated: true }])
    expect(result.total).toBe(7)
    expect(r.seen.frames).toContain('COUNT')
  })

  it('authenticates on auth-required: and counts with COUNT, not a fallback', async () => {
    const r = await relay({ count: 3, gated: true })
    cleanups.push(r.close)
    const result = await handleRelayCount([r.url], { kinds: [1] }, pool('on-demand'))
    expect(result.counts[0]).toEqual({ relay: r.url, count: 3 })
    expect(r.seen.connections).toBe(1)
    expect(r.seen.frames.filter(f => f === 'AUTH')).toHaveLength(1)
    expect(r.seen.frames.indexOf('AUTH')).toBeLessThan(r.seen.frames.lastIndexOf('COUNT'))
  })

  it('reports the refusal and how to authenticate when auth is off, without waiting out a timeout', async () => {
    const r = await relay({ count: 3, gated: true })
    cleanups.push(r.close)
    const started = Date.now()
    const result = await handleRelayCount([r.url], { kinds: [1] }, pool('off'))
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.counts[0].count).toBe(0)
    expect(result.counts[0].error).toContain('auth-required: sign in first')
    expect(result.counts[0].error).toContain('NOSTR_AUTH=1')
  })

  it('falls back to counting a REQ when the relay does not support COUNT, and says so', async () => {
    const r = await relay({ count: 4, nip45: false })
    cleanups.push(r.close)
    const result = await handleRelayCount([r.url], { kinds: [1] }, pool('off'))
    expect(result.counts[0]).toEqual({ relay: r.url, count: 4, fallback: true, estimated: false })
  })

  it('reports an unreachable relay as an error', async () => {
    const url = `ws://127.0.0.1:${await closedPort()}`
    const result = await handleRelayCount([url], { kinds: [1] }, pool('off'))
    expect(result.counts[0].count).toBe(0)
    expect(result.counts[0].error).toMatch(/connection/)
  })

  it('refuses a clearnet relay before connecting when Tor is required', async () => {
    const opened = recordDirectSockets()
    cleanups.push(() => vi.unstubAllGlobals())
    const p = pool('off', { torProxy: `socks5h://127.0.0.1:${await closedPort()}`, allowClearnet: false })
    await expect(handleRelayCount(['wss://relay.example.com'], { kinds: [1] }, p)).rejects.toThrow(/Tor/)
    expect(opened).toEqual([])
  })
})

describe('the relay-count MCP tool with TOR_PROXY set', () => {
  it('opens no direct WebSocket: the count goes through the pool and its proxy', async () => {
    const opened = recordDirectSockets()
    // socks5h: the name resolves at the proxy, which is unreachable here, so
    // the pool's attempt goes nowhere either.
    const p = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, torProxy: `socks5h://127.0.0.1:${await closedPort()}` })
    const server = new McpServer({ name: 'relay-count-tor-test', version: '0.0.0' }, {})
    registerRelayTools(server, {
      ctx: { activeNpub: 'npub1test', activePublicKeyHex: 'f'.repeat(64), getSigningFunction: () => signer } as any,
      pool: p,
      nip65: {} as any,
      walletsFile: '/nonexistent',
    } as any)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'relay-count-tor-test-client', version: '0.0.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      await client.callTool({ name: 'relay-count', arguments: { relays: ['wss://relay.example.com'], kinds: [1] } })
      expect(opened).toEqual([])
    } finally {
      await client.close()
      p.close()
      vi.unstubAllGlobals()
    }
  })
})
