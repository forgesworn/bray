import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:net'
import {
  configureHttpClient,
  resetHttpClient,
  isTorRouted,
  __resetHttpClientForTests,
} from '../src/http-client.js'

afterEach(() => {
  __resetHttpClientForTests()
})

describe('http-client', () => {
  it('does not swap dispatcher when torProxy is unset', () => {
    configureHttpClient({})
    expect(isTorRouted()).toBe(false)
  })

  it('swaps dispatcher when torProxy is set', () => {
    configureHttpClient({ torProxy: 'socks5://127.0.0.1:9050' })
    expect(isTorRouted()).toBe(true)
  })

  it('accepts socks5h:// scheme (Tor convention) by normalising to socks5://', () => {
    expect(() => configureHttpClient({ torProxy: 'socks5h://127.0.0.1:9050' })).not.toThrow()
    expect(isTorRouted()).toBe(true)
  })

  it('routes fetch through the configured proxy: connection refused when proxy is down', async () => {
    // Find a port nothing is listening on — brief listen, then close.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))

    configureHttpClient({ torProxy: `socks5://127.0.0.1:${port}` })

    // Even though example.com would be reachable directly, the request now
    // tries to tunnel via the (closed) SOCKS port and must fail. This
    // proves the dispatcher swap took effect for the global fetch.
    await expect(
      fetch('http://example.com/', { signal: AbortSignal.timeout(2000) }),
    ).rejects.toThrow()
  })

  it('resetHttpClient restores the original dispatcher', async () => {
    configureHttpClient({ torProxy: 'socks5://127.0.0.1:9050' })
    expect(isTorRouted()).toBe(true)
    resetHttpClient()
    expect(isTorRouted()).toBe(false)
  })
})
