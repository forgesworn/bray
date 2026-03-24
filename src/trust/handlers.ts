import { createAttestation, createRevocation } from 'nostr-attestations'
import { validateAttestation } from 'nostr-attestations'
import { attestationFilter } from 'nostr-attestations'
import { decode } from 'nostr-tools/nip19'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface AttestResult {
  event: NostrEvent
  publish: PublishResult
  warning?: string
}

/** Create and publish a kind 31000 attestation */
export async function handleTrustAttest(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    type: string
    identifier?: string
    subject?: string
    summary?: string
    content?: string
    expiration?: number
  },
): Promise<AttestResult> {
  const template = createAttestation({
    type: args.type,
    identifier: args.identifier,
    subject: args.subject,
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

  const publish = await pool.publish(ctx.activeNpub, event)

  // Warn if attesting as a derived persona
  const identities = ctx.listIdentities()
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
  ctx: IdentityContext,
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
