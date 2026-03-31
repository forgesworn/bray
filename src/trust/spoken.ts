import { deriveToken, verifyToken } from 'spoken-token'
import type { SigningContext } from '../signing-context.js'

/** Generate a challenge token for spoken verification */
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

/** Verify a spoken token response */
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
