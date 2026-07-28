import { describe, it, expect, vi } from 'vitest'
import { RelayPool } from '../src/relay-pool.js'
import type { PoolLike, AuthSigner } from '../src/relay-pool.js'
import { parseAuthMode } from '../src/config.js'

const NPUB = 'npub1abc111111111111111111111111111111111111111111111111abcdef01'
const RELAYS = ['wss://relay.example.com']

function mockPool(overrides?: Partial<PoolLike>): PoolLike & { automatic?: unknown } {
  const p: any = {
    publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
    querySync: vi.fn().mockResolvedValue([]),
    subscribeMany: vi.fn().mockReturnValue({ close: vi.fn() }),
    setAutomaticAuth: vi.fn(function (this: any, s: unknown) { p.automatic = s }),
    destroy: vi.fn(),
    ...overrides,
  }
  return p
}

const signer: AuthSigner = async evt => ({
  ...evt,
  id: '00'.repeat(32),
  pubkey: '11'.repeat(32),
  sig: '22'.repeat(64),
}) as any

function makePool(authMode: 'off' | 'on-demand' | 'eager', inner = mockPool()) {
  const pool = new RelayPool(
    { allowClearnet: true, defaultRelays: RELAYS, authMode },
    inner,
  )
  return { pool, inner }
}

describe('parseAuthMode', () => {
  it('defaults to off when unset or empty', () => {
    expect(parseAuthMode(undefined)).toBe('off')
    expect(parseAuthMode('')).toBe('off')
  })

  it('accepts the on-demand spellings', () => {
    for (const v of ['1', 'on', 'true', 'yes', 'on-demand', 'ONDEMAND']) {
      expect(parseAuthMode(v)).toBe('on-demand')
    }
  })

  it('accepts the eager spellings', () => {
    for (const v of ['2', 'eager', 'force', 'EAGER']) {
      expect(parseAuthMode(v)).toBe('eager')
    }
  })

  it('accepts explicit off', () => {
    for (const v of ['0', 'off', 'false', 'no']) expect(parseAuthMode(v)).toBe('off')
  })

  it('rejects an unrecognised value rather than silently disabling auth', () => {
    expect(() => parseAuthMode('yep')).toThrow(/Invalid NOSTR_AUTH/)
  })
})

