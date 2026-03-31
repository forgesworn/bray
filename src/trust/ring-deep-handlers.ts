import { lsagSign, lsagVerify, computeKeyImage, hasDuplicateKeyImage } from '@forgesworn/ring-sig'
import type { LsagSignature } from '@forgesworn/ring-sig'
import type { SigningContext } from '../signing-context.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import type { Event as NostrEvent } from 'nostr-tools'

/** Create an LSAG signature with linkable key image for double-action detection */
export async function handleTrustRingLsagSign(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    ring: string[]
    electionId: string
    message: string
    domain?: string
  },
): Promise<{ signature: LsagSignature; event: NostrEvent; publish: PublishResult }> {
  const createdAt = Math.floor(Date.now() / 1000)

  // Find our index in the ring
  const activeHex = (await import('nostr-tools/nip19')).decode(ctx.activeNpub).data as string
  const signerIndex = args.ring.indexOf(activeHex)
  if (signerIndex === -1) {
    throw new Error('Active identity not found in ring. Derive and switch to a matching identity first.')
  }

  // Get private key as hex — limit scope for security
  let privateKeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  let signature: LsagSignature
  try {
    signature = lsagSign(
      args.message,
      args.ring,
      signerIndex,
      privateKeyHex,
      args.electionId,
      args.domain,
    )
  } finally {
    privateKeyHex = '' // remove reference
  }

  // Build kind 30078 event with LSAG-specific tags
  const sign = ctx.getSigningFunction()
  const msgHash = Buffer.from(signature.message).toString('hex').slice(0, 16)
  const tags: string[][] = [
    ['d', `lsag-proof:${args.electionId}:${msgHash}`],
    ['election-id', args.electionId],
    ['key-image', signature.keyImage],
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

/** Verify an LSAG signature and optionally check key image against known images */
export function handleTrustRingLsagVerify(
  signatureOrEvent: LsagSignature | NostrEvent,
  existingKeyImages?: string[],
): { valid: boolean; keyImage?: string; duplicate: boolean } {
  let sig: LsagSignature
  if ('content' in signatureOrEvent && 'kind' in signatureOrEvent) {
    try {
      sig = JSON.parse((signatureOrEvent as NostrEvent).content)
    } catch {
      return { valid: false, duplicate: false }
    }
  } else {
    sig = signatureOrEvent as LsagSignature
  }

  const valid = lsagVerify(sig)
  if (!valid) {
    return { valid: false, duplicate: false }
  }

  let duplicate = false
  if (existingKeyImages && existingKeyImages.length > 0) {
    duplicate = hasDuplicateKeyImage(sig.keyImage, existingKeyImages)
  }

  return { valid: true, keyImage: sig.keyImage, duplicate }
}

/** Compute key image for a signing key in a specific election */
export function handleTrustRingKeyImage(
  ctx: SigningContext,
  args: {
    electionId: string
  },
): { keyImage: string } {
  const activeHex = ctx.activePublicKeyHex

  // Get private key as hex — limit scope for security
  let privateKeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  let keyImage: string
  try {
    keyImage = computeKeyImage(privateKeyHex, activeHex, args.electionId)
  } finally {
    privateKeyHex = '' // remove reference
  }

  return { keyImage }
}
