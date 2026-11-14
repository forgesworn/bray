import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../../src/relay-pool.js'
import { handleRelayAuth } from '../../src/relay/auth.js'
import { registerRelayTools } from '../../src/relay/tools.js'
import { BunkerContext } from '../../src/bunker-context.js'
import { HeartwoodContext } from '../../src/heartwood-context.js'

// relay-auth against an identity that signs through a NIP-46 remote signer: a
// hardware signer over a relay takes about 2 s per signature, longer on first
// use, so the AUTH step must not run on the 5 s that connecting and the
// challenge get. The relay here is a double (a connection that already has its
// challenge), so the clock decides everything and fake timers drive it.

const RELAY = 'wss://relay.example.com'
const sk = generateSecretKey()
const pk = getPublicKey(sk)

/** A signer that answers after `ms` (never, if Infinity), as a remote one does. */
function signerAnsweringAfter(ms: number) {
  return (evt: any) => new Promise<any>(resolve => {
    if (ms !== Infinity) setTimeout(() => resolve(finalizeEvent(evt, sk)), ms)
  })
}

/**
 * A relay double that behaves as nostr-tools 2.24.1's AbstractRelay.auth does:
 * it has its challenge, reuses a pending attempt, catches an error from the
 * signer, logs it and never settles, and once signed waits `publishTimeout`
 * (4.4 s) for the OK before rejecting with 'auth timed out'. `okMs` is when
 * the relay answers (never, if Infinity); `refuse` makes that answer a refusal.
 */
function relayDouble(opts: { okMs?: number; refuse?: string } = {}) {
  return {
    url: 'wss://relay.example.com',
    challenge: 'challenge-1',
    publishTimeout: 4_400,
    authPromise: undefined as Promise<string> | undefined,
    subscribe: () => ({ close() {} }),
    auth(sign: (evt: any) => Promise<any>) {
      if (this.authPromise) return this.authPromise
      this.authPromise = new Promise<string>(async (resolve, reject) => {
        try {
          await sign({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', RELAY], ['challenge', 'challenge-1']], content: '' })
          const wait = setTimeout(() => reject(new Error('auth timed out')), this.publishTimeout)
          if (opts.okMs === Infinity) return
          setTimeout(() => {
            clearTimeout(wait)
            if (opts.refuse) reject(new Error(opts.refuse))
            else resolve('ok')
          }, opts.okMs ?? 0)
        } catch {
          // nostr-tools: console.warn('subscribe auth function failed:', err), and nothing more
        }
      })
      return this.authPromise
    },
  }
}

function setup(signer: (evt: any) => Promise<any>, relay = relayDouble(), remote = true) {
  const forget = vi.fn()
  const double = { ensureRelay: async () => relay, forget, publish: () => [], querySync: async () => [], destroy() {} }
  const pool = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true, authMode: 'off' }, double as any)
  pool.setAuthSigner(signer, () => pk)
  const ctx = { activePublicKeyHex: pk, activeNpub: 'npub1test', getSigningFunction: () => signer, ...(remote ? { remoteSigner: true } : {}) } as any
  return { pool, ctx, forget }
}

/** Start the call, advance the clock `ms`, and report whether it has finished. */
async function run<T>(start: Promise<T>, ms: number) {
  let result: T | undefined
  let done = false
  void start.then(r => { result = r; done = true })
  await vi.advanceTimersByTimeAsync(ms)
  return { done, result }
}

