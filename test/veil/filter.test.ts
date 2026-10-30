import { describe, it, expect } from 'vitest'
import { filterByTrust } from '../../src/veil/filter.js'
import type { ScoredEvent } from '../../src/veil/scoring.js'

function scored(pubkey: string, score: number): ScoredEvent {
  return {
    id: `e-${pubkey}`,
    pubkey,
    kind: 1,
    content: `post by ${pubkey}`,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    sig: 'mock',
    _trustScore: score,
  }
}

describe('filterByTrust', () => {
  const events = [
    scored('trusted', 50),
    scored('marginal', 1),
    scored('unknown', 0),
  ]

  it('strict mode hides events below threshold', () => {
    const result = filterByTrust(events, { mode: 'strict', threshold: 1 })
    expect(result).toHaveLength(2)
    expect(result.map((e: ScoredEvent) => e.pubkey)).toEqual(['trusted', 'marginal'])
  })

  it('annotate mode returns all events with scores', () => {
    const result = filterByTrust(events, { mode: 'annotate', threshold: 1 })
    expect(result).toHaveLength(3)
    expect(result.every((e: ScoredEvent) => '_trustScore' in e)).toBe(true)
  })

  it('off mode returns all events unchanged', () => {
    const result = filterByTrust(events, { mode: 'off' })
    expect(result).toHaveLength(3)
  })

  it('defaults to strict mode with threshold 1', () => {
    const result = filterByTrust(events)
    expect(result).toHaveLength(2)
  })
})

describe('filterByTrust with trusted authors', () => {
  const events = [
    scored('followed', 0),
    scored('endorsed', 3),
    scored('stranger', 0),
  ]
  const trustedAuthors = new Set(['followed'])

  it('strict mode passes a trusted author with score 0', () => {
    const result = filterByTrust(events, { mode: 'strict', threshold: 1, trustedAuthors })
    expect(result.map((e: ScoredEvent) => e.pubkey)).toEqual(['followed', 'endorsed'])
  })

  it('strict mode still hides strangers when no trusted authors are given', () => {
    const result = filterByTrust(events, { mode: 'strict', threshold: 1 })
    expect(result.map((e: ScoredEvent) => e.pubkey)).toEqual(['endorsed'])
  })

  it('annotate and off modes are unchanged', () => {
    expect(filterByTrust(events, { mode: 'annotate', trustedAuthors })).toHaveLength(3)
    expect(filterByTrust(events, { mode: 'off', trustedAuthors })).toHaveLength(3)
  })
})
