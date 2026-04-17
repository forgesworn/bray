import { z } from 'zod'
import { resolve, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'

/** 64-character lowercase hex string (pubkey or event ID) */
export const hexId = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/** 128-character lowercase hex string (Schnorr signature) */
export const hexSig = z.string().regex(/^[0-9a-f]{128}$/, 'Must be a 128-character hex string')

/**
 * Minimal-shape Nostr event schema. Use this when accepting an external event
 * from tool inputs, decrypted payloads, or relay responses so that downstream
 * crypto calls (verifyEvent, validateAttestation, lsagVerify) do not receive
 * misshaped objects. Kind and timestamp are bounded to sane ranges.
 */
export const nostrEventSchema = z.object({
  id: hexId,
  pubkey: hexId,
  sig: hexSig,
  kind: z.number().int().min(0).max(65535),
  created_at: z.number().int().min(0).max(8640000000000),
  tags: z.array(z.array(z.string())),
  content: z.string(),
})

/** Relay WebSocket URL — wss:// or ws:// only */
export const relayUrl = z.string().regex(/^wss?:\/\//, 'Must be a wss:// or ws:// URL')

/** HTTPS URL — no private networks */
export const httpsUrl = z.string().regex(/^https?:\/\//, 'Must be an https:// URL')

/**
 * True if the URL points at a v2 (16-char) or v3 (56-char) Tor onion service.
 * Hostname is parsed and lowercased; trailing dot is tolerated. Returns false
 * on any URL parse failure or non-onion host.
 */
export function isOnionUrl(url: string): boolean {
  try {
    let host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('.')) host = host.slice(0, -1)
    return /^[a-z2-7]{16}\.onion$/.test(host) || /^[a-z2-7]{56}\.onion$/.test(host)
  } catch {
    return false
  }
}

/**
 * Build the default allowlist of directories that user-supplied file paths may
 * resolve to. The allowlist can be overridden via `BRAY_INPUT_DIRS` (colon or
 * semicolon separated) so operators in sandboxed environments can point at a
 * mounted credential directory, bind-mounted secret volume, etc.
 *
 * Default: current working directory + `~/.config/bray/inputs/`. These two
 * cover the common cases (CLI invocation in a project folder, long-lived
 * MCP server with dedicated input dir) without letting a hostile prompt
 * read arbitrary system files.
 */
export function getInputAllowlist(): string[] {
  const override = process.env.BRAY_INPUT_DIRS
  if (override) {
    return override
      .split(/[:;]/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => resolve(p))
  }
  const defaults = [process.cwd()]
  try {
    defaults.push(resolve(homedir(), '.config/bray/inputs'))
  } catch {
    // homedir can throw in pathological environments; fall through.
  }
  try {
    // Node's temp dir is a legitimate source for app-managed scratch files
    // (Shamir recovery pipelines write tmp shards here). Nothing sensitive
    // lives in /tmp by convention, so including it keeps the common case
    // working without widening the attack surface.
    defaults.push(resolve(tmpdir()))
  } catch {
    // tmpdir can fail in extremely locked-down environments; fall through.
  }
  return defaults
}

/**
 * Resolve and validate a user-supplied file path against the input allowlist.
 *
 * Canonicalises the path (resolves `..`, symlinks in the parent chain via
 * Node's path.resolve — not via fs.realpath to keep this synchronous) and
 * checks that it sits under one of the allowed directories. Throws on
 * traversal attempts, paths outside the allowlist, or obvious absolute
 * secrets paths on POSIX.
 *
 * Call this immediately before any `readFileSync`/`createReadStream` on a
 * path that came from tool input, CLI args, or a protocol message.
 */
export function validateInputPath(path: string, allowlist: string[] = getInputAllowlist()): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('File path must be a non-empty string')
  }
  if (path.length > 4096) {
    throw new Error('File path is too long')
  }
  // path.resolve handles `..` and produces an absolute path rooted at cwd.
  const absolute = resolve(path)
  const ok = allowlist.some(dir => {
    const base = dir.endsWith(sep) ? dir : dir + sep
    return absolute === dir || absolute.startsWith(base)
  })
  if (!ok) {
    throw new Error(
      `File path ${path} resolves outside the input allowlist. ` +
      `Allowed roots: ${allowlist.join(', ')}. ` +
      `Override with BRAY_INPUT_DIRS if this path is intentionally in use.`,
    )
  }
  return absolute
}

