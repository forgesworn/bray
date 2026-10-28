import { describe, it, expect } from 'vitest'
import { SafeWebSocket } from '../src/ws-safe.js'

// nostr-tools clears onerror and then closes a socket that may still be
// connecting. With plain `ws` that emits an unhandled `error` and kills the
// process; SafeWebSocket must absorb it.
describe('SafeWebSocket', () => {
  it('survives being closed while still connecting with no onerror set', async () => {
    const ws = new SafeWebSocket('ws://127.0.0.1:1')
    ws.onerror = null
    ws.close()
    // Give ws a few ticks to emit its late error.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ws.readyState).toBe(SafeWebSocket.CLOSED)
  })

  it('still reports connection errors to onerror', async () => {
    const ws = new SafeWebSocket('ws://127.0.0.1:1')
    const error = await new Promise<unknown>(resolve => { ws.onerror = resolve })
    expect(error).toBeDefined()
  })
})

describe('webSocketFor', () => {
  it('is plain SafeWebSocket with no proxy and no options', async () => {
    const { webSocketFor } = await import('../src/ws-safe.js')
    expect(webSocketFor(undefined)).toBe(SafeWebSocket)
  })

  it('cannot connect through a dead proxy, so traffic really goes through it', async () => {
    const { webSocketFor } = await import('../src/ws-safe.js')
    const Proxied = webSocketFor('socks5h://127.0.0.1:1')
    const ws = new Proxied('ws://127.0.0.1:19651')
    const outcome = await new Promise<string>(resolve => {
      ws.onopen = () => resolve('open')
      ws.onerror = () => resolve('error')
    })
    expect(outcome).toBe('error')
    expect(ws).toBeInstanceOf(SafeWebSocket)
  })
})
