import { describe, it, expect, beforeEach, vi } from 'vitest'

const TEST_NPUB = 'npub1abc111111111111111111111111111111111111111111111111abcdef01'
const TEST_PUBKEY = 'abc111111111111111111111111111111111111111111111111111abcdef01'

describe('Nip65Manager', () => {
  let Nip65Manager: typeof import('../src/nip65.js').Nip65Manager

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../src/nip65.js')
    Nip65Manager = mod.Nip65Manager
  })

  describe('parseRelayTags', () => {
    it('parses r tags into read/write relay lists', async () => {
      const { parseRelayTags } = await import('../src/nip65.js')
      const tags = [
        ['r', 'wss://read.example.com', 'read'],
        ['r', 'wss://write.example.com', 'write'],
        ['r', 'wss://both.example.com'],
      ]
      const result = parseRelayTags(tags)
      expect(result.read).toContain('wss://read.example.com')
      expect(result.read).toContain('wss://both.example.com')
      expect(result.write).toContain('wss://write.example.com')
      expect(result.write).toContain('wss://both.example.com')
      expect(result.read).not.toContain('wss://write.example.com')
      expect(result.write).not.toContain('wss://read.example.com')
    })
  })

  describe('caching', () => {
    it('caches relay list per npub', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue([{
          kind: 10002,
          created_at: 1000,
          pubkey: TEST_PUBKEY,
          tags: [
            ['r', 'wss://cached.example.com'],
          ],
          id: 'evt1',
          sig: 'sig1',
          content: '',
        }]),
      }
      const manager = new Nip65Manager(mockPool as any, ['wss://default.example.com'])
      await manager.loadForIdentity(TEST_NPUB, TEST_PUBKEY)

      const cached = manager.getCached(TEST_NPUB)
      expect(cached).toBeDefined()
      expect(cached!.read).toContain('wss://cached.example.com')
    })

    it('returns cached result without querying again', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue([{
          kind: 10002,
          created_at: 1000,
          pubkey: TEST_PUBKEY,
          tags: [['r', 'wss://cached.example.com']],
          id: 'evt1',
          sig: 'sig1',
          content: '',
        }]),
      }
      const manager = new Nip65Manager(mockPool as any, ['wss://default.example.com'])
      await manager.loadForIdentity(TEST_NPUB, TEST_PUBKEY)
      await manager.loadForIdentity(TEST_NPUB, TEST_PUBKEY) // second call
      expect(mockPool.query).toHaveBeenCalledTimes(1)
    })
  })

  describe('defaults fallback', () => {
    it('falls back to defaults when no kind 10002 found', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue([]),
      }
      const defaults = ['wss://default1.example.com', 'wss://default2.example.com']
      const manager = new Nip65Manager(mockPool as any, defaults)
      const result = await manager.loadForIdentity(TEST_NPUB, TEST_PUBKEY)
      expect(result.read).toEqual(defaults)
      expect(result.write).toEqual(defaults)
    })
  })

  describe('event injection defence', () => {
    it('takes highest created_at when multiple events returned', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10002,
            created_at: 500,
            pubkey: TEST_PUBKEY,
            tags: [['r', 'wss://old.example.com']],
            id: 'old',
            sig: 'sig1',
            content: '',
          },
          {
            kind: 10002,
            created_at: 1000,
            pubkey: TEST_PUBKEY,
            tags: [['r', 'wss://new.example.com']],
            id: 'new',
            sig: 'sig2',
            content: '',
          },
          {
            kind: 10002,
            created_at: 750,
            pubkey: TEST_PUBKEY,
            tags: [['r', 'wss://mid.example.com']],
            id: 'mid',
            sig: 'sig3',
            content: '',
          },
        ]),
      }
      const manager = new Nip65Manager(mockPool as any, ['wss://default.example.com'])
      const result = await manager.loadForIdentity(TEST_NPUB, TEST_PUBKEY)
      expect(result.read).toContain('wss://new.example.com')
      expect(result.read).not.toContain('wss://old.example.com')
      expect(result.read).not.toContain('wss://mid.example.com')
    })
  })
})