describe('relay-auth with a remote signer', () => {
  beforeAll(async () => { await import('nostr-tools/utils') })
  afterEach(() => { vi.useRealTimers() })

  it('succeeds when the signer answers after more than 5 s', async () => {
    vi.useFakeTimers()
    const { pool, ctx } = setup(signerAnsweringAfter(8_000))
    const out = await run(handleRelayAuth(ctx, RELAY, pool), 8_100)
    expect(out.done).toBe(true)
    expect(out.result).toEqual({ authenticated: true, relay: RELAY, pubkey: pk })
  })

  it('still fails a local-key-speed budget for an identity that is not remote', async () => {
    vi.useFakeTimers()
    const { pool, ctx, forget } = setup(signerAnsweringAfter(8_000), relayDouble(), false)
    const out = await run(handleRelayAuth(ctx, RELAY, pool), 5_100)
    expect(out.done).toBe(true)
    expect(out.result).toMatchObject({ authenticated: false })
    expect(out.result!.error).toContain('no signature within 5000 ms')
    expect(forget).toHaveBeenCalled()
  })

  it('fails a signer that never answers, with a clear message, at the larger bound and not before', async () => {
    vi.useFakeTimers()
    const { pool, ctx, forget } = setup(signerAnsweringAfter(Infinity))
    const start = handleRelayAuth(ctx, RELAY, pool)
    const early = await run(start, 59_900)
    expect(early.done).toBe(false)
    const late = await run(start, 200)
    expect(late.done).toBe(true)
    expect(late.result).toMatchObject({ authenticated: false, relay: RELAY })
    expect(late.result!.error).toContain('AUTH timed out')
    expect(late.result!.error).toContain('no signature within 60000 ms')
    expect(late.result!.error).toContain('remote signer')
    expect(forget).toHaveBeenCalled()
  })

  it('gives the relay nostr-tools\' 4.4 s for the OK once the signature is in, and names that step', async () => {
    vi.useFakeTimers()
    // 30 s of signing, then a relay that never answers: the OK wait starts at the signature.
    const { pool, ctx } = setup(signerAnsweringAfter(30_000), relayDouble({ okMs: Infinity }))
    const start = handleRelayAuth(ctx, RELAY, pool)
    const signing = await run(start, 30_000 + 4_300)
    expect(signing.done).toBe(false)
    const out = await run(start, 200)
    expect(out.done).toBe(true)
    expect(out.result!.error).toBe('AUTH timed out: the relay did not answer the signed AUTH within 4400 ms')
  })

  it('accepts a slow OK within its own budget after a slow signature', async () => {
    vi.useFakeTimers()
    const { pool, ctx } = setup(signerAnsweringAfter(20_000), relayDouble({ okMs: 4_000 }))
    const out = await run(handleRelayAuth(ctx, RELAY, pool), 24_100)
    expect(out.result).toMatchObject({ authenticated: true })
  })

  it('takes an explicit timeout for every step, a remote signer included', async () => {
    vi.useFakeTimers()
    const { pool, ctx } = setup(signerAnsweringAfter(8_000))
    const short = await run(handleRelayAuth(ctx, RELAY, pool, { timeoutMs: 2_000 }), 2_100)
    expect(short.done).toBe(true)
    expect(short.result!.error).toContain('no signature within 2000 ms')

    const { pool: pool2, ctx: ctx2 } = setup(signerAnsweringAfter(8_000))
    const long = await run(handleRelayAuth(ctx2, RELAY, pool2, { timeoutMs: 10_000 }), 8_100)
    expect(long.result).toMatchObject({ authenticated: true })
  })

  it('reports a signer that refuses as not signed, at once, though nostr-tools drops the error', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { pool, ctx, forget } = setup(async () => { throw new Error('user denied the request') })
      const out = await run(handleRelayAuth(ctx, RELAY, pool), 10)
      expect(out.done).toBe(true)
      expect(out.result).toEqual({ authenticated: false, relay: RELAY, error: 'AUTH not signed: user denied the request' })
      expect(forget).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('reports a relay that refuses the signed AUTH as a rejection, not as unsigned', async () => {
    vi.useFakeTimers()
    const { pool, ctx } = setup(signerAnsweringAfter(2_000), relayDouble({ okMs: 100, refuse: 'restricted: not a member' }))
    const out = await run(handleRelayAuth(ctx, RELAY, pool), 2_200)
    expect(out.done).toBe(true)
    expect(out.result!.error).toBe('AUTH rejected: restricted: not a member')
  })

  it('leaves no timer behind once it has finished', async () => {
    vi.useFakeTimers()
    const { pool, ctx } = setup(signerAnsweringAfter(1_000))
    await run(handleRelayAuth(ctx, RELAY, pool), 1_100)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('which identities count as remote signers', () => {
  it('marks a bunker context and a Heartwood context, and not a local key', () => {
    expect(Object.create(BunkerContext.prototype).remoteSigner).toBe(true)
    expect(Object.create(HeartwoodContext.prototype).remoteSigner).toBe(true)
  })
})

describe('the relay-auth tool timeout_ms', () => {
  async function connect(signer: (evt: any) => Promise<any>) {
    const { pool, ctx } = setup(signer, relayDouble(), false)
    const server = new McpServer({ name: 'relay-auth-remote-test', version: '0.0.0' }, {})
    registerRelayTools(server, { ctx, pool, nip65: {} as any, walletsFile: '/nonexistent' } as any)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'relay-auth-remote-test-client', version: '0.0.0' })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    return { client, pool }
  }
  const text = (res: unknown) => (res as { content: Array<{ text: string }> }).content[0].text

  it('is passed to the AUTH steps', async () => {
    const { client, pool } = await connect(signerAnsweringAfter(Infinity))
    try {
      const started = Date.now()
      const res = JSON.parse(text(await client.callTool({ name: 'relay-auth', arguments: { relay: RELAY, timeout_ms: 1_000 } })))
      expect(res.authenticated).toBe(false)
      expect(res.error).toContain('no signature within 1000 ms')
      expect(Date.now() - started).toBeLessThan(4_000)
    } finally {
      await client.close()
      pool.close()
    }
  })

  it('is bounded to 1000-120000 ms', async () => {
    const { client, pool } = await connect(signerAnsweringAfter(0))
    try {
      for (const timeout_ms of [999, 120_001, 1.5]) {
        const res = await client.callTool({ name: 'relay-auth', arguments: { relay: RELAY, timeout_ms } }).catch(e => e)
        const message = res instanceof Error ? res.message : text(res)
        expect(message).toMatch(/timeout_ms|too_small|too_big|integer|Invalid/i)
      }
      const ok = JSON.parse(text(await client.callTool({ name: 'relay-auth', arguments: { relay: RELAY, timeout_ms: 120_000 } })))
      expect(ok.authenticated).toBe(true)
    } finally {
      await client.close()
      pool.close()
    }
  })
})
