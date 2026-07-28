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

/** Method names defined by NIP-86, plus widely-implemented extensions. */
export type AdminMethod =
  // discovery
  | 'supportedmethods'
  // pubkeys
  | 'allowpubkey'
  | 'unallowpubkey'
  | 'banpubkey'
  | 'unbanpubkey'
  | 'listallowedpubkeys'
  | 'listbannedpubkeys'
  // kinds
  | 'allowkind'
  | 'disallowkind'
  | 'listallowedkinds'
  // events
  | 'allowevent'
  | 'banevent'
  | 'listbannedevents'
  | 'listeventsneedingmoderation'
  // relay metadata
  | 'changerelayname'
  | 'changerelaydescription'
  | 'changerelayicon'
  // roles and admins
  | 'createrole'
  | 'editrole'
  | 'deleterole'
  | 'assignrole'
  | 'unassignrole'
  | 'grantadmin'
  | 'revokeadmin'
  // IPs
  | 'blockip'
  | 'unblockip'
  | 'listblockedips'
  // non-spec extension, implemented by nak and some relays
  | 'listdisallowedkinds'

/**
 * Legacy bray subcommand names retained as aliases.
 *
 * `bankind` and `listbannedkinds` were never NIP-86 method names, so requests
 * using them were rejected by spec-compliant relays. They are still accepted as
 * input and rewritten to the correct wire method.
 */
export const ADMIN_METHOD_ALIASES: Record<string, AdminMethod> = {
  bankind: 'disallowkind',
  listbannedkinds: 'listdisallowedkinds',
}

/**
 * Positions (zero-indexed) whose parameter is a number rather than a string.
 *
 * Everything else is passed through verbatim. Blanket numeric coercion is
 * unsafe here because an all-digit 64-character pubkey would be mangled by
 * `Number()`.
 */
const NUMERIC_PARAM_POSITIONS: Partial<Record<AdminMethod, number[]>> = {
  allowkind: [0],
  disallowkind: [0],
  createrole: [4],
  editrole: [4],
}

/** Resolve a user-supplied method name to its NIP-86 wire name. */
export function resolveAdminMethod(method: string): AdminMethod {
  return ADMIN_METHOD_ALIASES[method] ?? (method as AdminMethod)
}

/** Coerce the parameters a given method expects as numbers, leaving the rest alone. */
export function coerceAdminParams(
  method: AdminMethod,
  params: Array<string | number>,
): Array<string | number> {
  const numeric = NUMERIC_PARAM_POSITIONS[method]
  if (!numeric) return params
  return params.map((p, i) => {
    if (!numeric.includes(i) || typeof p === 'number') return p
    const n = Number(p)
    if (!Number.isFinite(n)) throw new Error(`${method}: parameter ${i + 1} must be a number, got "${p}"`)
    return n
  })
}

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

  // Rewrite legacy aliases so SDK callers get the spec method name on the wire too
  const method = resolveAdminMethod(opts.method)

  const body = JSON.stringify({
    method,
    params: coerceAdminParams(method, opts.params ?? []),
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
    method,
    result: json.result,
  }
}
