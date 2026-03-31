import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validatePublicUrl } from '../validation.js'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type?: string
  uploaded?: number
}

/** Upload a file to a blossom media server */
export async function handleBlossomUpload(
  ctx: SigningContext,
  args: { server: string; filePath?: string; data?: Uint8Array; contentType?: string },
): Promise<BlobDescriptor> {
  validatePublicUrl(args.server)
  const MAX_UPLOAD = 100 * 1024 * 1024 // 100MB

  let body: Uint8Array
  if (args.filePath) {
    const size = statSync(args.filePath).size
    if (size > MAX_UPLOAD) throw new Error(`File too large: ${size} bytes (max ${MAX_UPLOAD})`)
    body = readFileSync(args.filePath)
  } else if (args.data) {
    body = args.data
  } else {
    throw new Error('Either filePath or data is required')
  }

  const sha256 = createHash('sha256').update(body).digest('hex')
  const now = Math.floor(Date.now() / 1000)

  // Create blossom auth event (kind 24242)
  const sign = ctx.getSigningFunction()
  const authEvent = await sign({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(now + 300)],
    ],
    content: '',
  })

  const authHeader = `Nostr ${Buffer.from(JSON.stringify(authEvent)).toString('base64')}`
  const serverUrl = args.server.replace(/\/$/, '')

  const response = await fetch(`${serverUrl}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': args.contentType ?? 'application/octet-stream',
    },
    body: Buffer.from(body),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Blossom upload failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<BlobDescriptor>
}

/** List blobs for a pubkey on a blossom server */
export async function handleBlossomList(
  args: { server: string; pubkeyHex: string },
): Promise<BlobDescriptor[]> {
  validatePublicUrl(args.server)
  const serverUrl = args.server.replace(/\/$/, '')
  const response = await fetch(`${serverUrl}/list/${args.pubkeyHex}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) throw new Error(`Blossom list failed: ${response.status}`)
  return response.json() as Promise<BlobDescriptor[]>
}

