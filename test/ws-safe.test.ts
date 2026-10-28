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
