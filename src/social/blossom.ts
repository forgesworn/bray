import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type?: string
  uploaded?: number
}

/** Upload a file to a blossom media server */
export async function handleBlossomUpload(
  ctx: IdentityContext,
  args: { server: string; filePath?: string; data?: Uint8Array; contentType?: string },
): Promise<BlobDescriptor> {
  let body: Uint8Array
  if (args.filePath) {
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
  ctx: IdentityContext,
  args: { server: string; sha256: string },
): Promise<{ deleted: boolean }> {
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
