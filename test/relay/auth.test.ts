import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleRelayAuth } from '../../src/relay/auth.js'
import { IdentityContext } from '../../src/context.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeCtx(): IdentityContext {
  return new IdentityContext(TEST_NSEC, 'nsec')
}

describe('handleRelayAuth', () => {
  it('rejects private network relay URLs', async () => {
    await expect(handleRelayAuth(makeCtx(), 'wss://127.0.0.1')).rejects.toThrow(/private/)
  })

  it('completes AUTH handshake successfully', async () => {
    const challenge = 'test-challenge-abc123'
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH' && typeof msg[1] === 'object') {
          const eventId = msg[1].id
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', eventId, true, '']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', challenge]) })
        }, 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://auth.example.com')
    expect(result.authenticated).toBe(true)
    expect(result.relay).toBe('wss://auth.example.com')
    expect(result.pubkey).toBeDefined()
  })

  it('returns error when AUTH is rejected', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH') {
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', 'x', false, 'auth: invalid signature']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge123']) })
        }, 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://strict.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('rejected')
  })

  it('returns error on connection failure', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://down.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('connection failed')
  })

  it('times out if no challenge is received', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        // Never send AUTH challenge
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://silent.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('timed out')
  }, 10_000)

  it('signs kind 22242 with relay and challenge tags', async () => {
    let sentEvent: any = null
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH' && typeof msg[1] === 'object') {
          sentEvent = msg[1]
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', sentEvent.id, true, '']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', 'my-challenge']) })
        }, 10)
      }
    })

    await handleRelayAuth(makeCtx(), 'wss://verify.example.com')

    expect(sentEvent).toBeDefined()
    expect(sentEvent.kind).toBe(22242)
    expect(sentEvent.tags).toContainEqual(['relay', 'wss://verify.example.com'])
    expect(sentEvent.tags).toContainEqual(['challenge', 'my-challenge'])
    expect(sentEvent.content).toBe('')
    expect(sentEvent.sig).toBeDefined()
  })
})