describe('RelayPool NIP-42', () => {
  it('defaults to auth mode off', () => {
    const { pool } = makePool('off')
    expect(pool.getAuthMode()).toBe('off')
    pool.close()
  })

  it('passes no onauth when auth is off, even with a signer set', async () => {
    const { pool, inner } = makePool('off')
    pool.setAuthSigner(signer)
    await pool.query(NPUB, { kinds: [1] })
    expect(inner.querySync).toHaveBeenCalledWith(RELAYS, { kinds: [1] }, {})
    pool.close()
  })

  it('passes onauth on queries when on-demand and a signer is set', async () => {
    const { pool, inner } = makePool('on-demand')
    pool.setAuthSigner(signer)
    await pool.query(NPUB, { kinds: [1] })
    const params = (inner.querySync as any).mock.calls[0][2]
    expect(typeof params.onauth).toBe('function')
    pool.close()
  })

  it('passes onauth on publishes when on-demand', async () => {
    const { pool, inner } = makePool('on-demand')
    pool.setAuthSigner(signer)
    await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    const params = (inner.publish as any).mock.calls[0][2]
    expect(typeof params.onauth).toBe('function')
    pool.close()
  })

  it('passes onauth on subscriptions when on-demand', async () => {
    const { pool, inner } = makePool('on-demand')
    pool.setAuthSigner(signer)
    await pool.subscribe(RELAYS, { kinds: [1] }, () => {})
    const handlers = (inner.subscribeMany as any).mock.calls[0][2]
    expect(typeof handlers.onauth).toBe('function')
    pool.close()
  })

  it('omits onauth when on-demand but no signer was supplied', async () => {
    const { pool, inner } = makePool('on-demand')
    await pool.query(NPUB, { kinds: [1] })
    expect(inner.querySync).toHaveBeenCalledWith(RELAYS, { kinds: [1] }, {})
    pool.close()
  })

  it('installs the eager responder only in eager mode', async () => {
    const inner = mockPool()
    const { pool } = makePool('eager', inner)
    pool.setAuthSigner(signer)
    await pool.query(NPUB, { kinds: [1] })
    expect(inner.setAutomaticAuth).toHaveBeenCalled()
    expect((inner as any).automatic).toBeTypeOf('function')
    pool.close()
  })

  it('clears the eager responder when the signer is removed', async () => {
    const inner = mockPool()
    const { pool } = makePool('eager', inner)
    pool.setAuthSigner(signer)
    await pool.query(NPUB, { kinds: [1] })
    pool.setAuthSigner(undefined)
    await pool.query(NPUB, { kinds: [1] })
    expect((inner as any).automatic).toBeUndefined()
    pool.close()
  })

  it('records which relays were authenticated to', async () => {
    const { pool, inner } = makePool('on-demand')
    pool.setAuthSigner(signer)
    await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    const onauth = (inner.publish as any).mock.calls[0][2].onauth

    expect(pool.getAuthedRelays()).toEqual([])
    await onauth({
      kind: 22242,
      created_at: 0,
      content: '',
      tags: [['relay', 'wss://relay.example.com'], ['challenge', 'xyz']],
    })
    expect(pool.getAuthedRelays()).toEqual(['wss://relay.example.com'])
    pool.close()
  })

  it('switching signer clears the recorded auth history', async () => {
    const { pool, inner } = makePool('on-demand')
    pool.setAuthSigner(signer)
    await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    const onauth = (inner.publish as any).mock.calls[0][2].onauth
    await onauth({ kind: 22242, created_at: 0, content: '', tags: [['relay', 'wss://relay.example.com']] })
    expect(pool.getAuthedRelays()).toHaveLength(1)

    pool.setAuthSigner(signer)
    expect(pool.getAuthedRelays()).toEqual([])
    pool.close()
  })

  it('setAuthMode switches policy at runtime', async () => {
    const { pool, inner } = makePool('off')
    pool.setAuthSigner(signer)
    pool.setAuthMode('on-demand')
    await pool.query(NPUB, { kinds: [1] })
    expect((inner.querySync as any).mock.calls[0][2].onauth).toBeTypeOf('function')
    pool.close()
  })

  it('explains an auth-required publish failure when auth is off', async () => {
    const inner = mockPool({
      publish: vi.fn().mockReturnValue([Promise.reject(new Error('auth-required: need to authenticate'))]),
    })
    const { pool } = makePool('off', inner)
    const result = await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    expect(result.success).toBe(false)
    expect(result.errors[0]).toMatch(/NOSTR_AUTH=1/)
    pool.close()
  })

  it('says auth was attempted when it was, rather than blaming config', async () => {
    const inner = mockPool({
      publish: vi.fn().mockReturnValue([Promise.reject(new Error('auth-required: still no'))]),
    })
    const { pool } = makePool('on-demand', inner)
    pool.setAuthSigner(signer)
    const result = await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    expect(result.errors[0]).toMatch(/AUTH was attempted/)
    pool.close()
  })

  it('leaves unrelated publish errors untouched', async () => {
    const inner = mockPool({
      publish: vi.fn().mockReturnValue([Promise.reject(new Error('rate-limited: slow down'))]),
    })
    const { pool } = makePool('off', inner)
    const result = await pool.publishDirect(RELAYS, { id: 'a', kind: 1 } as any)
    expect(result.errors[0]).toBe('wss://relay.example.com: Error: rate-limited: slow down')
    pool.close()
  })

  it('does not crash when the injected pool has no setAutomaticAuth', async () => {
    const inner: PoolLike = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      querySync: vi.fn().mockResolvedValue([]),
      destroy: vi.fn(),
    }
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: RELAYS, authMode: 'eager' }, inner)
    pool.setAuthSigner(signer)
    await expect(pool.query(NPUB, { kinds: [1] })).resolves.toEqual([])
    pool.close()
  })
})
