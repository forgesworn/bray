import { describe, it, expect } from 'vitest'
import { minePow, getPow, MAX_POW_DIFFICULTY } from '../../src/event/pow.js'
import { getEventHash } from 'nostr-tools/pure'

const PUBKEY = 'aa'.repeat(32)

function template(overrides: Partial<any> = {}) {
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [] as string[][],
    content: 'gm nostr',
    ...overrides,
  }
}

describe('minePow', () => {
  it('reaches the requested difficulty', () => {
    const result = minePow(template(), { difficulty: 8, pubkey: PUBKEY })
    expect(result.difficulty).toBeGreaterThanOrEqual(8)
    expect(result.target).toBe(8)
  })

  it('produces a template whose hash actually has the leading zero bits', () => {
    const result = minePow(template(), { difficulty: 10, pubkey: PUBKEY })
    const id = getEventHash({ ...result.template, pubkey: PUBKEY } as any)
    expect(getPow(id)).toBeGreaterThanOrEqual(10)
  })

  it('adds a nonce tag carrying the counter and the target', () => {
    const result = minePow(template(), { difficulty: 6, pubkey: PUBKEY })
    const nonce = result.template.tags.find(t => t[0] === 'nonce')
    expect(nonce).toBeDefined()
    expect(nonce![2]).toBe('6')
    expect(Number(nonce![1])).toBeGreaterThan(0)
  })

  it('preserves existing tags', () => {
    const result = minePow(template({ tags: [['t', 'nostr'], ['d', 'x']] }), {
      difficulty: 4,
      pubkey: PUBKEY,
    })
    expect(result.template.tags).toContainEqual(['t', 'nostr'])
    expect(result.template.tags).toContainEqual(['d', 'x'])
  })

  it('does not mutate the caller template', () => {
    const input = template({ tags: [['t', 'nostr']] })
    minePow(input, { difficulty: 6, pubkey: PUBKEY })
    expect(input.tags).toEqual([['t', 'nostr']])
  })

  it('replaces a stale nonce tag rather than appending a second one', () => {
    const input = template({ tags: [['nonce', '99', '99']] })
    const result = minePow(input, { difficulty: 4, pubkey: PUBKEY })
    const nonces = result.template.tags.filter(t => t[0] === 'nonce')
    expect(nonces).toHaveLength(1)
    expect(nonces[0][2]).toBe('4')
  })

  it('preserves kind and content', () => {
    const result = minePow(template({ kind: 30023, content: 'body' }), {
      difficulty: 4,
      pubkey: PUBKEY,
    })
    expect(result.template.kind).toBe(30023)
    expect(result.template.content).toBe('body')
  })

  it('reports iterations and elapsed time', () => {
    const result = minePow(template(), { difficulty: 8, pubkey: PUBKEY })
    expect(result.iterations).toBeGreaterThan(0)
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it('rejects a non-positive difficulty', () => {
    expect(() => minePow(template(), { difficulty: 0, pubkey: PUBKEY })).toThrow(/positive integer/)
    expect(() => minePow(template(), { difficulty: -1, pubkey: PUBKEY })).toThrow(/positive integer/)
  })

  it('rejects a fractional difficulty', () => {
    expect(() => minePow(template(), { difficulty: 4.5, pubkey: PUBKEY })).toThrow(/positive integer/)
  })

  it('rejects a difficulty above the ceiling', () => {
    expect(() => minePow(template(), { difficulty: MAX_POW_DIFFICULTY + 1, pubkey: PUBKEY }))
      .toThrow(/exceeds the maximum/)
  })

  it('rejects a malformed pubkey', () => {
    expect(() => minePow(template(), { difficulty: 4, pubkey: 'nope' })).toThrow(/64-char hex/)
  })

  it('gives up at the deadline instead of running forever', () => {
    // 32 bits is far beyond what 50ms can find
    expect(() => minePow(template(), { difficulty: 32, pubkey: PUBKEY, timeoutMs: 50 }))
      .toThrow(/gave up after 50ms/)
  })
})
