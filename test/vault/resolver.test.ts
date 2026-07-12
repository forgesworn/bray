import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VaultResolver } from '../../src/vault/resolver.js'

const ALICE = 'a'.padEnd(64, 'a')
const BOB = 'b'.padEnd(64, 'b')
const ALICE_HEX_KEY = '1'.padEnd(64, '1')

function mockPool(overrides: Record<string, any> = {}) {
  return {
    query: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function makeVaultConfigEvent(author: string, config: Record<string, any>): any {
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: author,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags: [['d', 'dominion:vault-config']],
    content: JSON.stringify(config),
    sig: 'f'.padEnd(128, 'f'),
  }
}

describe('VaultResolver', () => {
  let pool: any

  beforeEach(() => {
    pool = mockPool()
  })

  it('returns empty access when no vault events found', async () => {
    const resolver = new VaultResolver(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await resolver.resolve(ALICE, BOB, ALICE_HEX_KEY)
    expect(result.vaultTiers).toEqual([])
    expect(result.theirVaultTiers).toEqual([])
    expect(result.canDecrypt).toBe(false)
    expect(result.revoked).toBe(false)
  })

  it('detects vault tier membership from config', async () => {
    const config = {
      tiers: { friends: [ALICE], family: [] },
      individualGrants: [],
      revokedPubkeys: [],
    }
    pool.query.mockResolvedValueOnce([makeVaultConfigEvent(BOB, config)])

    const resolver = new VaultResolver(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await resolver.resolve(ALICE, BOB, ALICE_HEX_KEY)
    expect(result.theirVaultTiers).toContain('friends')
  })

  it('detects revoked status', async () => {
    const config = {
      tiers: { friends: [] },
      individualGrants: [],
      revokedPubkeys: [ALICE],
    }
    pool.query.mockResolvedValueOnce([makeVaultConfigEvent(BOB, config)])

    const resolver = new VaultResolver(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await resolver.resolve(ALICE, BOB, ALICE_HEX_KEY)
    expect(result.revoked).toBe(true)
  })

  it('caches results within TTL', async () => {
    const resolver = new VaultResolver(pool, { ttl: 60_000, maxEntries: 100 })
    await resolver.resolve(ALICE, BOB, ALICE_HEX_KEY)
    await resolver.resolve(ALICE, BOB, ALICE_HEX_KEY)
    expect(pool.query).toHaveBeenCalledTimes(2) // first call: their config + our config
  })
})
