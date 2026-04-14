import { deriveToken, verifyToken } from 'spoken-token'
import type { SigningContext } from '../signing-context.js'

/**
 * Generate a challenge token for spoken verification.
 *
 * @param args.secret - Shared HMAC secret known to both parties.
 * @param args.context - Context string that scopes the token (e.g. a session ID or channel name).
 * @param args.counter - Monotonic counter value; increment each time a new challenge is needed.
 * @param args.encoding - Output format: `{ format: 'words', count?: number }` for a BIP-39-style word list, or `{ format: 'pin', digits?: number }` for a numeric PIN. Defaults to words.
 * @returns An object containing the derived `token` string ready to present or speak aloud.
 * @example
 * const { token } = handleTrustSpokenChallenge({
 *   secret: 'shared-secret',
 *   context: 'session-abc123',
 *   counter: 1,
 *   encoding: { format: 'pin', digits: 6 },
 * })
 * console.log('Your PIN:', token) // e.g. "482931"
 */
export function handleTrustSpokenChallenge(
  args: {
    secret: string
    context: string
    counter: number
    encoding?: { format: 'words'; count?: number } | { format: 'pin'; digits?: number }
  },
): { token: string } {
  const token = deriveToken(args.secret, args.context, args.counter, args.encoding)
  return { token }
}

/**
 * Verify a spoken token response.
 *
 * @param args.secret - Shared HMAC secret used to generate the original challenge.
 * @param args.context - Context string that scopes the token; must match the value used during challenge generation.
 * @param args.counter - Counter value; the verifier checks `counter` ± `tolerance`.
 * @param args.input - Token string supplied by the user (words or PIN).
 * @param args.tolerance - Number of counter steps either side of `counter` to accept (default `1`).
 * @param args.encoding - Must match the encoding used during challenge generation.
 * @returns `valid` flag and, when available, the resolved `identity` string from the token library.
 * @example
 * const { valid, identity } = handleTrustSpokenVerify({
 *   secret: 'shared-secret',
 *   context: 'session-abc123',
 *   counter: 1,
 *   input: '482931',
 *   encoding: { format: 'pin', digits: 6 },
 * })
 * if (valid) console.log('Verified identity:', identity)
 */
export function handleTrustSpokenVerify(
  args: {
    secret: string
    context: string
    counter: number
    input: string
    tolerance?: number
    encoding?: { format: 'words'; count?: number } | { format: 'pin'; digits?: number }
  },
): { valid: boolean; identity?: string } {
  const result = verifyToken(args.secret, args.context, args.counter, args.input, undefined, {
    tolerance: args.tolerance ?? 1,
    encoding: args.encoding,
  })
  return { valid: result.status === 'valid', identity: result.identity }
}
