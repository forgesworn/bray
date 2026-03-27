import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeEvent } from 'nostr-tools/pure'
import { SignetAssessor } from '../../src/signet/assessor.js'

// Real key pairs so event signatures verify
const ALICE_SK = Buffer.from('a'.padEnd(64, 'a'), 'hex')
const ALICE = '6a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb3'
const BOB = '68680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5'

function mockPool(overrides: Record<string, any> = {}) {
  return {
    query: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function makeCredentialEvent(subject: string, tier: number, _attestorSk: Uint8Array = ALICE_SK): any {
  return finalizeEvent({
    created_at: Math.floor(Date.now() / 1000),
    kind: 31000,
    tags: [
      ['d', `credential:${subject}`],
      ['p', subject],
      ['type', 'credential'],
      ['tier', String(tier)],
      ['verification-type', tier >= 3 ? 'professional' : 'self'],
      ['L', 'signet'],
    ],
    content: '',
  }, _attestorSk)
}

describe('SignetAssessor', () => {
  let pool: any

  beforeEach(() => {
    pool = mockPool()
  })

  it('returns null tier when no credentials found', async () => {
    const assessor = new SignetAssessor(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await assessor.assess(ALICE, ALICE)
    expect(result.tier).toBeNull()
    expect(result.score).toBe(0)
    expect(result.credentials).toBe(0)
  })

  it('returns tier and score when credentials exist', async () => {
    const credential = makeCredentialEvent(BOB, 3, ALICE_SK)
    pool.query.mockResolvedValue([credential])
    const assessor = new SignetAssessor(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await assessor.assess(ALICE, BOB)
    expect(result.tier).toBe(3)
    expect(result.score).toBeGreaterThan(0)
    expect(result.credentials).toBe(1)
  })

  it('caches results and does not re-query within TTL', async () => {
    const assessor = new SignetAssessor(pool, { ttl: 60_000, maxEntries: 100 })
    await assessor.assess(ALICE, BOB)
    await assessor.assess(ALICE, BOB)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('detects expired credentials', async () => {
    const credential = makeCredentialEvent(BOB, 2, ALICE_SK)
    credential.tags.push(['expiration', String(Math.floor(Date.now() / 1000) - 3600)])
    pool.query.mockResolvedValue([credential])
    const assessor = new SignetAssessor(pool, { ttl: 60_000, maxEntries: 100 })
    const result = await assessor.assess(ALICE, BOB)
    expect(result.expired).toBe(true)
  })
})
