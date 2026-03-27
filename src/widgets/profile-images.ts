/**
 * Server-side profile image fetching + data:URI conversion.
 *
 * CSP in the widget iframe blocks external images, so we fetch them
 * server-side and inline as data: URIs in the tool response payload.
 */

const MAX_SIZE = 500_000 // 500KB — SSRF protection
const FETCH_TIMEOUT_MS = 3_000
const CACHE_TTL_MS = 600_000 // 10 minutes
const MAX_PARALLEL = 20

export const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="24" fill="#666"/></svg>',
)}`

interface CacheEntry {
  dataUri: string
  expires: number
}

const cache = new Map<string, CacheEntry>()

export function clearCache(): void {
  cache.clear()
}

export function evictExpired(): number {
  const now = Date.now()
  let evicted = 0
  for (const [url, entry] of cache) {
    if (entry.expires <= now) {
      cache.delete(url)
      evicted++
    }
  }
  return evicted
}

export async function fetchProfileImage(url: string): Promise<string> {
  if (!url) return PLACEHOLDER_SVG

  // Check cache
  const cached = cache.get(url)
  if (cached && cached.expires > Date.now()) {
    return cached.dataUri
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual', // no redirect following
    })
    clearTimeout(timeout)

    if (!res.ok) return PLACEHOLDER_SVG

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return PLACEHOLDER_SVG

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_SIZE) return PLACEHOLDER_SVG

    const dataUri = `data:${contentType};base64,${buf.toString('base64')}`

    // Cache the result
    cache.set(url, { dataUri, expires: Date.now() + CACHE_TTL_MS })

    return dataUri
  } catch {
    return PLACEHOLDER_SVG
  }
}

export async function batchFetchProfileImages(
  urls: string[],
  maxParallel = MAX_PARALLEL,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const unique = [...new Set(urls.filter(Boolean))]

  // Process in batches of maxParallel
  for (let i = 0; i < unique.length; i += maxParallel) {
    const batch = unique.slice(i, i + maxParallel)
    const fetched = await Promise.all(batch.map(u => fetchProfileImage(u)))
    for (let j = 0; j < batch.length; j++) {
      result.set(batch[j], fetched[j])
    }
  }

  return result
}
