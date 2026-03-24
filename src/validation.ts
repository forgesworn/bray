import { z } from 'zod'

/** 64-character lowercase hex string (pubkey or event ID) */
export const hexId = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/** Relay WebSocket URL — wss:// or ws:// only */
export const relayUrl = z.string().regex(/^wss?:\/\//, 'Must be a wss:// or ws:// URL')

/** HTTPS URL — no private networks */
export const httpsUrl = z.string().regex(/^https?:\/\//, 'Must be an https:// URL')

const PRIVATE_HOSTS = ['localhost', '[::1]', '169.254.169.254']
const PRIVATE_PREFIXES = ['127.', '10.', '192.168.']
const PRIVATE_REGEX = /^172\.(1[6-9]|2\d|3[01])\./

/** Validate a URL is not pointing at private/internal networks */
export function validatePublicUrl(url: string): void {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (
    PRIVATE_HOSTS.includes(host) ||
    PRIVATE_PREFIXES.some(p => host.startsWith(p)) ||
    PRIVATE_REGEX.test(host)
  ) {
    throw new Error('URL must not point to private network addresses')
  }
}
