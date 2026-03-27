import { deriveDirectionalPair, deriveToken } from 'spoken-token'
import type { DirectionalPair, TokenEncoding } from 'spoken-token'

/** Normalise encoding args to a TokenEncoding object */
function normaliseEncoding(format: string, count?: number, digits?: number, length?: number): TokenEncoding {
  switch (format) {
    case 'words':
      return { format: 'words', count: count ?? 1 }
    case 'pin':
      return { format: 'pin', digits: digits ?? 4 }
    case 'hex':
      return { format: 'hex', length: length ?? 8 }
    default:
      return { format: 'words', count: 1 }
  }
}

/** Generate directional token pair — different tokens for each role */
export function handleTrustSpokenDirectional(
  args: {
    secret: string
    namespace: string
    roles: [string, string]
    counter: number
    format?: string
    wordCount?: number
    pinDigits?: number
    hexLength?: number
  },
): DirectionalPair {
  const encoding = normaliseEncoding(
    args.format ?? 'words',
    args.wordCount,
    args.pinDigits,
    args.hexLength,
  )
  return deriveDirectionalPair(args.secret, args.namespace, args.roles, args.counter, encoding)
}

/** Generate token in alternative encoding (PIN digits, hex, multi-word) */
export function handleTrustSpokenEncode(
  args: {
    secret: string
    context: string
    counter: number
    format: string
    wordCount?: number
    pinDigits?: number
    hexLength?: number
  },
): { token: string; encoding: string } {
  const encoding = normaliseEncoding(
    args.format,
    args.wordCount,
    args.pinDigits,
    args.hexLength,
  )
  const token = deriveToken(args.secret, args.context, args.counter, encoding)

  // Build human-readable encoding description
  let desc: string
  switch (args.format) {
    case 'pin':
      desc = `${args.pinDigits ?? 4}-digit PIN`
      break
    case 'hex':
      desc = `${args.hexLength ?? 8}-char hex`
      break
    case 'words':
      desc = `${args.wordCount ?? 1}-word`
      break
    default:
      desc = args.format
  }

  return { token, encoding: desc }
}
