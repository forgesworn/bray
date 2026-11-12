import { describe, it, expect, afterEach, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../src/relay-pool.js'
import type { AuthMode } from '../src/relay-pool.js'
import { IdentityContext } from '../src/context.js'
import { handleDuressActivate } from '../src/safety/handlers.js'

// Deterministic test identity, as in the other suites. Never use in production.
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

/**
 * A relay that records, per connection, the pubkey of every AUTH it receives.
 * `gated` refuses REQ and EVENT until the connection has authenticated.
 */
async function relay(gated: boolean) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  const connections: Array<{ auths: string[]; closed: boolean }> = []
  wss.on('connection', ws => {
    const conn = { auths: [] as string[], closed: false }
    connections.push(conn)
    ws.on('close', () => { conn.closed = true })
    let authed = false
    if (gated) ws.send(JSON.stringify(['AUTH', 'challenge-1']))
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] === 'AUTH') {
        conn.auths.push(msg[1].pubkey)
        authed = true
        return ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
      }
      if (gated && !authed) {
        if (msg[0] === 'REQ') return ws.send(JSON.stringify(['CLOSED', msg[1], 'auth-required: sign in first']))
        if (msg[0] === 'EVENT') return ws.send(JSON.stringify(['OK', msg[1].id, false, 'auth-required: sign in first']))
      }
      if (msg[0] === 'REQ') ws.send(JSON.stringify(['EOSE', msg[1]]))
      if (msg[0] === 'EVENT') ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    connections,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 100))

/** Two plain keys standing in for two identities, with a "switch". */
function identities() {
  const keys = [generateSecretKey(), generateSecretKey()]
  let active = 0
  return {
    pubkey: (i: number) => getPublicKey(keys[i]),
    switchTo: (i: number) => { active = i },
    signer: async (evt: any) => finalizeEvent(evt, keys[active]) as any,
    current: () => getPublicKey(keys[active]),
    note: (text: string) => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: text }, keys[active]),
  }
}

describe('RelayPool keeps one identity per relay connection', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
    vi.restoreAllMocks()
  })

  function pool(authMode: AuthMode) {
    const p = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, authMode })
    cleanups.push(() => p.close())
    return p
  }

  it('does not let a connection that authenticated as one identity serve the next', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await relay(true)
    cleanups.push(r.close)
    const ids = identities()
    const p = pool('on-demand')
    p.setAuthSigner(ids.signer, ids.current)

    await p.queryDirect([r.url], { kinds: [1] })
    ids.switchTo(1)
    await p.queryDirect([r.url], { kinds: [1] })
    await settle()

    expect(r.connections).toHaveLength(2)
    expect(r.connections[0].auths).toEqual([ids.pubkey(0)])
    expect(r.connections[0].closed).toBe(true)
    expect(r.connections[1].auths).toEqual([ids.pubkey(1)])
  })

  it('with AUTH on, does not carry one identity\'s events and the next one\'s AUTH on the same connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await relay(false)
    cleanups.push(r.close)
    const ids = identities()
    const p = pool('on-demand')
    p.setAuthSigner(ids.signer, ids.current)

    await p.publishDirect([r.url], ids.note('from the first identity'))
    ids.switchTo(1)
    await p.publishDirect([r.url], ids.note('from the second identity'))
    await settle()

    expect(r.connections).toHaveLength(2)
    expect(r.connections[0].closed).toBe(true)
  })

  it('with AUTH off and no AUTH sent, keeps the connection across a switch', async () => {
    const r = await relay(false)
    cleanups.push(r.close)
    const ids = identities()
    const p = pool('off')
    p.setAuthSigner(ids.signer, ids.current)

    await p.queryDirect([r.url], { kinds: [1] })
    ids.switchTo(1)
    await p.queryDirect([r.url], { kinds: [1] })

    expect(r.connections).toHaveLength(1)
  })

  it('leaves connections alone while the active pubkey is unknown (a bunker before its key resolves)', async () => {
    const r = await relay(true)
    cleanups.push(r.close)
    const ids = identities()
    const p = pool('on-demand')
    p.setAuthSigner(ids.signer, () => { throw new Error('pubkey not yet resolved') })

    await p.queryDirect([r.url], { kinds: [1] })
    await p.queryDirect([r.url], { kinds: [1] })

    expect(r.connections).toHaveLength(1)
  })

  it('reconnects after the duress persona is activated, wired as the MCP server wires it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await relay(true)
    cleanups.push(r.close)
    const ctx = new IdentityContext(TEST_NSEC, 'nsec')
    cleanups.push(() => ctx.destroy())
    const p = pool('on-demand')
    // As src/index.ts does.
    p.setAuthSigner(async evt => ctx.getSigningFunction()(evt) as any, () => ctx.activePublicKeyHex)

    const real = ctx.activePublicKeyHex
    await p.queryDirect([r.url], { kinds: [1] })
    await handleDuressActivate(ctx as any, { personaName: 'anonymous' })
    const duress = ctx.activePublicKeyHex
    await p.queryDirect([r.url], { kinds: [1] })
    await settle()

    expect(duress).not.toBe(real)
    expect(r.connections).toHaveLength(2)
    expect(r.connections[0].auths).toEqual([real])
    expect(r.connections[1].auths).toEqual([duress])
  })
})
