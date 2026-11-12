import { describe, it, expect, vi, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { RelayPool, isNormalRequestEnd } from '../src/relay-pool.js'
import type { PoolLike, SubscriptionClose } from '../src/relay-pool.js'

const NPUB = 'npub1abc111111111111111111111111111111111111111111111111abcdef01'

/** A relay that ends every REQ the way `answer` says. */
async function relay(answer: 'eose' | 'refuse') {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => wss.once('listening', resolve))
  wss.on('connection', ws => {
    ws.on('message', data => {
      const msg = JSON.parse(String(data))
      if (msg[0] !== 'REQ') return
      ws.send(JSON.stringify(answer === 'eose' ? ['EOSE', msg[1]] : ['CLOSED', msg[1], 'auth-required: sign in first']))
    })
  })
  const { port } = wss.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<'timed out'>(resolve => setTimeout(() => resolve('timed out'), ms))])

describe('RelayPool queries report why each relay ended the REQ', () => {
  const cleanups: Array<() => unknown> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  it('passes on a refusal, explained as for a publish', async () => {
    const r = await relay('refuse')
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true })
    cleanups.push(r.close, () => pool.close())
    const ends: SubscriptionClose[][] = []
    const events = await pool.queryDirect([r.url], { kinds: [1] }, { onclose: reasons => ends.push(reasons) })

    expect(events).toEqual([])
    expect(ends).toHaveLength(1)
    expect(ends[0]).toHaveLength(1)
    expect(ends[0][0].reason).toContain('auth-required: sign in first')
    expect(ends[0][0].reason).toContain('NOSTR_AUTH=1')
    expect(isNormalRequestEnd(ends[0][0].reason)).toBe(false)
  })

  it('reports an ordinary end as normal', async () => {
    const r = await relay('eose')
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true })
    cleanups.push(r.close, () => pool.close())
    const ends: SubscriptionClose[][] = []
    await pool.queryDirect([r.url], { kinds: [1] }, { onclose: reasons => ends.push(reasons) })

    expect(ends).toHaveLength(1)
    expect(ends[0].every(({ reason }) => isNormalRequestEnd(reason))).toBe(true)
  })

  it('answers a query to no relays at once (querySync never settles on an empty list)', async () => {
    const inner = {
      publish: vi.fn(),
      querySync: vi.fn(() => new Promise<never>(() => {})),
      destroy: vi.fn(),
    } as unknown as PoolLike
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: [] }, inner)
    cleanups.push(() => pool.close())

    expect(await within(500, pool.query(NPUB, { kinds: [10002] }))).toEqual([])
    expect(await within(500, pool.queryDirect([], { kinds: [1] }))).toEqual([])
    expect(inner.querySync).not.toHaveBeenCalled()
  })
})
