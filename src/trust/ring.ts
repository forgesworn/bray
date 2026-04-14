import { ringSign, ringVerify } from '@forgesworn/ring-sig'
import type { RingSignature } from '@forgesworn/ring-sig'
import type { SigningContext } from '../signing-context.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { Event as NostrEvent } from 'nostr-tools'

/**
 * Create a ring signature proving membership in a group.
 *
 * @param args.ring - Ordered array of hex x-only public keys forming the ring. The active identity's key must appear in this list.
 * @param args.attestationType - Attestation type label embedded in the event tags (e.g. `"employment"`).
 * @param args.message - Optional canonical message to sign; defaults to `ring-membership:<type>:<timestamp>`.
 * @returns The raw `RingSignature` object, the signed kind 30078 event, and the publish result.
 * @example
 * const { signature, event } = await handleTrustRingProve(ctx, pool, {
 *   ring: ['a1b2c3...', 'b2c3d4...', 'c3d4e5...'],
 *   attestationType: 'employment',
 * })
 * console.log('Ring size:', signature.ring.length)
 */
export async function handleTrustRingProve(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    ring: string[] // hex x-only public keys of ring members
    attestationType: string
    message?: string
  },
): Promise<{ signature: RingSignature; event: NostrEvent; publish: PublishResult }> {
  const createdAt = Math.floor(Date.now() / 1000)
  const canonicalMessage = args.message ?? `ring-membership:${args.attestationType}:${createdAt}`

  // Find our index in the ring
  const activeHex = (await import('nostr-tools/nip19')).decode(ctx.activeNpub).data as string
  const signerIndex = args.ring.indexOf(activeHex)
  if (signerIndex === -1) {
    throw new Error('Active identity not found in ring. Derive and switch to a matching identity first.')
  }

  // Get private key as hex — strings can't be zeroised, so limit scope
  let privateKeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  let signature: RingSignature
  try {
    signature = ringSign(canonicalMessage, args.ring, signerIndex, privateKeyHex)
  } finally {
    privateKeyHex = '' // remove reference; original string remains until GC
  }

  // Build kind 30078 event
  const sign = ctx.getSigningFunction()
  const msgHash = Buffer.from(signature.message, 'hex').toString('hex').slice(0, 16)
  const tags: string[][] = [
    ['d', `ring-proof:${msgHash}`],
    ['attestation-type', args.attestationType],
    ...args.ring.map(pk => ['p', pk]),
  ]

  const event = await sign({
    kind: 30078,
    created_at: createdAt,
    tags,
    content: JSON.stringify(signature),
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { signature, event, publish }
}

/**
 * Verify a ring signature.
 *
 * @param signatureOrEvent - Either a `RingSignature` object or a kind 30078 Nostr event whose `content` is a JSON-serialised `RingSignature`.
 * @returns `{ valid: true }` if the signature is cryptographically sound; `{ valid: false }` otherwise (including if the event content cannot be parsed).
 * @example
 * // From a raw signature object
 * const { valid } = handleTrustRingVerify(signature)
 *
 * // Or directly from a fetched event
 * const { valid } = handleTrustRingVerify(event)
 */
export function handleTrustRingVerify(
  signatureOrEvent: RingSignature | NostrEvent,
): { valid: boolean } {
  let sig: RingSignature
  if ('content' in signatureOrEvent && 'kind' in signatureOrEvent) {
    // It's a Nostr event — parse the signature from content
    try {
      sig = JSON.parse((signatureOrEvent as NostrEvent).content)
    } catch {
      return { valid: false }
    }
  } else {
    sig = signatureOrEvent as RingSignature
  }

  return { valid: ringVerify(sig) }
}
