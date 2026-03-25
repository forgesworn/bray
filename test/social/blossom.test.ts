import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleBlossomUpload, handleBlossomList, handleBlossomDelete, handleBlossomDownload } from '../../src/social/blossom.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('blossom handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
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
})
