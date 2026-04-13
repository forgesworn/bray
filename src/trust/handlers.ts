import { createAttestation, createRevocation } from 'nostr-attestations'
import { validateAttestation } from 'nostr-attestations'
import { attestationFilter } from 'nostr-attestations'
import { toUnsignedEvent } from 'nsec-tree/event'
import { decode } from 'nostr-tools/nip19'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import { hasExtendedIdentity } from '../signing-context.js'
import type { IdentityContext } from '../context.js'
import { wrapEventAsync } from '../nip17-wrap.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface AttestResult {
  event: NostrEvent
  publish: PublishResult
  warning?: string
}

/** Create and publish a kind 31000 attestation */
export async function handleTrustAttest(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    type?: string
    identifier?: string
    subject?: string
    assertionId?: string
    assertionAddress?: string
    assertionRelay?: string
    summary?: string
    content?: string
    expiration?: number
    relays?: string[]
  },
): Promise<AttestResult> {
  if (!args.type && !args.assertionId && !args.assertionAddress) {
    throw new Error('at least one of type, assertionId, or assertionAddress must be provided')
  }

  if (args.assertionId && args.assertionAddress) {
    throw new Error('cannot supply both assertionId and assertionAddress')
  }

  const assertion = args.assertionId
    ? { id: args.assertionId, relay: args.assertionRelay }
    : args.assertionAddress
      ? { address: args.assertionAddress, relay: args.assertionRelay }
      : undefined

  const template = createAttestation({
    type: args.type,
    identifier: args.identifier,
    subject: args.subject,
    assertion,
    summary: args.summary,
    content: args.content,
    expiration: args.expiration,
  })

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: template.kind,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    tags: template.tags,
    content: template.content,
  })

  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)

  // Warn if attesting as a derived persona
  const identities = await ctx.listIdentities()
  const active = identities.find(i => i.npub === ctx.activeNpub)
  let warning: string | undefined
  if (active && active.purpose !== 'master') {
    warning = `Attesting as derived identity (purpose: ${active.purpose}). Attestations are usually issued from the master identity.`
  }

  return { event, publish, warning }
}

/** Read attestations from relays, filtered by subject/type/attestor */
export async function handleTrustRead(
  pool: RelayPool,
  npub: string,
  args: { subject?: string; type?: string; attestor?: string },
): Promise<NostrEvent[]> {
  const filter = attestationFilter({
    subject: args.subject,
    type: args.type,
    authors: args.attestor ? [args.attestor] : undefined,
  }) as unknown as Filter

  return pool.query(npub, filter)
}

/** Validate attestation event structure */
export function handleTrustVerify(event: NostrEvent): { valid: boolean; errors: string[] } {
  const result = validateAttestation(event)
  return { valid: result.valid, errors: result.errors ?? [] }
}

/** Create and publish a revocation for an attestation */
export async function handleTrustRevoke(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    type: string
    identifier: string
    originalAttestorPubkey?: string
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  // Check that active identity matches the original attestor
  if (args.originalAttestorPubkey) {
    // Decode active npub to hex for comparison
    const activeHex = (decode(ctx.activeNpub).data as string)
    if (args.originalAttestorPubkey !== activeHex) {
      throw new Error(`Active identity does not match original attestor. Switch identity before revoking.`)
    }
  }

  const template = createRevocation({
    type: args.type,
    identifier: args.identifier,
  })

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: template.kind,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    tags: template.tags,
    content: template.content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

// --- Task 14: Attestation request via NIP-17 ---

const ATTESTATION_REQUEST_TYPE = 'nip-va/attestation-request'

/** Send an attestation request as a NIP-17 structured DM */
export async function handleTrustRequest(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    recipientPubkeyHex: string
    subject: string
    attestationType: string
    message?: string
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const payload = JSON.stringify({
    type: ATTESTATION_REQUEST_TYPE,
    v: 1,
    subject: args.subject,
    attestation_type: args.attestationType,
    message: args.message,
  })

  const event = await wrapEventAsync(
    ctx,
    { publicKey: args.recipientPubkeyHex },
    payload,
  )
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Scan NIP-17 DMs for attestation request payloads */
export async function handleTrustRequestList(
  ctx: SigningContext,
  pool: RelayPool,
): Promise<Array<{ from: string; subject: string; attestationType: string; message?: string }>> {
  const { handleDmRead } = await import('../social/dm.js')
  const dms = await handleDmRead(ctx, pool)

  const requests: Array<{ from: string; subject: string; attestationType: string; message?: string }> = []
  for (const dm of dms) {
    if (!dm.decrypted || !dm.content) continue
    try {
      const payload = JSON.parse(dm.content)
      if (payload.type === ATTESTATION_REQUEST_TYPE && payload.v === 1) {
        requests.push({
          from: dm.from,
          subject: payload.subject,
          attestationType: payload.attestation_type,
          message: payload.message,
        })
      }
    } catch { /* not a structured DM */ }
  }

  return requests
}

// --- Task 15: Linkage proof publishing ---

/** Publish a linkage proof as a kind 30078 event. Requires confirmation. */
export async function handleTrustProofPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: { mode?: 'blind' | 'full'; confirm: boolean },
): Promise<{ event?: NostrEvent; published: boolean; warning?: string; publish?: PublishResult }> {
  if (!hasExtendedIdentity(ctx)) {
    return { published: false, warning: 'Linkage proofs require a Heartwood-compatible signer or local key mode.' }
  }
  const proof = await ctx.prove(args.mode ?? 'blind')
  const reveals = args.mode === 'full'
    ? `Full proof — reveals purpose "${proof.purpose}" and index ${proof.index}. This is irreversible.`
    : 'Blind proof — reveals that child belongs to master, but NOT the derivation path.'

  if (!args.confirm) {
    return {
      published: false,
      warning: `About to publish linkage proof. ${reveals} Set confirm: true to proceed.`,
    }
  }

  const unsigned = toUnsignedEvent(proof)
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: unsigned.kind,
    created_at: unsigned.created_at,
    tags: unsigned.tags,
    content: unsigned.content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, published: true, publish }
}
