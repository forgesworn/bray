import { describe, it, expect } from 'vitest'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { RelayPool } from '../src/relay-pool.js'

/** A loopback port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

describe('RelayPool publish to a relay it cannot reach', () => {
  it('reports the relay as rejected with the connection failure, not as accepted', async () => {
    const url = `ws://127.0.0.1:${await closedPort()}`
    const pool = new RelayPool({ allowClearnet: true, defaultRelays: [], allowPrivateRelays: true })
    try {
      const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'nowhere' }, generateSecretKey())
      const result = await pool.publishDirect([url], note)

      expect(result.success).toBe(false)
      expect(result.allAccepted).toBe(false)
      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([url])
      expect(result.errors.join(' ')).toContain('connection failure')
    } finally {
      pool.close()
    }
  })
})
