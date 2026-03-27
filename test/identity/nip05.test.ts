import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleNip05Lookup, handleNip05Verify, handleNip05Relays, verifyNip05 } from '../../src/identity/nip05.js'

const VALID_RESPONSE = JSON.stringify({
  names: { bob: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1' },
  relays: { abc123def456abc123def456abc123def456abc123def456abc123def456abc1: ['wss://relay.example.com'] },
})

const NO_RELAYS_RESPONSE = JSON.stringify({
  names: { alice: 'def456abc123def456abc123def456abc123def456abc123def456abc123def4' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleNip05Lookup', () => {
  it('resolves identifier to pubkey and relay hints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Lookup('bob@example.com')
    expect(result.pubkey).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abc1')
    expect(result.relays).toEqual(['wss://relay.example.com'])
    expect(result.identifier).toBe('bob@example.com')
  })

  it('returns no relays when not present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => NO_RELAYS_RESPONSE }))
    const result = await handleNip05Lookup('alice@example.com')
    expect(result.pubkey).toBe('def456abc123def456abc123def456abc123def456abc123def456abc123def4')
    expect(result.relays).toBeUndefined()
  })

  it('throws on invalid identifier format', async () => {
    await expect(handleNip05Lookup('noatsign')).rejects.toThrow(/user@domain/)
  })

  it('throws when name not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => JSON.stringify({ names: {} }) }))
    await expect(handleNip05Lookup('ghost@example.com')).rejects.toThrow(/No pubkey/)
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
    await expect(handleNip05Lookup('bob@gone.com')).rejects.toThrow(/404/)
  })

  it('throws on oversized response', async () => {
    const big = 'x'.repeat(256 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => big }))
    await expect(handleNip05Lookup('bob@big.com')).rejects.toThrow(/too large/)
  })

  it('rejects private network URLs', async () => {
    await expect(handleNip05Lookup('bob@127.0.0.1')).rejects.toThrow(/private/)
  })
})

describe('handleNip05Verify', () => {
  it('returns verified true when pubkey matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Verify(
      'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      'bob@example.com',
    )
    expect(result.verified).toBe(true)
  })

  it('returns verified false when pubkey does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Verify('wrong_pubkey_value_here_padded_to_64_chars_0000000000000000000000', 'bob@example.com')
    expect(result.verified).toBe(false)
  })

  it('returns verified false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await handleNip05Verify('abc123', 'bob@offline.com')
    expect(result.verified).toBe(false)
  })
})

describe('handleNip05Relays', () => {
  it('returns relay map when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Relays('bob@example.com')
    expect(result.relays).toHaveProperty('abc123def456abc123def456abc123def456abc123def456abc123def456abc1')
  })

  it('returns empty object when no relays field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => NO_RELAYS_RESPONSE }))
    const result = await handleNip05Relays('alice@example.com')
    expect(result.relays).toEqual({})
  })
})

describe('verifyNip05 (shared helper)', () => {
  it('returns true for matching pubkey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const ok = await verifyNip05('abc123def456abc123def456abc123def456abc123def456abc123def456abc1', 'bob@example.com')
    expect(ok).toBe(true)
  })

  it('returns false for non-matching pubkey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const ok = await verifyNip05('0000000000000000000000000000000000000000000000000000000000000000', 'bob@example.com')
    expect(ok).toBe(false)
  })
})
