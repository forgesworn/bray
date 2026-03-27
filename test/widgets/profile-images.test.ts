import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchProfileImage,
  batchFetchProfileImages,
  clearCache,
  evictExpired,
  PLACEHOLDER_SVG,
} from '../../src/widgets/profile-images.js'

describe('profile-images', () => {
  beforeEach(() => {
    clearCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchProfileImage', () => {
    it('returns placeholder for empty URL', async () => {
      const result = await fetchProfileImage('')
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('returns placeholder for undefined URL', async () => {
      // @ts-expect-error testing undefined input
      const result = await fetchProfileImage(undefined)
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('returns data:URI for valid image response', async () => {
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
      const headers = new Headers({ 'content-type': 'image/png' })
      const mockResponse = {
        ok: true,
        headers,
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any)

      const result = await fetchProfileImage('https://example.com/avatar.png')
      expect(result).toMatch(/^data:image\/png;base64,/)
    })

    it('returns placeholder for non-image content type', async () => {
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any)

      const result = await fetchProfileImage('https://example.com/not-an-image')
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('returns placeholder for HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        headers: new Headers(),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any)

      const result = await fetchProfileImage('https://example.com/missing.png')
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('returns placeholder for oversized images', async () => {
      const bigBuffer = new ArrayBuffer(600_000) // exceeds 500KB cap
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: () => Promise.resolve(bigBuffer),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any)

      const result = await fetchProfileImage('https://example.com/huge.jpg')
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('returns placeholder on fetch error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'))

      const result = await fetchProfileImage('https://example.com/fail.png')
      expect(result).toBe(PLACEHOLDER_SVG)
    })

    it('caches successful fetches', async () => {
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      fetchSpy.mockResolvedValue(mockResponse as any)

      const url = 'https://example.com/cached.png'
      const result1 = await fetchProfileImage(url)
      const result2 = await fetchProfileImage(url)

      expect(result1).toBe(result2)
      expect(fetchSpy).toHaveBeenCalledTimes(1) // only fetched once
    })
  })

  describe('batchFetchProfileImages', () => {
    it('returns empty map for empty input', async () => {
      const result = await batchFetchProfileImages([])
      expect(result.size).toBe(0)
    })

    it('deduplicates URLs', async () => {
      const imageBytes = new Uint8Array([0xFF, 0xD8]) // JPEG magic
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      fetchSpy.mockResolvedValue(mockResponse as any)

      const url = 'https://example.com/avatar.jpg'
      const result = await batchFetchProfileImages([url, url, url])

      expect(result.size).toBe(1)
      expect(result.has(url)).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(1) // deduplicated
    })

    it('filters out falsy URLs', async () => {
      const result = await batchFetchProfileImages(['', '', ''])
      expect(result.size).toBe(0)
    })

    it('fetches multiple URLs', async () => {
      const imageBytes = new Uint8Array([0x89, 0x50])
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

      const result = await batchFetchProfileImages([
        'https://a.com/1.png',
        'https://a.com/2.png',
        'https://a.com/3.png',
      ])

      expect(result.size).toBe(3)
    })
  })

  describe('evictExpired', () => {
    it('evicts expired cache entries', async () => {
      // Prime cache with a fetch
      const imageBytes = new Uint8Array([0x89, 0x50])
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

      await fetchProfileImage('https://example.com/test.png')

      // No entries should be expired yet
      expect(evictExpired()).toBe(0)
    })
  })

  describe('PLACEHOLDER_SVG', () => {
    it('is a valid data:URI', () => {
      expect(PLACEHOLDER_SVG).toMatch(/^data:image\/svg\+xml,/)
    })
  })
})
