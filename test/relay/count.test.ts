import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleRelayCount } from '../../src/relay/count.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleRelayCount', () => {
  it('rejects private network relay URLs', async () => {
    await expect(
      handleRelayCount(['wss://127.0.0.1'], { kinds: [1] }),
    ).rejects.toThrow(/private/)
  })

  it('falls back to fetch-and-count when poolQuery provided', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const mockPoolQuery = vi.fn().mockResolvedValue(
      Array(42).fill({ id: 'x', kind: 1 }),
    )

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
      mockPoolQuery,
    )

    expect(result.counts[0].count).toBe(42)
    expect(result.counts[0].fallback).toBe(true)
    expect(result.total).toBe(42)
  })

  it('marks result as estimated when fallback hits 1000 cap', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const mockPoolQuery = vi.fn().mockResolvedValue(
      Array(1000).fill({ id: 'x', kind: 1 }),
    )

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
      mockPoolQuery,
    )

    expect(result.counts[0].estimated).toBe(true)
    expect(result.counts[0].fallback).toBe(true)
  })

  it('returns error when no fallback and COUNT fails', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
    )

    expect(result.counts[0].error).toBeDefined()
    expect(result.counts[0].count).toBe(0)
    expect(result.total).toBe(0)
  })

  it('resolves count from successful WebSocket COUNT response', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onopen?.()
        }, 10)
        setTimeout(() => {
          const sent = this.send.mock.calls[0]?.[0]
          if (sent) {
            const parsed = JSON.parse(sent)
            const subId = parsed[1]
            this.onmessage?.({ data: JSON.stringify(['COUNT', subId, { count: 99 }]) })
          }
        }, 20)
      }
    })

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
    )

    expect(result.counts[0].count).toBe(99)
    expect(result.counts[0].fallback).toBeUndefined()
    expect(result.total).toBe(99)
  })

  it('queries multiple relays in parallel', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onopen?.(), 10)
        setTimeout(() => {
          const sent = this.send.mock.calls[0]?.[0]
          if (sent) {
            const parsed = JSON.parse(sent)
            this.onmessage?.({ data: JSON.stringify(['COUNT', parsed[1], { count: 10 }]) })
          }
        }, 20)
      }
    })

    const result = await handleRelayCount(
      ['wss://r1.example.com', 'wss://r2.example.com'],
      { kinds: [1] },
    )

    expect(result.counts).toHaveLength(2)
    expect(result.total).toBe(20)
  })
})
