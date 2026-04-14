/**
 * relay curl — lightweight HTTP client for Nostr relay HTTP endpoints.
 *
 * Covers NIP-11 info, NIP-86 management, and any custom relay HTTP endpoints.
 * The optional --auth flag adds a NIP-98 Authorization header.
 */

import type { SigningContext } from '../signing-context.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RelayCurlOptions {
  /** Base relay URL (wss:// is converted to https://, ws:// to http://) */
  relay: string
  /** URL path to append (default: '/') */
  path?: string
  /** HTTP method (default: 'GET') */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Request body as a JSON string (for POST/PUT) */
  body?: string
  /** If true, attach a NIP-98 Authorization header */
  auth?: boolean
}

export interface RelayCurlResult {
  url: string
  status: number
  headers: Record<string, string>
  body: unknown
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert a WebSocket relay URL to its HTTP equivalent. */
function toHttpUrl(relay: string, path?: string): string {
  const base = relay
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '')
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '/'
  return `${base}${suffix}`
}

/** Build a NIP-98 Authorization header for the given URL and HTTP method. */
async function buildNip98Header(
  ctx: SigningContext,
  url: string,
  method: string,
  payloadHash?: string,
): Promise<string> {
  const sign = ctx.getSigningFunction()
  const tags: string[][] = [
    ['u', url],
    ['method', method.toUpperCase()],
  ]
  if (payloadHash) tags.push(['payload', payloadHash])

  const event = await sign({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })

  const encoded = Buffer.from(JSON.stringify(event), 'utf-8').toString('base64')
  return `Nostr ${encoded}`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Make an HTTP request to a relay endpoint.
 *
 * @param ctx - Signing context (required only when `opts.auth` is true)
 * @param opts - Request options
 */
export async function handleRelayCurl(
  ctx: SigningContext | null,
  opts: RelayCurlOptions,
): Promise<RelayCurlResult> {
  const method = opts.method ?? 'GET'
  const url = toHttpUrl(opts.relay, opts.path)

  const headers: Record<string, string> = {
    'Accept': 'application/json, application/nostr+json, */*',
  }

  if (opts.body) {
    headers['Content-Type'] = 'application/json'
  }

  if (opts.auth) {
    if (!ctx) throw new Error('--auth requires an active signing context')
    let payloadHash: string | undefined
    if (opts.body) {
      const { createHash } = await import('node:crypto')
      payloadHash = createHash('sha256').update(opts.body, 'utf-8').digest('hex')
    }
    headers['Authorization'] = await buildNip98Header(ctx, url, method, payloadHash)
  }

  const response = await fetch(url, {
    method,
    headers,
    body: opts.body ?? undefined,
  })

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { responseHeaders[key] = value })

  const contentType = response.headers.get('content-type') ?? ''
  let body: unknown
  if (contentType.includes('json')) {
    body = await response.json().catch(() => null)
  } else {
    body = await response.text()
  }

  return {
    url,
    status: response.status,
    headers: responseHeaders,
    body,
  }
}