/**
 * Reject plaintext `ws://` to anywhere except a Tor onion service. Signed
 * events sent over unencrypted WebSocket leak content and recipient metadata
 * to anyone on path; onion services tunnel through Tor's own encryption so
 * plaintext WS inside is acceptable.
 *
 * Local development (BRAY_ALLOW_PRIVATE_RELAYS=1) bypasses this — the test
 * relay listens on `ws://localhost`. Callers that want that escape hatch
 * should pass `allowPrivate: true`.
 *
 * @throws if `ws://` and host is not a Tor onion service.
 */
export function validateRelayScheme(url: string, allowPrivate = false): void {
  if (!/^ws:\/\//i.test(url)) return
  if (isOnionUrl(url)) return
  if (allowPrivate) return
  throw new Error(
    `Plaintext ws:// is only permitted for .onion relays (set BRAY_ALLOW_PRIVATE_RELAYS=1 for local dev): ${url.slice(0, 128)}`,
  )
}

const PRIVATE_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.aws',
])

// IPv4 private ranges
const IPV4_PRIVATE_RANGES: RegExp[] = [
  /^0\./,                                       // 0.0.0.0/8 reserved
  /^10\./,                                      // RFC 1918
  /^127\./,                                     // loopback
  /^169\.254\./,                                // link-local
  /^172\.(1[6-9]|2\d|3[01])\./,                 // RFC 1918
  /^192\.168\./,                                // RFC 1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,   // 100.64.0.0/10 CGNAT
]

// IPv6 private / special ranges (checked after unbracketing + lowercasing)
const IPV6_PRIVATE_PATTERNS: RegExp[] = [
  /^::1$/,              // loopback
  /^::$/,               // unspecified
  /^::ffff:/,           // IPv4-mapped
  /^fc[0-9a-f]{2}:/,    // fc00::/7 ULA
  /^fd[0-9a-f]{2}:/,
  /^fe[89ab][0-9a-f]:/, // fe80::/10 link-local
]

function isDottedIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/**
 * Validate a URL is not pointing at private/internal networks.
 *
 * Covers: IPv4 loopback (127.0.0.0/8), RFC 1918 (10/8, 172.16/12, 192.168/16),
 * link-local (169.254/16), CGNAT (100.64/10), 0.0.0.0/8, IPv6 loopback (::1, ::),
 * IPv4-mapped IPv6 (::ffff:), IPv6 ULA (fc00::/7), IPv6 link-local (fe80::/10),
 * cloud metadata endpoints, *.local / *.internal / *.localhost reserved TLDs,
 * and integer/hex/octal-obfuscated hostnames that could resolve to private IPs.
 *
 * Does NOT perform DNS resolution — rebinding attacks remain possible if the
 * caller later fetches by hostname. Callers on sensitive paths should resolve
 * and revalidate, or bind to an explicit IP.
 */
export function validatePublicUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('URL is malformed')
  }

  let host = parsed.hostname.toLowerCase()
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

  if (!host) {
    throw new Error('URL has no hostname')
  }

  if (PRIVATE_HOSTS.has(host)) {
    throw new Error('URL must not point to private network addresses')
  }

  // Reserved / internal TLDs
  if (host === 'local' || host.endsWith('.local')
      || host === 'internal' || host.endsWith('.internal')
      || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('URL must not point to private network addresses')
  }

  // Reject integer-only (e.g. 2130706433 = 127.0.0.1) and hex/octal-prefixed
  // hostnames — these are ambiguous obfuscations of numeric IPs.
  if (/^\d+$/.test(host) || /(^|\.)(0x[0-9a-f]+|0[0-7]+)(\.|$)/.test(host)) {
    throw new Error('URL must not use ambiguous or obfuscated host encoding')
  }

  // IPv6 private (includes a colon)
  if (host.includes(':')) {
    for (const re of IPV6_PRIVATE_PATTERNS) {
      if (re.test(host)) {
        throw new Error('URL must not point to private network addresses')
      }
    }
  }

  // IPv4 private (dotted quad)
  if (isDottedIpv4(host)) {
    for (const re of IPV4_PRIVATE_RANGES) {
      if (re.test(host)) {
        throw new Error('URL must not point to private network addresses')
      }
    }
  }
}
