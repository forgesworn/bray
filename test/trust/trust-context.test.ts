import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TrustContext, computeCompositeLevel } from '../../src/trust-context.js'

const ALICE = 'a'.padEnd(64, 'a')
const BOB = 'b'.padEnd(64, 'b')

describe('computeCompositeLevel', () => {
  it('returns unknown when no signals', () => {
    expect(computeCompositeLevel(null, -1, [])).toBe('unknown')
  })

  it('returns trusted when verified + close + in vault', () => {
    expect(computeCompositeLevel(3, 2, ['friends'])).toBe('trusted')
  })

  it('returns known when close but not verified', () => {
    expect(computeCompositeLevel(null, 1, [])).toBe('known')
  })

  it('returns known when in vault but not verified', () => {
    expect(computeCompositeLevel(null, -1, ['family'])).toBe('known')
  })

  it('returns verified-stranger when verified but distant', () => {
    expect(computeCompositeLevel(3, -1, [])).toBe('verified-stranger')
  })

  it('returns stranger when within 3 hops but unverified and no vault', () => {
    expect(computeCompositeLevel(null, 3, [])).toBe('stranger')
  })
})

describe('TrustContext', () => {
  function mockCtx() {
    return {
      activeNpub: 'npub1test',
      activePublicKeyHex: ALICE,
      activePrivateKey: new Uint8Array(32),
    }
  }

  function mockPool() {
    return {
      query: vi.fn().mockResolvedValue([]),
      queryDirect: vi.fn().mockResolvedValue([]),
      publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
      getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
      reconfigure: vi.fn(),
      checkSharedRelays: vi.fn().mockReturnValue([]),
    }
  }

  it('constructs without error', () => {
    const ctx = mockCtx()
    const pool = mockPool()
    const trust = new TrustContext(ctx as any, pool as any, {
      cacheTtl: 60_000,
      cacheMax: 100,
      trustMode: 'annotate',
    })
    expect(trust).toBeDefined()
    expect(trust.mode).toBe('annotate')
  })

  it('assess returns a complete TrustAssessment', async () => {
    const ctx = mockCtx()
    const pool = mockPool()
    const trust = new TrustContext(ctx as any, pool as any, {
      cacheTtl: 60_000,
      cacheMax: 100,
      trustMode: 'annotate',
    })

    const result = await trust.assess(BOB)
    expect(result.pubkey).toBe(BOB)
    expect(result.verification).toBeDefined()
    expect(result.proximity).toBeDefined()
    expect(result.access).toBeDefined()
    expect(result.composite).toBeDefined()
    expect(result.composite.level).toBe('unknown')
  })
  it('passes untrusted Veil counts through to proximity', async () => {
    const ctx = mockCtx()
    const pool = mockPool()
    const stranger = 'f'.repeat(64)
    pool.query.mockImplementation(async (_npub: string, filter: any) => {
      if (filter.kinds?.includes(30382)) {
        return [{
          id: '1'.repeat(64), pubkey: stranger, created_at: 1, kind: 30382,
          tags: [['d', BOB], ['p', stranger]], content: '', sig: 'f'.repeat(128),
        }]
      }
      return []
    })
    const trust = new TrustContext(ctx as any, pool as any, {
      cacheTtl: 60_000,
      cacheMax: 100,
      trustMode: 'annotate',
    })

    const result = await trust.assess(BOB)
    expect(result.proximity.endorsements).toBe(0)
    expect(result.proximity.untrustedEndorsements).toBe(1)
    expect(result.proximity.untrustedRingEndorsements).toBe(0)
    expect(result.proximity.wotScore).toBe(0)
  })

  it('counts an endorsement from a configured trusted publisher', async () => {
    const ctx = mockCtx()
    const pool = mockPool()
    const publisher = 'f'.repeat(64)
    pool.query.mockImplementation(async (_npub: string, filter: any) => {
      if (filter.kinds?.includes(30382)) {
        return [{
          id: '1'.repeat(64), pubkey: publisher, created_at: 1, kind: 30382,
          tags: [['d', BOB], ['p', publisher]], content: '', sig: 'f'.repeat(128),
        }]
      }
      return []
    })
    const trust = new TrustContext(ctx as any, pool as any, {
      cacheTtl: 60_000,
      cacheMax: 100,
      trustMode: 'annotate',
      veilTrustedPublishers: [publisher],
    })

    const result = await trust.assess(BOB)
    expect(result.proximity.endorsements).toBe(1)
    expect(result.proximity.untrustedEndorsements).toBe(0)
    expect(result.proximity.wotScore).toBe(1)
  })

  it('reports zero untrusted counts when trust is off', async () => {
    const trust = new TrustContext(mockCtx() as any, mockPool() as any, {
      cacheTtl: 60_000,
      cacheMax: 100,
      trustMode: 'off',
    })
    const result = await trust.assess(BOB)
    expect(result.proximity.untrustedEndorsements).toBe(0)
    expect(result.proximity.untrustedRingEndorsements).toBe(0)
  })
})
