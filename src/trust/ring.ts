import { ringSign, ringVerify } from '@forgesworn/ring-sig'
import type { RingSignature } from '@forgesworn/ring-sig'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { Event as NostrEvent } from 'nostr-tools'

/** Create a ring signature proving membership in a group */
export async function handleTrustRingProve(
  ctx: IdentityContext,
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

  // Get private key as hex
  const privateKeyHex = Buffer.from(ctx.activePrivateKey).toString('hex')

  const signature = ringSign(canonicalMessage, args.ring, signerIndex, privateKeyHex)

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

/** Verify a ring signature */
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
