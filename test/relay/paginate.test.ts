import { describe, it, expect, vi } from 'vitest'
import { paginateQuery, DEFAULT_MAX_PAGES } from '../../src/relay/handlers.js'
import type { Event as NostrEvent, Filter } from 'nostr-tools'

/** Build `n` events descending from `startTs`, one per second. */
function makeEvents(n: number, startTs: number, prefix = 'e'): NostrEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${startTs - i}`,
    pubkey: 'aa'.repeat(32),
    created_at: startTs - i,
    kind: 1,
    tags: [],
    content: `event ${i}`,
    sig: '00'.repeat(64),
  })) as NostrEvent[]
}

/**
 * Relay double: holds a fixed corpus and answers a filter the way a real relay
 * would, capping each response at `pageCap`.
 */
function fakeRelay(corpus: NostrEvent[], pageCap: number) {
  const sorted = [...corpus].sort((a, b) => b.created_at - a.created_at)
  const calls: Filter[] = []
  const run = async (filter: Filter): Promise<NostrEvent[]> => {
    calls.push({ ...filter })
    let out = sorted
    if (filter.until !== undefined) out = out.filter(e => e.created_at <= filter.until!)
    if (filter.since !== undefined) out = out.filter(e => e.created_at >= filter.since!)
    return out.slice(0, Math.min(pageCap, filter.limit ?? pageCap))
  }
  return { run, calls }
}

describe('paginateQuery', () => {
  it('collects the full limit across several pages', async () => {
    const { run, calls } = fakeRelay(makeEvents(250, 1_000_000), 100)
    const events = await paginateQuery(run, { kinds: [1], limit: 250 }, { intervalMs: 0, maxPages: 20 })
    expect(events).toHaveLength(250)
    expect(calls.length).toBeGreaterThan(1)
  })

  it('returns everything available when the corpus is smaller than the limit', async () => {
    const { run } = fakeRelay(makeEvents(30, 1_000_000), 100)
    const events = await paginateQuery(run, { kinds: [1], limit: 500 }, { intervalMs: 0, maxPages: 20 })
    expect(events).toHaveLength(30)
  })

  it('never returns duplicate ids', async () => {
    const { run } = fakeRelay(makeEvents(250, 1_000_000), 100)
    const events = await paginateQuery(run, { kinds: [1], limit: 250 }, { intervalMs: 0, maxPages: 20 })
    expect(new Set(events.map(e => e.id)).size).toBe(events.length)
  })

  it('walks until backwards on each page', async () => {
    const { run, calls } = fakeRelay(makeEvents(250, 1_000_000), 100)
    await paginateQuery(run, { kinds: [1], limit: 250 }, { intervalMs: 0, maxPages: 20 })
    const untils = calls.map(c => c.until).filter((u): u is number => u !== undefined)
    for (let i = 1; i < untils.length; i++) {
      expect(untils[i]).toBeLessThanOrEqual(untils[i - 1])
    }
  })

  it('shrinks the per-page limit as events accumulate', async () => {
    const { run, calls } = fakeRelay(makeEvents(250, 1_000_000), 100)
    await paginateQuery(run, { kinds: [1], limit: 250 }, { intervalMs: 0, maxPages: 20 })
    expect(calls[0].limit).toBe(250)
    // 150 remaining, plus one to absorb the re-fetched boundary event
    expect(calls[1].limit).toBe(151)
  })

  it('stops at the since boundary', async () => {
    const { run } = fakeRelay(makeEvents(250, 1_000_000), 100)
    const events = await paginateQuery(
      run,
      { kinds: [1], limit: 250, since: 999_950 },
      { intervalMs: 0, maxPages: 20 },
    )
    expect(events.every(e => e.created_at >= 999_950)).toBe(true)
    expect(events.length).toBeLessThan(250)
  })

  it('honours maxPages', async () => {
    const { run, calls } = fakeRelay(makeEvents(10_000, 2_000_000), 10)
    const events = await paginateQuery(run, { kinds: [1], limit: 9999 }, { intervalMs: 0, maxPages: 3 })
    expect(calls).toHaveLength(3)
    expect(events.length).toBeLessThanOrEqual(30)
  })

  it('terminates when the relay returns nothing', async () => {
    const run = vi.fn().mockResolvedValue([])
    const events = await paginateQuery(run, { kinds: [1], limit: 100 }, { intervalMs: 0, maxPages: 20 })
    expect(events).toEqual([])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('terminates when every event shares one timestamp', async () => {
    // Pathological case: a naive `until = oldest - 1` walk would skip events,
    // and `until = oldest` without dedupe would loop forever.
    const sameSecond = Array.from({ length: 5 }, (_, i) => ({
      id: `same${i}`,
      pubkey: 'aa'.repeat(32),
      created_at: 1_000_000,
      kind: 1,
      tags: [],
      content: '',
      sig: '00'.repeat(64),
    })) as NostrEvent[]
    const { run, calls } = fakeRelay(sameSecond, 5)
    const events = await paginateQuery(run, { kinds: [1], limit: 100 }, { intervalMs: 0, maxPages: 20 })
    expect(events).toHaveLength(5)
    expect(calls.length).toBeLessThanOrEqual(3)
  })

  it('terminates when the relay keeps returning the same page', async () => {
    const stuck = makeEvents(5, 1_000_000)
    const run = vi.fn().mockResolvedValue(stuck)
    const events = await paginateQuery(run, { kinds: [1], limit: 100 }, { intervalMs: 0, maxPages: 20 })
    expect(events).toHaveLength(5)
    expect(run.mock.calls.length).toBeLessThan(DEFAULT_MAX_PAGES)
  })

  it('defaults limit to 50 when the base filter has none', async () => {
    const { run } = fakeRelay(makeEvents(200, 1_000_000), 10)
    const events = await paginateQuery(run, { kinds: [1] }, { intervalMs: 0, maxPages: 20 })
    expect(events).toHaveLength(50)
  })

  it('preserves the rest of the filter on every page', async () => {
    const { run, calls } = fakeRelay(makeEvents(120, 1_000_000), 50)
    await paginateQuery(
      run,
      { kinds: [1, 7], authors: ['abc'], limit: 120 } as Filter,
      { intervalMs: 0, maxPages: 20 },
    )
    for (const c of calls) {
      expect(c.kinds).toEqual([1, 7])
      expect(c.authors).toEqual(['abc'])
    }
  })

  it('waits between pages when an interval is set', async () => {
    const { run } = fakeRelay(makeEvents(120, 1_000_000), 50)
    const started = Date.now()
    await paginateQuery(run, { kinds: [1], limit: 120 }, { intervalMs: 20, maxPages: 20 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })
})
