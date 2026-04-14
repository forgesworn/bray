import { z } from 'zod'

/** 64-character lowercase hex string (pubkey or event ID) */
export const hexId = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/** Relay WebSocket URL — wss:// or ws:// only */
export const relayUrl = z.string().regex(/^wss?:\/\//, 'Must be a wss:// or ws:// URL')

/** HTTPS URL — no private networks */
export const httpsUrl = z.string().regex(/^https?:\/\//, 'Must be an https:// URL')

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