/** Download a blob by hash from a blossom server */
export async function handleBlossomDownload(
  args: { server: string; sha256: string },
): Promise<{ data: Uint8Array; contentType: string }> {
  validatePublicUrl(args.server)
  const serverUrl = args.server.replace(/\/$/, '')
  const response = await fetch(`${serverUrl}/${args.sha256}`, {
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`Blossom download failed: ${response.status}`)
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const data = new Uint8Array(await response.arrayBuffer())
  return { data, contentType }
}

/** Delete a blob from a blossom server */
export async function handleBlossomDelete(
  ctx: SigningContext,
  args: { server: string; sha256: string },
): Promise<{ deleted: boolean }> {
  validatePublicUrl(args.server)
  const now = Math.floor(Date.now() / 1000)
  const sign = ctx.getSigningFunction()
  const authEvent = await sign({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'delete'],
      ['x', args.sha256],
      ['expiration', String(now + 300)],
    ],
    content: '',
  })

  const authHeader = `Nostr ${Buffer.from(JSON.stringify(authEvent)).toString('base64')}`
  const serverUrl = args.server.replace(/\/$/, '')

  const response = await fetch(`${serverUrl}/${args.sha256}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader },
    signal: AbortSignal.timeout(10_000),
  })

  return { deleted: response.ok }
}

// ---------------------------------------------------------------------------
// Media Redundancy
// ---------------------------------------------------------------------------

export interface MirrorServerResult {
  server: string
  success: boolean
  url?: string
  error?: string
}

export interface MirrorResult {
  sha256: string
  size: number
  servers: MirrorServerResult[]
}

/**
 * Upload content to multiple blossom servers for redundancy.
 * Accepts either a source URL (fetches from an existing blossom server) or raw data/filePath.
 */
export async function handleBlossomMirror(
  ctx: SigningContext,
  args: {
    servers: string[]
    sourceUrl?: string
    filePath?: string
    data?: Uint8Array
    contentType?: string
  },
): Promise<MirrorResult> {
  if (args.servers.length === 0) throw new Error('At least one target server is required')
  if (args.servers.length > 10) throw new Error('Maximum 10 target servers per mirror operation')

  for (const s of args.servers) validatePublicUrl(s)

  // Resolve the data to mirror
  let body: Uint8Array
  let contentType = args.contentType ?? 'application/octet-stream'

  if (args.sourceUrl) {
    validatePublicUrl(args.sourceUrl)
    const resp = await fetch(args.sourceUrl, { signal: AbortSignal.timeout(30_000) })
    if (!resp.ok) throw new Error(`Failed to fetch source: ${resp.status}`)
    contentType = resp.headers.get('content-type') ?? contentType
    body = new Uint8Array(await resp.arrayBuffer())
  } else if (args.filePath) {
    const MAX_UPLOAD = 100 * 1024 * 1024
    const size = statSync(args.filePath).size
    if (size > MAX_UPLOAD) throw new Error(`File too large: ${size} bytes (max ${MAX_UPLOAD})`)
    body = readFileSync(args.filePath)
  } else if (args.data) {
    body = args.data
  } else {
    throw new Error('One of sourceUrl, filePath, or data is required')
  }

  // Compute hash ourselves — never trust external claims
  const sha256 = createHash('sha256').update(body).digest('hex')

  // Upload to all servers in parallel
  const results = await Promise.all(
    args.servers.map(async (server): Promise<MirrorServerResult> => {
      try {
        const blob = await handleBlossomUpload(ctx, { server, data: body, contentType })
        return { server, success: true, url: blob.url }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { server, success: false, error: message }
      }
    }),
  )

  return { sha256, size: body.length, servers: results }
}

export interface CheckResult {
  server: string
  sha256: string
  exists: boolean
  size?: number
  contentType?: string
  hashVerified?: boolean
  hashMismatch?: boolean
}

/** Check whether a blob exists and is intact on a blossom server */
export async function handleBlossomCheck(
  args: { server: string; sha256: string; verify?: boolean },
): Promise<CheckResult> {
  validatePublicUrl(args.server)
  const serverUrl = args.server.replace(/\/$/, '')
  const url = `${serverUrl}/${args.sha256}`

  // HEAD request to check existence
  const headResp = await fetch(url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  })

  if (!headResp.ok) {
    return { server: args.server, sha256: args.sha256, exists: false }
  }

  const contentLength = headResp.headers.get('content-length')
  const contentType = headResp.headers.get('content-type') ?? undefined
  const result: CheckResult = {
    server: args.server,
    sha256: args.sha256,
    exists: true,
    size: contentLength ? parseInt(contentLength, 10) : undefined,
    contentType,
  }

  // Optionally download and verify hash
  if (args.verify) {
    const getResp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (getResp.ok) {
      const data = new Uint8Array(await getResp.arrayBuffer())
      const actualHash = createHash('sha256').update(data).digest('hex')
      result.hashVerified = actualHash === args.sha256
      result.hashMismatch = actualHash !== args.sha256
    }
  }

  return result
}

export interface ServerInfo {
  url: string
  pubkey: string
}

/**
 * Discover blossom servers from contacts' kind 10063 (NIP-B7 server list) events.
 * Aggregates unique server URLs across all contacts.
 */
export async function handleBlossomDiscover(
  pool: RelayPool,
  npub: string,
  args: { pubkeys?: string[] },
): Promise<{ servers: ServerInfo[]; sources: Record<string, string[]> }> {
  const authors = args.pubkeys ?? []
  if (authors.length === 0) throw new Error('At least one pubkey is required (pass contact pubkeys)')

  // Fetch kind 10063 events from relays
  const events = await pool.query(npub, {
    kinds: [10063],
    authors,
  })

  // Keep newest per author
  const best = new Map<string, import('nostr-tools').Event>()
  for (const ev of events) {
    const prev = best.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) {
      best.set(ev.pubkey, ev)
    }
  }

  // Extract server URLs from 'server' tags (NIP-B7 / BUD-03)
  const serverSet = new Map<string, Set<string>>() // url -> set of pubkeys using it
  for (const [pubkey, ev] of best) {
    for (const tag of ev.tags) {
      if (tag[0] === 'server' && tag[1]) {
        const url = tag[1].replace(/\/$/, '')
        try {
          validatePublicUrl(url)
          if (!serverSet.has(url)) serverSet.set(url, new Set())
          serverSet.get(url)!.add(pubkey)
        } catch { /* skip invalid URLs */ }
      }
    }
  }

  const servers: ServerInfo[] = []
  const sources: Record<string, string[]> = {}
  for (const [url, pubkeys] of serverSet) {
    for (const pk of pubkeys) {
      servers.push({ url, pubkey: pk })
    }
    sources[url] = [...pubkeys]
  }

  // Deduplicate servers list by URL
  const seen = new Set<string>()
  const uniqueServers = servers.filter(s => {
    if (seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })

  return { servers: uniqueServers, sources }
}

// ---------------------------------------------------------------------------
// Media Integrity
// ---------------------------------------------------------------------------

/** Regex to extract URLs from note content */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

export interface MediaUrlStatus {
  url: string
  alive: boolean
  status?: number
  contentType?: string
  hashVerified?: boolean
  hashMismatch?: boolean
  error?: string
}

/**
 * Verify all media URLs in a note's content are still accessible.
 * Optionally verifies SHA-256 hashes if they can be extracted from the URL path.
 */
export async function handleBlossomVerify(
  args: { content: string; verifyHash?: boolean },
): Promise<{ urls: MediaUrlStatus[] }> {
  const urls = args.content.match(URL_REGEX) ?? []
  if (urls.length === 0) return { urls: [] }

  // Deduplicate
  const unique = [...new Set(urls)]

  const results = await Promise.all(
    unique.map(async (url): Promise<MediaUrlStatus> => {
      try {
        // Validate URL safety
        try {
          validatePublicUrl(url)
        } catch {
          return { url, alive: false, error: 'Private or invalid URL' }
        }

        const resp = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
        })

        const result: MediaUrlStatus = {
          url,
          alive: resp.ok,
          status: resp.status,
          contentType: resp.headers.get('content-type') ?? undefined,
        }

        // If hash verification requested, try to extract SHA-256 from URL path
        if (args.verifyHash && resp.ok) {
          const hashMatch = url.match(/\/([0-9a-f]{64})(?:\.[a-z]+)?(?:\?|$)/i)
          if (hashMatch) {
            const expectedHash = hashMatch[1].toLowerCase()
            const getResp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
            if (getResp.ok) {
              const data = new Uint8Array(await getResp.arrayBuffer())
              const actualHash = createHash('sha256').update(data).digest('hex')
              result.hashVerified = actualHash === expectedHash
              result.hashMismatch = actualHash !== expectedHash
            }
          }
        }

        return result
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { url, alive: false, error: message }
      }
    }),
  )

  return { urls: results }
}

export interface RepairResult {
  sha256: string
  found: boolean
  foundOn?: string
  reuploaded?: boolean
  reuploadedTo?: string
  newUrl?: string
  error?: string
}

/**
 * For a broken blob, search other blossom servers by SHA-256 hash and optionally
 * re-upload to the target server.
 */
export async function handleBlossomRepair(
  ctx: SigningContext,
  args: {
    sha256: string
    searchServers: string[]
    targetServer?: string
  },
): Promise<RepairResult> {
  if (args.searchServers.length === 0) throw new Error('At least one search server is required')
  if (args.searchServers.length > 20) throw new Error('Maximum 20 search servers')

  for (const s of args.searchServers) validatePublicUrl(s)
  if (args.targetServer) validatePublicUrl(args.targetServer)

  // Search each server for the blob
  let foundData: Uint8Array | undefined
  let foundOn: string | undefined
  let foundContentType = 'application/octet-stream'

  for (const server of args.searchServers) {
    try {
      const result = await handleBlossomDownload({ server, sha256: args.sha256 })
      // Verify hash ourselves
      const actualHash = createHash('sha256').update(result.data).digest('hex')
      if (actualHash === args.sha256) {
        foundData = result.data
        foundOn = server
        foundContentType = result.contentType
        break
      }
    } catch { /* server doesn't have it or download failed */ }
  }

  if (!foundData || !foundOn) {
    return { sha256: args.sha256, found: false }
  }

  // If no target server, just report where we found it
  if (!args.targetServer) {
    return { sha256: args.sha256, found: true, foundOn }
  }

  // Re-upload to target server
  try {
    const blob = await handleBlossomUpload(ctx, {
      server: args.targetServer,
      data: foundData,
      contentType: foundContentType,
    })
    return {
      sha256: args.sha256,
      found: true,
      foundOn,
      reuploaded: true,
      reuploadedTo: args.targetServer,
      newUrl: blob.url,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      sha256: args.sha256,
      found: true,
      foundOn,
      reuploaded: false,
      reuploadedTo: args.targetServer,
      error: message,
    }
  }
}

// ---------------------------------------------------------------------------
// Media Management
// ---------------------------------------------------------------------------

export interface ServerUsage {
  server: string
  blobCount: number
  totalSize: number
  error?: string
}

export interface UsageResult {
  pubkeyHex: string
  totalBlobCount: number
  totalSize: number
  servers: ServerUsage[]
}

/** Check storage usage across multiple blossom servers for a pubkey */
export async function handleBlossomUsage(
  args: { servers: string[]; pubkeyHex: string },
): Promise<UsageResult> {
  if (args.servers.length === 0) throw new Error('At least one server is required')
  if (args.servers.length > 20) throw new Error('Maximum 20 servers')

  const serverResults = await Promise.all(
    args.servers.map(async (server): Promise<ServerUsage> => {
      try {
        const blobs = await handleBlossomList({ server, pubkeyHex: args.pubkeyHex })
        const totalSize = blobs.reduce((sum, b) => sum + (b.size ?? 0), 0)
        return { server, blobCount: blobs.length, totalSize }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { server, blobCount: 0, totalSize: 0, error: message }
      }
    }),
  )

  const totalBlobCount = serverResults.reduce((sum, s) => sum + s.blobCount, 0)
  const totalSize = serverResults.reduce((sum, s) => sum + s.totalSize, 0)

  return {
    pubkeyHex: args.pubkeyHex,
    totalBlobCount,
    totalSize,
    servers: serverResults,
  }
}

export interface ServerListResult {
  servers: string[]
  eventId?: string
  publish?: PublishResult
}

/** Read the active identity's kind 10063 blossom server list from relays */
export async function handleBlossomServersGet(
  pool: RelayPool,
  npub: string,
  pubkeyHex: string,
): Promise<ServerListResult> {
  const events = await pool.query(npub, {
    kinds: [10063],
    authors: [pubkeyHex],
  })

  if (events.length === 0) return { servers: [] }

  const best = events.reduce((a, b) => b.created_at > a.created_at ? b : a)

  const servers = best.tags
    .filter(t => t[0] === 'server' && t[1])
    .map(t => t[1].replace(/\/$/, ''))

  return { servers, eventId: best.id }
}

/** Publish a kind 10063 blossom server list event */
export async function handleBlossomServersSet(
  ctx: SigningContext,
  pool: RelayPool,
  args: { servers: string[] },
): Promise<ServerListResult> {
  if (args.servers.length === 0) throw new Error('At least one server URL is required')
  if (args.servers.length > 20) throw new Error('Maximum 20 servers')

  for (const s of args.servers) validatePublicUrl(s)

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 10063,
    created_at: Math.floor(Date.now() / 1000),
    tags: args.servers.map(s => ['server', s.replace(/\/$/, '')]),
    content: '',
  })

  const publish = await pool.publish(ctx.activeNpub, event)

  return {
    servers: args.servers.map(s => s.replace(/\/$/, '')),
    eventId: event.id,
    publish,
  }
}
