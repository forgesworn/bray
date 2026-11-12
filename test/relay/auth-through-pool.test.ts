import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../../src/relay-pool.js'
import { handleRelayAuth } from '../../src/relay/auth.js'
import { registerRelayTools } from '../../src/relay/tools.js'
import { startRelay } from '../../src/serve.js'

/**
 * An auth-gated relay holding one note. `challenge`: on connect, only after
 * refusing a REQ (as bray's own serve --auth does), or never. `refuseFirst`
 * refuses that many AUTH attempts before accepting.
 */
async function gatedRelay(opts: { challenge: 'connect' | 'on-refusal' | 'never'; refuseFirst?: number }) {
  const note = finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: 'members only' }, generateSecretKey())
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const seen = { connections: 0, auths: 0 }
  let refusals = opts.refuseFirst ?? 0
  wss.on('connection', ws => {
    seen.connections++
    let authed = false
    if (opts.challenge === 'connect') ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] === 'AUTH') {
        seen.auths++
        if (refusals > 0) {
          refusals--
          return ws.send(JSON.stringify(['OK', msg[1].id, false, 'restricted: not yet']))
        }
        authed = true
        return ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
      }
      if (msg[0] !== 'REQ') return
      if (!authed) {
        ws.send(JSON.stringify(['CLOSED', msg[1], 'auth-required: sign in first']))
        if (opts.challenge === 'on-refusal') ws.send(JSON.stringify(['AUTH', 'challenge-2']))
        return
      }
      ws.send(JSON.stringify(['EVENT', msg[1], note]))
      ws.send(JSON.stringify(['EOSE', msg[1]]))
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    note,
    seen,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

function identity() {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const signer = async (evt: any) => finalizeEvent(evt, sk) as any
  return { pk, signer, ctx: { activePublicKeyHex: pk, getSigningFunction: () => signer } as any }
}

describe('handleRelayAuth on the relay pool\'s own connection', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
    vi.unstubAllGlobals()
  })

  function pool(extra: { torProxy?: string } = {}) {
    const id = identity()
    // AUTH mode off: relay-auth is an explicit request, so it works anyway.
    const p = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, authMode: 'off', torProxy: extra.torProxy })
    p.setAuthSigner(id.signer, () => id.pk)
    cleanups.push(() => p.close())
    return { p, id }
  }

  it('after a refused query, authenticates the same connection so the retried query is served', async () => {
    const r = await gatedRelay({ challenge: 'on-refusal' })
    cleanups.push(r.close)
    const { p, id } = pool()

    expect(await p.queryDirect([r.url], { kinds: [1] })).toEqual([])
    const result = await handleRelayAuth(id.ctx, r.url, p)
    expect(result).toEqual({ authenticated: true, relay: r.url, pubkey: id.pk })
    await new Promise(resolve => setTimeout(resolve, 1_500))
    const events = await p.queryDirect([r.url], { kinds: [1] })

    expect(events.map(e => e.id)).toEqual([r.note.id])
    expect(r.seen.connections).toBe(1)
    expect(r.seen.auths).toBe(1)
  })

  it('works cold against a relay that challenges on connect', async () => {
    const r = await gatedRelay({ challenge: 'connect' })
    cleanups.push(r.close)
    const { p, id } = pool()
    expect((await handleRelayAuth(id.ctx, r.url, p)).authenticated).toBe(true)
    expect((await p.queryDirect([r.url], { kinds: [1] })).map(e => e.id)).toEqual([r.note.id])
    expect(r.seen.connections).toBe(1)
  })

  it('works cold against a relay that challenges only after refusing a request', async () => {
    const r = await gatedRelay({ challenge: 'on-refusal' })
    cleanups.push(r.close)
    const { p, id } = pool()
    expect((await handleRelayAuth(id.ctx, r.url, p)).authenticated).toBe(true)
    expect((await p.queryDirect([r.url], { kinds: [1] })).map(e => e.id)).toEqual([r.note.id])
  })

  it('works against bray\'s own serve --auth relay', async () => {
    const served = startRelay({ port: 0, hostname: '127.0.0.1', quiet: true, auth: true })
    await served.ready
    cleanups.push(() => served.close())
    const { p, id } = pool()
    expect((await handleRelayAuth(id.ctx, served.url, p)).authenticated).toBe(true)
  })

  it('tries again on a fresh connection after a refusal, rather than repeating the cached one', async () => {
    const r = await gatedRelay({ challenge: 'connect', refuseFirst: 1 })
    cleanups.push(r.close)
    const { p, id } = pool()
    const first = await handleRelayAuth(id.ctx, r.url, p)
    expect(first.authenticated).toBe(false)
    expect(first.error).toContain('restricted: not yet')
    const second = await handleRelayAuth(id.ctx, r.url, p)
    expect(second.authenticated).toBe(true)
    expect(r.seen.connections).toBe(2)
  })

  it('reports a relay that never sends a challenge', async () => {
    const r = await gatedRelay({ challenge: 'never' })
    cleanups.push(r.close)
    const { p } = pool()
    const result = await p.authenticate(r.url, { timeoutMs: 600 })
    expect(result.authenticated).toBe(false)
    expect(result.error).toMatch(/challenge/)
  })

  it('goes through the pool\'s proxy: no direct WebSocket with TOR_PROXY set', async () => {
    const opened: string[] = []
    vi.stubGlobal('WebSocket', class {
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
    })
    const { p, id } = pool({ torProxy: `socks5h://127.0.0.1:${await closedPort()}` })
    const result = await handleRelayAuth(id.ctx, 'wss://relay.example.com', p)
    expect(opened).toEqual([])
    expect(result.authenticated).toBe(false)
  })
})

describe('the relay-auth MCP tool', () => {
  it('lets the documented flow work: query refused, relay-auth, query served', async () => {
    const r = await gatedRelay({ challenge: 'on-refusal' })
    const id = identity()
    const p = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, authMode: 'off' })
    p.setAuthSigner(id.signer, () => id.pk)
    const server = new McpServer({ name: 'relay-auth-test', version: '0.0.0' }, {})
    registerRelayTools(server, { ctx: { ...id.ctx, activeNpub: 'npub1test' }, pool: p, nip65: {} as any, walletsFile: '/nonexistent' } as any)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'relay-auth-test-client', version: '0.0.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    const text = (res: unknown) => JSON.parse((res as { content: Array<{ text: string }> }).content[0].text)
    try {
      const refused = text(await client.callTool({ name: 'relay-query', arguments: { relays: [r.url], kinds: [1] } }))
      expect(refused.count).toBe(0)
      const auth = text(await client.callTool({ name: 'relay-auth', arguments: { relay: r.url } }))
      expect(auth.authenticated).toBe(true)
      const served = text(await client.callTool({ name: 'relay-query', arguments: { relays: [r.url], kinds: [1] } }))
      expect(served.events.map((e: { id: string }) => e.id)).toEqual([r.note.id])
      expect(r.seen.connections).toBe(1)
    } finally {
      await client.close()
      p.close()
      await r.close()
    }
  })
})
