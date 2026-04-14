/**
 * Admin — NIP-86 relay management API.
 *
 * NIP-86 defines an HTTP management API for relay operators. Requests are POST to the
 * relay's HTTP URL with a NIP-98 `Authorization: Nostr <base64(event)>` header.
 *
 * Reference: https://github.com/nostr-protocol/nips/blob/master/86.md
 */

import type { SigningContext } from '../signing-context.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminMethod =
  | 'allowpubkey'
  | 'banpubkey'
  | 'listallowedpubkeys'
  | 'listbannedpubkeys'
  | 'allowkind'
  | 'bankind'
  | 'listallowedkinds'
  | 'listbannedkinds'
  | 'blockip'
  | 'unblockip'
  | 'listblockedips'

export interface AdminCallOptions {
  /** Relay HTTP URL (e.g. https://relay.example.com) */
  relay: string
  /** NIP-86 method name */
  method: AdminMethod
  /** Method parameters (pubkey hex, kind number, IP address, etc.) */
  params?: Array<string | number>
}

export interface AdminResult {
  relay: string
  method: AdminMethod
  result: unknown
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a NIP-98 HTTP Auth header value for the given URL and HTTP method.
 *
 * Produces a signed kind 27235 event and returns the
 * `Nostr <base64url(JSON)>` string ready for the Authorization header.
 */
async function buildNip98Header(
  ctx: SigningContext,
  url: string,
  httpMethod: string,
  payloadHash?: string,
): Promise<string> {
  const sign = ctx.getSigningFunction()
  const tags: string[][] = [
    ['u', url],
    ['method', httpMethod.toUpperCase()],
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
 * Call a NIP-86 relay management method.
 *
 * @param ctx - Signing context used to produce the NIP-98 auth event
 * @param opts - Target relay URL, method name, and optional parameters
 */
export async function handleAdminCall(
  ctx: SigningContext,
  opts: AdminCallOptions,
): Promise<AdminResult> {
  // NIP-86 always POSTs to the relay root URL
  const url = opts.relay.replace(/\/$/, '')

  const body = JSON.stringify({
    method: opts.method,
    params: opts.params ?? [],
  })

  // Hash the request body for the NIP-98 payload tag (SHA-256 hex)
  const { createHash } = await import('node:crypto')
  const payloadHash = createHash('sha256').update(body, 'utf-8').digest('hex')

  const authHeader = await buildNip98Header(ctx, url, 'POST', payloadHash)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/nostr+json+rpc',
      'Authorization': authHeader,
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Admin call failed: HTTP ${response.status} — ${text}`)
  }

  const json = await response.json() as { result?: unknown; error?: string }
  if (json.error) throw new Error(`Relay error: ${json.error}`)

  return {
    relay: opts.relay,
    method: opts.method,
    result: json.result,
  }
}
