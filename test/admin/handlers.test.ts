import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  handleAdminCall,
  resolveAdminMethod,
  coerceAdminParams,
  ADMIN_METHOD_ALIASES,
} from '../../src/admin/handlers.js'
import type { SigningContext } from '../../src/signing-context.js'

/** Minimal signing context — the NIP-98 event content is not under test here. */
const ctx = {
  getSigningFunction: () => async (t: any) => ({
    ...t,
    id: '00'.repeat(32),
    pubkey: '11'.repeat(32),
    sig: '22'.repeat(64),
  }),
} as unknown as SigningContext

function mockRelay() {
  const calls: Array<{ url: string; body: any }> = []
  vi.stubGlobal('fetch', async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => ({ result: true }),
      text: async () => '',
    } as any
  })
  return calls
}

afterEach(() => { vi.unstubAllGlobals() })

describe('resolveAdminMethod', () => {
  it('maps the legacy bankind alias to the NIP-86 name', () => {
    expect(resolveAdminMethod('bankind')).toBe('disallowkind')
  })

  it('maps listbannedkinds to listdisallowedkinds', () => {
    expect(resolveAdminMethod('listbannedkinds')).toBe('listdisallowedkinds')
  })

  it('passes spec method names through unchanged', () => {
    for (const m of ['allowkind', 'disallowkind', 'supportedmethods', 'grantadmin']) {
      expect(resolveAdminMethod(m)).toBe(m)
    }
  })

  it('only aliases the two legacy spellings', () => {
    expect(Object.keys(ADMIN_METHOD_ALIASES).sort()).toEqual(['bankind', 'listbannedkinds'])
  })
})

describe('coerceAdminParams', () => {
  it('coerces the kind argument to a number', () => {
    expect(coerceAdminParams('disallowkind', ['1'])).toEqual([1])
    expect(coerceAdminParams('allowkind', ['30023'])).toEqual([30023])
  })

  it('leaves an all-digit pubkey as a string', () => {
    const numericPubkey = '1'.repeat(64)
    expect(coerceAdminParams('banpubkey', [numericPubkey])).toEqual([numericPubkey])
  })

  it('coerces only the order field of createrole', () => {
    expect(coerceAdminParams('createrole', ['mod', 'Moderator', 'desc', '#ff0000', '3']))
      .toEqual(['mod', 'Moderator', 'desc', '#ff0000', 3])
  })

  it('rejects a non-numeric kind', () => {
    expect(() => coerceAdminParams('allowkind', ['nope'])).toThrow(/must be a number/)
  })

  it('passes through methods with no numeric parameters', () => {
    expect(coerceAdminParams('listblockedips', [])).toEqual([])
  })
})

describe('handleAdminCall', () => {
  it('sends disallowkind on the wire when given the bankind alias', async () => {
    const calls = mockRelay()
    const result = await handleAdminCall(ctx, {
      relay: 'https://relay.example.com',
      method: 'bankind' as any,
      params: ['1'],
    })

    expect(calls[0].body.method).toBe('disallowkind')
    expect(calls[0].body.params).toEqual([1])
    expect(result.method).toBe('disallowkind')
  })

  it('strips a trailing slash from the relay URL', async () => {
    const calls = mockRelay()
    await handleAdminCall(ctx, {
      relay: 'https://relay.example.com/',
      method: 'supportedmethods',
    })
    expect(calls[0].url).toBe('https://relay.example.com')
    expect(calls[0].body.params).toEqual([])
  })

  it('surfaces a relay-reported error', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ error: 'not authorised' }),
      text: async () => '',
    } as any))

    await expect(handleAdminCall(ctx, {
      relay: 'https://relay.example.com',
      method: 'grantadmin',
      params: ['aa'.repeat(32)],
    })).rejects.toThrow(/not authorised/)
  })
})
