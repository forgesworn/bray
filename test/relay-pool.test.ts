import { describe, it, expect, vi } from 'vitest'
import { RelayPool, summarisePublish } from '../src/relay-pool.js'
import type { PoolLike } from '../src/relay-pool.js'
import { nip77 } from 'nostr-tools'

const NPUB_A = 'npub1abc111111111111111111111111111111111111111111111111abcdef01'
const NPUB_B = 'npub1def222222222222222222222222222222222222222222222222abcdef02'

function mockPool(overrides?: Partial<PoolLike>): PoolLike {
  return {
    publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
    querySync: vi.fn().mockResolvedValue([]),
    destroy: vi.fn(),
    ...overrides,
  }
}

describe('RelayPool', () => {
  describe('construction', () => {
    it('creates pool with default relays', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://relay1.example.com'] },
        mockPool(),
      )
      expect(pool).toBeDefined()
      pool.close()
    })
  })

  describe('reconfigure', () => {
    it('stores relay set for identity npub', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        mockPool(),
      )
      pool.reconfigure(NPUB_A, {
        read: ['wss://read.example.com'],
        write: ['wss://write.example.com'],
      })
      const relays = pool.getRelays(NPUB_A)
      expect(relays).toEqual({
        read: ['wss://read.example.com'],
        write: ['wss://write.example.com'],
      })
      pool.close()
    })

    it('returns defaults when identity has no relay set', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        mockPool(),
      )
      const relays = pool.getRelays(NPUB_A)
      expect(relays).toEqual({
        read: ['wss://default.example.com'],
        write: ['wss://default.example.com'],
      })
      pool.close()
    })
  })

  describe('Tor validation', () => {
    it('rejects clearnet URLs when torProxy set and allowClearnet false', () => {
      expect(
        () => new RelayPool({
          torProxy: 'socks5h://127.0.0.1:9050',
          allowClearnet: false,
          defaultRelays: ['wss://clearnet.example.com'],
        }, mockPool())
      ).toThrow(/clearnet.*tor/i)
    })

    it('accepts .onion URLs when torProxy is set', () => {
      const pool = new RelayPool({
        torProxy: 'socks5h://127.0.0.1:9050',
        allowClearnet: false,
        defaultRelays: ['ws://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion'],
      }, mockPool())
      expect(pool).toBeDefined()
      pool.close()
    })

    it('allows clearnet with Tor when allowClearnet is true', () => {
      const pool = new RelayPool({
        torProxy: 'socks5h://127.0.0.1:9050',
        allowClearnet: true,
        defaultRelays: ['wss://clearnet.example.com'],
      }, mockPool())
      expect(pool).toBeDefined()
      pool.close()
    })
  })

  describe('explicit relay policy', () => {
    it('rejects private relay URLs before a direct query or publish', async () => {
      const inner = mockPool()
      const pool = new RelayPool({ allowClearnet: true, defaultRelays: [] }, inner)
      await expect(pool.queryDirect(['ws://127.0.0.1:3000'], {})).rejects.toThrow(/plaintext|private/i)
      await expect(pool.publishDirect(['ws://127.0.0.1:3000'], {} as any)).rejects.toThrow(/plaintext|private/i)
      expect(inner.querySync).not.toHaveBeenCalled()
      expect(inner.publish).not.toHaveBeenCalled()
    })

    it('enforces Tor-only policy for direct reconciliation', async () => {
      const inner = mockPool({ ensureRelay: vi.fn() })
      const pool = new RelayPool({
        torProxy: 'socks5h://127.0.0.1:9050',
        allowClearnet: false,
        defaultRelays: [],
      }, inner)
      await expect(pool.reconcileDirect('wss://clearnet.example.com', [], {})).rejects.toThrow(/clearnet.*tor/i)
      expect(inner.ensureRelay).not.toHaveBeenCalled()
    })

    it('runs nostr-tools Negentropy and maps local-only vs remote-only IDs', async () => {
      const localOnly = 'a'.repeat(64)
      const common = 'b'.repeat(64)
      const remoteOnly = 'c'.repeat(64)
      const remoteStorage = new nip77.NegentropyStorageVector()
      remoteStorage.insert(2, common)
      remoteStorage.insert(3, remoteOnly)
      remoteStorage.seal()
      const remoteNegentropy = new nip77.Negentropy(remoteStorage)
      const closeSubscription = vi.fn()
      const subscription: any = { id: 'neg-test', close: closeSubscription, oncustom: undefined }
      const relay = {
        url: 'wss://relay.example.com',
        prepareSubscription: vi.fn().mockReturnValue(subscription),
        send: vi.fn((raw: string) => {
          const message = JSON.parse(raw)
          if (message[0] === 'NEG-OPEN') {
            queueMicrotask(() => subscription.oncustom(['NEG-MSG', subscription.id, remoteNegentropy.initiate()]))
          }
        }),
      }
      const inner = mockPool({ ensureRelay: vi.fn().mockResolvedValue(relay as any) })
      const pool = new RelayPool({ allowClearnet: true, defaultRelays: [] }, inner)

      const result = await pool.reconcileDirect('wss://relay.example.com', [
        { id: localOnly, createdAt: 1 },
        { id: common, createdAt: 2 },
      ], {}, { timeoutMs: 1_000 })

      expect(result.localOnlyIds).toEqual([localOnly])
      expect(result.remoteOnlyIds).toEqual([remoteOnly])
      expect(closeSubscription).toHaveBeenCalled()
    })

    it('does not misreport a relay NEG-ERR as a complete empty diff', async () => {
      const subscription: any = { id: 'neg-error', close: vi.fn(), oncustom: undefined }
      const relay = {
        url: 'wss://relay.example.com',
        prepareSubscription: vi.fn().mockReturnValue(subscription),
        send: vi.fn((raw: string) => {
          const message = JSON.parse(raw)
          if (message[0] === 'NEG-OPEN') {
            queueMicrotask(() => subscription.oncustom(['NEG-ERR', subscription.id, 'unsupported']))
          }
        }),
      }
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: [] },
        mockPool({ ensureRelay: vi.fn().mockResolvedValue(relay as any) }),
      )
      await expect(pool.reconcileDirect('wss://relay.example.com', [], {}, { timeoutMs: 1_000 }))
        .rejects.toThrow(/without a completed diff/)
    })
  })

  describe('write queue', () => {
    it('queues writes when identity relay list is not yet known', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        mockPool(),
      )
      const fakeEvent = { id: 'abc', kind: 1 } as any
      pool.queueWrite(NPUB_A, fakeEvent)
      expect(pool.queueSize(NPUB_A)).toBe(1)
      pool.close()
    })

    it('flushes write queue on reconfigure', async () => {
      const inner = mockPool()
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        inner,
      )
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      pool.queueWrite(NPUB_A, fakeEvent)
      expect(pool.queueSize(NPUB_A)).toBe(1)

      pool.reconfigure(NPUB_A, {
        read: ['wss://read.example.com'],
        write: ['wss://write.example.com'],
      })

      // Queue flush is async — wait for it
      await vi.waitFor(() => {
        expect(pool.queueSize(NPUB_A)).toBe(0)
      })
      expect(inner.publish).toHaveBeenCalled()
      pool.close()
    })
  })

  describe('publish', () => {
    it('publishes event to write relays for identity', async () => {
      const inner = mockPool({
        publish: vi.fn().mockReturnValue([Promise.resolve('ok'), Promise.resolve('ok')]),
      })
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        inner,
      )
      pool.reconfigure(NPUB_A, {
        read: ['wss://read.example.com'],
        write: ['wss://write1.example.com', 'wss://write2.example.com'],
      })
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      const result = await pool.publish(NPUB_A, fakeEvent)
      expect(result.success).toBe(true)
      expect(result.accepted).toEqual(['wss://write1.example.com', 'wss://write2.example.com'])
      // Third arg carries NIP-42 params; empty when auth mode is 'off' (the default)
      expect(inner.publish).toHaveBeenCalledWith(
        ['wss://write1.example.com', 'wss://write2.example.com'],
        fakeEvent,
        {},
      )
      pool.close()
    })

    it('reports partial failures', async () => {
      const inner = mockPool({
        publish: vi.fn().mockReturnValue([
          Promise.resolve('ok'),
          Promise.reject(new Error('connection failed')),
        ]),
      })
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        inner,
      )
      pool.reconfigure(NPUB_A, {
        read: [],
        write: ['wss://ok.example.com', 'wss://fail.example.com'],
      })
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      const result = await pool.publish(NPUB_A, fakeEvent)
      expect(result.accepted.length).toBe(1)
      expect(result.rejected.length).toBe(1)
      // 1 of 2 accepted meets the majority-quorum rule (>= 50%), so success is true.
      // allAccepted stays false because not every relay accepted.
      expect(result.success).toBe(true)
      expect(result.allAccepted).toBe(false)
      pool.close()
    })

    it('treats a minority of accepts as failure', async () => {
      const inner = mockPool({
        publish: vi.fn().mockReturnValue([
          Promise.resolve('ok'),
          Promise.reject(new Error('paywall')),
          Promise.reject(new Error('whitelist')),
          Promise.reject(new Error('offline')),
        ]),
      })
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        inner,
      )
      pool.reconfigure(NPUB_A, {
        read: [],
        write: [
          'wss://ok.example.com',
          'wss://paywall.example.com',
          'wss://whitelist.example.com',
          'wss://offline.example.com',
        ],
      })
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      const result = await pool.publish(NPUB_A, fakeEvent)
      expect(result.accepted.length).toBe(1)
      expect(result.rejected.length).toBe(3)
      // 1 of 4 is below the 50% threshold, so success is false.
      expect(result.success).toBe(false)
      expect(result.allAccepted).toBe(false)
      pool.close()
    })

    it('reports allAccepted when every relay accepts', async () => {
      const inner = mockPool({
        publish: vi.fn().mockReturnValue([
          Promise.resolve('ok'),
          Promise.resolve('ok'),
          Promise.resolve('ok'),
        ]),
      })
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        inner,
      )
      pool.reconfigure(NPUB_A, {
        read: [],
        write: [
          'wss://a.example.com',
          'wss://b.example.com',
          'wss://c.example.com',
        ],
      })
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      const result = await pool.publish(NPUB_A, fakeEvent)
      expect(result.success).toBe(true)
      expect(result.allAccepted).toBe(true)
      pool.close()
    })
  })

  describe('shared relay detection', () => {
    it('warns when two identities share a relay', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: [] },
        mockPool(),
      )
      pool.reconfigure(NPUB_A, {
        read: ['wss://shared.example.com', 'wss://a-only.example.com'],
        write: ['wss://shared.example.com'],
      })
      pool.reconfigure(NPUB_B, {
        read: ['wss://shared.example.com', 'wss://b-only.example.com'],
        write: ['wss://b-only.example.com'],
      })
      const shared = pool.checkSharedRelays(NPUB_A, NPUB_B)
      expect(shared).toContain('wss://shared.example.com')
      expect(shared).not.toContain('wss://a-only.example.com')
      pool.close()
    })

    it('returns empty when no shared relays', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: [] },
        mockPool(),
      )
      pool.reconfigure(NPUB_A, {
        read: ['wss://a.example.com'],
        write: ['wss://a.example.com'],
      })
      pool.reconfigure(NPUB_B, {
        read: ['wss://b.example.com'],
        write: ['wss://b.example.com'],
      })
      const shared = pool.checkSharedRelays(NPUB_A, NPUB_B)
      expect(shared).toEqual([])
      pool.close()
    })
  })

  describe('write queue cap', () => {
    it('rejects writes when queue exceeds 100', () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: ['wss://default.example.com'] },
        mockPool(),
      )
      const fakeEvent = { id: 'abc', kind: 1 } as any
      for (let i = 0; i < 100; i++) {
        pool.queueWrite(NPUB_A, fakeEvent)
      }
      expect(() => pool.queueWrite(NPUB_A, fakeEvent)).toThrow(/queue full/i)
      pool.close()
    })
  })

  describe('Tor policy on reconfigure', () => {
    it('rejects clearnet relays on reconfigure when Tor is set', () => {
      const pool = new RelayPool({
        torProxy: 'socks5h://127.0.0.1:9050',
        allowClearnet: false,
        defaultRelays: ['ws://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion'],
      }, mockPool())
      expect(() => pool.reconfigure(NPUB_A, {
        read: ['wss://clearnet.example.com'],
        write: [],
      })).toThrow(/clearnet.*tor/i)
      pool.close()
    })
  })

  describe('no write relays', () => {
    it('returns failure when no write relays configured', async () => {
      const pool = new RelayPool(
        { allowClearnet: true, defaultRelays: [] },
        mockPool(),
      )
      pool.reconfigure(NPUB_A, { read: ['wss://read.example.com'], write: [] })
      const fakeEvent = { id: 'abc', kind: 1, pubkey: '1234', sig: 'dead', created_at: 0, tags: [], content: '' } as any
      const result = await pool.publish(NPUB_A, fakeEvent)
      expect(result.success).toBe(false)
      expect(result.allAccepted).toBe(false)
      expect(result.errors).toContain('no write relays configured')
      pool.close()
    })
  })
})

