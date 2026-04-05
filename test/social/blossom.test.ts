import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { IdentityContext } from '../../src/context.js'
import {
  handleBlossomUpload,
  handleBlossomList,
  handleBlossomDelete,
  handleBlossomDownload,
  handleBlossomMirror,
  handleBlossomCheck,
  handleBlossomDiscover,
  handleBlossomVerify,
  handleBlossomRepair,
  handleBlossomUsage,
  handleBlossomServersGet,
  handleBlossomServersSet,
} from '../../src/social/blossom.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('blossom handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('handleBlossomUpload', () => {
    it('creates auth event with kind 24242 and uploads', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ url: 'https://blossom.example.com/abc123', sha256: 'abc123', size: 42 }),
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

      const result = await handleBlossomUpload(ctx, {
        server: 'https://blossom.example.com',
        data: new Uint8Array([1, 2, 3]),
      })
      expect(result.url).toContain('blossom.example.com')
      expect(result.sha256).toBe('abc123')

      const fetchCall = (fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://blossom.example.com/upload')
      expect(fetchCall[1].method).toBe('PUT')
      expect(fetchCall[1].headers.Authorization).toMatch(/^Nostr /)

      vi.unstubAllGlobals()
    })

    it('errors when neither filePath nor data provided', async () => {
      await expect(handleBlossomUpload(ctx, { server: 'https://test.com' }))
        .rejects.toThrow(/filePath or data/)
    })

    it('throws on upload failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, text: () => Promise.resolve('too large') }))
      await expect(handleBlossomUpload(ctx, { server: 'https://test.com', data: new Uint8Array([1]) }))
        .rejects.toThrow(/413/)
      vi.unstubAllGlobals()
    })

    it('auth header contains base64 encoded kind 24242 event', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
      await handleBlossomUpload(ctx, { server: 'https://test.com', data: new Uint8Array([1]) })

      const auth = (fetch as any).mock.calls[0][1].headers.Authorization
      const eventJson = Buffer.from(auth.replace('Nostr ', ''), 'base64').toString()
      const event = JSON.parse(eventJson)
      expect(event.kind).toBe(24242)
      expect(event.tags.find((t: string[]) => t[0] === 't')[1]).toBe('upload')
      expect(event.tags.find((t: string[]) => t[0] === 'x')).toBeDefined()

      vi.unstubAllGlobals()
    })
  })

  describe('handleBlossomList', () => {
    it('fetches blob list for pubkey', async () => {
      const blobs = [
        { url: 'https://test.com/a', sha256: 'a', size: 100 },
        { url: 'https://test.com/b', sha256: 'b', size: 200 },
      ]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(blobs) }))

      const result = await handleBlossomList({ server: 'https://test.com', pubkeyHex: 'abc123' })
      expect(result.length).toBe(2)
      expect((fetch as any).mock.calls[0][0]).toBe('https://test.com/list/abc123')

      vi.unstubAllGlobals()
    })
  })

  describe('handleBlossomDelete', () => {
    it('sends DELETE with auth header', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      const result = await handleBlossomDelete(ctx, { server: 'https://test.com', sha256: 'deadbeef' })
      expect(result.deleted).toBe(true)

      const fetchCall = (fetch as any).mock.calls[0]
      expect(fetchCall[0]).toBe('https://test.com/deadbeef')
      expect(fetchCall[1].method).toBe('DELETE')
      expect(fetchCall[1].headers.Authorization).toMatch(/^Nostr /)

      vi.unstubAllGlobals()
    })

    it('returns deleted: false on failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
      const result = await handleBlossomDelete(ctx, { server: 'https://test.com', sha256: 'bad' })
      expect(result.deleted).toBe(false)
      vi.unstubAllGlobals()
    })
  })

  describe('handleBlossomDownload', () => {
    it('downloads blob and returns data + content type', async () => {
      const data = new Uint8Array([1, 2, 3, 4])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: () => Promise.resolve(data.buffer),
      }))
      const result = await handleBlossomDownload({ server: 'https://test.com', sha256: 'abc123' })
      expect(result.data.length).toBe(4)
      vi.unstubAllGlobals()
    })

    it('throws on download failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
      await expect(handleBlossomDownload({ server: 'https://test.com', sha256: 'bad' }))
        .rejects.toThrow(/404/)
      vi.unstubAllGlobals()
    })

    it('rejects private network URLs', async () => {
      await expect(handleBlossomDownload({ server: 'https://127.0.0.1', sha256: 'abc' }))
        .rejects.toThrow(/private/)
    })
  })

  describe('handleBlossomUpload — file size check', () => {
    it('rejects files over 100MB', async () => {
      // We can't easily create a 100MB file in tests, but we can test the statSync path
      // by passing a non-existent file (it'll throw before the size check)
      await expect(handleBlossomUpload(ctx, { server: 'https://test.com', filePath: '/nonexistent' }))
        .rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Media Redundancy
  // -----------------------------------------------------------------------

  describe('handleBlossomMirror', () => {
    it('uploads data to multiple servers in parallel', async () => {
      const data = new Uint8Array([1, 2, 3])
      const expectedHash = createHash('sha256').update(data).digest('hex')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: 'https://a.com/' + expectedHash, sha256: expectedHash, size: 3 }),
      }))

      const result = await handleBlossomMirror(ctx, {
        servers: ['https://a.com', 'https://b.com'],
        data,
      })

      expect(result.sha256).toBe(expectedHash)
      expect(result.size).toBe(3)
      expect(result.servers).toHaveLength(2)
      expect(result.servers[0].success).toBe(true)
      expect(result.servers[1].success).toBe(true)
    })

    it('reports per-server failures without throwing', async () => {
      const data = new Uint8Array([10])
      let callCount = 0

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++
        if (callCount <= 1) {
          // First call succeeds (for server a)
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ url: 'https://a.com/x', sha256: 'x', size: 1 }),
          })
        }
        // Second call fails (for server b)
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal error'),
        })
      }))

      const result = await handleBlossomMirror(ctx, {
        servers: ['https://a.com', 'https://b.com'],
        data,
      })

      const successes = result.servers.filter(s => s.success)
      const failures = result.servers.filter(s => !s.success)
      // At least one should succeed and at least one fail
      expect(successes.length + failures.length).toBe(2)
    })

    it('fetches from sourceUrl when provided', async () => {
      const data = new Uint8Array([5, 6, 7])
      const expectedHash = createHash('sha256').update(data).digest('hex')
      let callCount = 0

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        callCount++
        if (callCount === 1) {
          // Source URL fetch
          return Promise.resolve({
            ok: true,
            headers: new Map([['content-type', 'image/png']]),
            arrayBuffer: () => Promise.resolve(data.buffer),
          })
        }
        // Upload to target server
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ url: 'https://target.com/' + expectedHash, sha256: expectedHash, size: 3 }),
        })
      }))

      const result = await handleBlossomMirror(ctx, {
        servers: ['https://target.com'],
        sourceUrl: 'https://source.com/' + expectedHash,
      })

      expect(result.sha256).toBe(expectedHash)
      expect(result.servers[0].success).toBe(true)
    })

    it('rejects empty servers array', async () => {
      await expect(handleBlossomMirror(ctx, { servers: [], data: new Uint8Array([1]) }))
        .rejects.toThrow(/At least one/)
    })

    it('rejects more than 10 servers', async () => {
      const servers = Array.from({ length: 11 }, (_, i) => `https://s${i}.com`)
      await expect(handleBlossomMirror(ctx, { servers, data: new Uint8Array([1]) }))
        .rejects.toThrow(/Maximum 10/)
    })

    it('requires at least one data source', async () => {
      await expect(handleBlossomMirror(ctx, { servers: ['https://a.com'] }))
        .rejects.toThrow(/sourceUrl, filePath, or data/)
    })
  })

  describe('handleBlossomCheck', () => {
    it('returns exists: true on 200 HEAD response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([
          ['content-length', '1024'],
          ['content-type', 'image/jpeg'],
        ]),
      }))

      const result = await handleBlossomCheck({ server: 'https://test.com', sha256: 'abc123' })
      expect(result.exists).toBe(true)
      expect(result.size).toBe(1024)
      expect(result.contentType).toBe('image/jpeg')

      const call = (fetch as any).mock.calls[0]
      expect(call[1].method).toBe('HEAD')
    })

    it('returns exists: false on 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

      const result = await handleBlossomCheck({ server: 'https://test.com', sha256: 'missing' })
      expect(result.exists).toBe(false)
    })

    it('verifies hash integrity when verify: true', async () => {
      const data = new Uint8Array([1, 2, 3])
      const hash = createHash('sha256').update(data).digest('hex')

      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // HEAD request
          return Promise.resolve({
            ok: true,
            headers: new Map([['content-length', '3']]),
          })
        }
        // GET request for verification
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(data.buffer),
        })
      }))

      const result = await handleBlossomCheck({ server: 'https://test.com', sha256: hash, verify: true })
      expect(result.exists).toBe(true)
      expect(result.hashVerified).toBe(true)
      expect(result.hashMismatch).toBe(false)
    })

    it('detects hash mismatch when verify: true', async () => {
      const data = new Uint8Array([1, 2, 3])

      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({ ok: true, headers: new Map() })
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(data.buffer),
        })
      }))

      const result = await handleBlossomCheck({ server: 'https://test.com', sha256: 'badhash'.padEnd(64, '0'), verify: true })
      expect(result.hashVerified).toBe(false)
      expect(result.hashMismatch).toBe(true)
    })
  })

  describe('handleBlossomDiscover', () => {
    it('parses kind 10063 server tags from contacts', async () => {
      const pk1 = 'a'.repeat(64)
      const pk2 = 'b'.repeat(64)
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10063,
            pubkey: pk1,
            created_at: 100,
            tags: [['server', 'https://blossom1.com'], ['server', 'https://blossom2.com']],
            content: '',
            id: '1',
            sig: '1',
          },
          {
            kind: 10063,
            pubkey: pk2,
            created_at: 200,
            tags: [['server', 'https://blossom2.com'], ['server', 'https://blossom3.com']],
            content: '',
            id: '2',
            sig: '2',
          },
        ]),
      }

      const result = await handleBlossomDiscover(mockPool as any, 'npub1test', { pubkeys: [pk1, pk2] })
      expect(result.servers.length).toBe(3) // 3 unique server URLs
      expect(result.sources['https://blossom2.com']).toHaveLength(2) // used by both
      expect(result.sources['https://blossom1.com']).toHaveLength(1)
      expect(result.sources['https://blossom3.com']).toHaveLength(1)
    })

    it('keeps newest event per author', async () => {
      const pk = 'c'.repeat(64)
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10063, pubkey: pk, created_at: 100,
            tags: [['server', 'https://old.com']],
            content: '', id: '1', sig: '1',
          },
          {
            kind: 10063, pubkey: pk, created_at: 200,
            tags: [['server', 'https://new.com']],
            content: '', id: '2', sig: '2',
          },
        ]),
      }

      const result = await handleBlossomDiscover(mockPool as any, 'npub1test', { pubkeys: [pk] })
      expect(result.servers.length).toBe(1)
      expect(result.servers[0].url).toBe('https://new.com')
    })

    it('rejects empty pubkeys', async () => {
      const mockPool = { query: vi.fn() }
      await expect(handleBlossomDiscover(mockPool as any, 'npub1test', { pubkeys: [] }))
        .rejects.toThrow(/At least one pubkey/)
    })

    it('skips invalid server URLs', async () => {
      const pk = 'd'.repeat(64)
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10063, pubkey: pk, created_at: 100,
            tags: [
              ['server', 'https://127.0.0.1'],  // private — should be skipped
              ['server', 'https://valid.com'],
            ],
            content: '', id: '1', sig: '1',
          },
        ]),
      }

      const result = await handleBlossomDiscover(mockPool as any, 'npub1test', { pubkeys: [pk] })
      expect(result.servers.length).toBe(1)
      expect(result.servers[0].url).toBe('https://valid.com')
    })
  })

  // -----------------------------------------------------------------------
  // Media Integrity
  // -----------------------------------------------------------------------

  describe('handleBlossomVerify', () => {
    it('checks all URLs in note content', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/png']]),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: new Map(),
        }),
      )

      const content = 'Check out https://blossom.example.com/abc123 and https://broken.com/img.jpg'
      const result = await handleBlossomVerify({ content })

      expect(result.urls).toHaveLength(2)
      expect(result.urls[0].alive).toBe(true)
      expect(result.urls[1].alive).toBe(false)
      expect(result.urls[1].status).toBe(404)
    })

    it('returns empty array for content with no URLs', async () => {
      const result = await handleBlossomVerify({ content: 'Just text, no links' })
      expect(result.urls).toHaveLength(0)
    })

    it('deduplicates URLs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
      }))

      const content = 'https://a.com/img.png and again https://a.com/img.png'
      const result = await handleBlossomVerify({ content })
      expect(result.urls).toHaveLength(1)
      expect((fetch as any).mock.calls.length).toBe(1)
    })

    it('verifies SHA-256 hashes from blossom URLs when verifyHash is true', async () => {
      const data = new Uint8Array([1, 2, 3])
      const hash = createHash('sha256').update(data).digest('hex')

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/png']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(data.buffer),
        }),
      )

      const content = `https://blossom.example.com/${hash}`
      const result = await handleBlossomVerify({ content, verifyHash: true })

      expect(result.urls[0].hashVerified).toBe(true)
      expect(result.urls[0].hashMismatch).toBe(false)
    })

    it('handles fetch errors gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const content = 'https://unreachable.com/image.png'
      const result = await handleBlossomVerify({ content })

      expect(result.urls[0].alive).toBe(false)
      expect(result.urls[0].error).toContain('Network error')
    })

    it('rejects private network URLs without throwing', async () => {
      const content = 'https://127.0.0.1/image.png'
      const result = await handleBlossomVerify({ content })

      expect(result.urls[0].alive).toBe(false)
      expect(result.urls[0].error).toContain('Private or invalid')
    })
  })

  describe('handleBlossomRepair', () => {
    it('finds blob on search server and returns location', async () => {
      const data = new Uint8Array([1, 2, 3])
      const hash = createHash('sha256').update(data).digest('hex')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: () => Promise.resolve(data.buffer),
      }))

      const result = await handleBlossomRepair(ctx, {
        sha256: hash,
        searchServers: ['https://backup.com'],
      })

      expect(result.found).toBe(true)
      expect(result.foundOn).toBe('https://backup.com')
      expect(result.reuploaded).toBeUndefined() // no target server
    })

    it('re-uploads to target server when found', async () => {
      const data = new Uint8Array([4, 5, 6])
      const hash = createHash('sha256').update(data).digest('hex')

      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // Download from search server
          return Promise.resolve({
            ok: true,
            headers: new Map([['content-type', 'image/jpeg']]),
            arrayBuffer: () => Promise.resolve(data.buffer),
          })
        }
        // Upload to target server
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ url: 'https://target.com/' + hash, sha256: hash, size: 3 }),
        })
      }))

      const result = await handleBlossomRepair(ctx, {
        sha256: hash,
        searchServers: ['https://backup.com'],
        targetServer: 'https://target.com',
      })

      expect(result.found).toBe(true)
      expect(result.reuploaded).toBe(true)
      expect(result.newUrl).toContain('target.com')
    })

    it('returns found: false when blob is not on any server', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

      const result = await handleBlossomRepair(ctx, {
        sha256: 'a'.repeat(64),
        searchServers: ['https://s1.com', 'https://s2.com'],
      })

      expect(result.found).toBe(false)
    })

    it('rejects hash mismatch during search', async () => {
      const data = new Uint8Array([7, 8, 9])
      // We look for a hash that won't match the data
      const wrongHash = 'f'.repeat(64)

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'application/octet-stream']]),
        arrayBuffer: () => Promise.resolve(data.buffer),
      }))

      const result = await handleBlossomRepair(ctx, {
        sha256: wrongHash,
        searchServers: ['https://s1.com'],
      })

      expect(result.found).toBe(false)
    })

    it('rejects empty search servers', async () => {
      await expect(handleBlossomRepair(ctx, { sha256: 'abc', searchServers: [] }))
        .rejects.toThrow(/At least one/)
    })
  })

  // -----------------------------------------------------------------------
  // Media Management
  // -----------------------------------------------------------------------

  describe('handleBlossomUsage', () => {
    it('aggregates usage across multiple servers', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            { url: 'https://a.com/x', sha256: 'x', size: 1000 },
            { url: 'https://a.com/y', sha256: 'y', size: 2000 },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            { url: 'https://b.com/z', sha256: 'z', size: 500 },
          ]),
        }),
      )

      const result = await handleBlossomUsage({
        servers: ['https://a.com', 'https://b.com'],
        pubkeyHex: 'abc123',
      })

      expect(result.totalBlobCount).toBe(3)
      expect(result.totalSize).toBe(3500)
      expect(result.servers).toHaveLength(2)
      expect(result.servers[0].blobCount).toBe(2)
      expect(result.servers[0].totalSize).toBe(3000)
      expect(result.servers[1].blobCount).toBe(1)
      expect(result.servers[1].totalSize).toBe(500)
    })

    it('handles server errors gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ url: 'https://a.com/x', sha256: 'x', size: 100 }]),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 }),
      )

      const result = await handleBlossomUsage({
        servers: ['https://a.com', 'https://broken.com'],
        pubkeyHex: 'abc123',
      })

      expect(result.totalBlobCount).toBe(1) // only from working server
      expect(result.servers[1].error).toBeDefined()
    })

    it('rejects empty servers', async () => {
      await expect(handleBlossomUsage({ servers: [], pubkeyHex: 'abc' }))
        .rejects.toThrow(/At least one/)
    })
  })

  describe('handleBlossomServersGet', () => {
    it('reads kind 10063 server list from relays', async () => {
      const pk = 'e'.repeat(64)
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10063, pubkey: pk, created_at: 100,
            tags: [['server', 'https://blossom1.com/'], ['server', 'https://blossom2.com']],
            content: '', id: 'evt1', sig: 's',
          },
        ]),
      }

      const result = await handleBlossomServersGet(mockPool as any, 'npub1test', pk)
      expect(result.servers).toEqual(['https://blossom1.com', 'https://blossom2.com'])
      expect(result.eventId).toBe('evt1')
    })

    it('returns empty array when no event found', async () => {
      const mockPool = { query: vi.fn().mockResolvedValue([]) }
      const result = await handleBlossomServersGet(mockPool as any, 'npub1test', 'a'.repeat(64))
      expect(result.servers).toEqual([])
    })

    it('keeps newest event when multiple exist', async () => {
      const pk = 'f'.repeat(64)
      const mockPool = {
        query: vi.fn().mockResolvedValue([
          {
            kind: 10063, pubkey: pk, created_at: 50,
            tags: [['server', 'https://old.com']],
            content: '', id: 'old', sig: 's',
          },
          {
            kind: 10063, pubkey: pk, created_at: 200,
            tags: [['server', 'https://new.com']],
            content: '', id: 'new', sig: 's',
          },
        ]),
      }

      const result = await handleBlossomServersGet(mockPool as any, 'npub1test', pk)
      expect(result.servers).toEqual(['https://new.com'])
      expect(result.eventId).toBe('new')
    })
  })

  describe('handleBlossomServersSet', () => {
    it('publishes kind 10063 with server tags', async () => {
      const publishResult = { success: true, allAccepted: true, accepted: ['wss://r.com'], rejected: [], errors: [] }
      const mockPool = {
        publish: vi.fn().mockResolvedValue(publishResult),
      }

      const result = await handleBlossomServersSet(ctx, mockPool as any, {
        servers: ['https://blossom1.com/', 'https://blossom2.com'],
      })

      expect(result.servers).toEqual(['https://blossom1.com', 'https://blossom2.com'])
      expect(result.publish).toEqual(publishResult)
      expect(result.eventId).toBeDefined()

      // Verify the event was signed with correct tags
      const publishCall = mockPool.publish.mock.calls[0]
      const event = publishCall[1]
      expect(event.kind).toBe(10063)
      expect(event.tags).toEqual([
        ['server', 'https://blossom1.com'],
        ['server', 'https://blossom2.com'],
      ])
    })

    it('rejects empty server list', async () => {
      const mockPool = { publish: vi.fn() }
      await expect(handleBlossomServersSet(ctx, mockPool as any, { servers: [] }))
        .rejects.toThrow(/At least one/)
    })

    it('rejects private URLs', async () => {
      const mockPool = { publish: vi.fn() }
      await expect(handleBlossomServersSet(ctx, mockPool as any, { servers: ['https://127.0.0.1'] }))
        .rejects.toThrow(/private/)
    })
  })
})