describe('summarisePublish', () => {
  it('all relays accept — success and allAccepted both true', () => {
    expect(summarisePublish(10, 10)).toEqual({ success: true, allAccepted: true })
  })

  it('clear majority accepts — success true, allAccepted false', () => {
    expect(summarisePublish(7, 10)).toEqual({ success: true, allAccepted: false })
  })

  it('exact 50% accepts — success true, allAccepted false', () => {
    expect(summarisePublish(5, 10)).toEqual({ success: true, allAccepted: false })
  })

  it('minority accepts — success false, allAccepted false', () => {
    expect(summarisePublish(3, 10)).toEqual({ success: false, allAccepted: false })
  })

  it('single accept out of many — success false, allAccepted false', () => {
    expect(summarisePublish(1, 10)).toEqual({ success: false, allAccepted: false })
  })

  it('zero accepted with some rejected — success false, allAccepted false', () => {
    expect(summarisePublish(0, 6)).toEqual({ success: false, allAccepted: false })
  })

  it('zero attempted — success false, allAccepted false', () => {
    expect(summarisePublish(0, 0)).toEqual({ success: false, allAccepted: false })
  })

  it('single relay accepts — success true, allAccepted true', () => {
    expect(summarisePublish(1, 1)).toEqual({ success: true, allAccepted: true })
  })

  it('one of two accepts — success true (50% rule), allAccepted false', () => {
    expect(summarisePublish(1, 2)).toEqual({ success: true, allAccepted: false })
  })
})
