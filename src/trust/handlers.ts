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
import { TrustContext, toAnnotation } from '../trust-context.js'
import type { TrustAssessment, TrustAnnotation } from '../trust-context.js'

export interface AttestResult {
  event: NostrEvent
  publish: PublishResult
  warning?: string
}

/**
 * Create and publish a kind 31000 attestation.
 *
 * @param args.type - Attestation type string (e.g. `"identity"`, `"skill"`).
 * @param args.identifier - Value being attested (e.g. a domain or username).
 * @param args.subject - Hex public key of the subject being attested.
 * @param args.assertionId - Event ID of the assertion to reference (mutually exclusive with `assertionAddress`).
 * @param args.assertionAddress - NIP-33 address of the assertion to reference (mutually exclusive with `assertionId`).
 * @param args.assertionRelay - Optional hint relay for the referenced assertion.
 * @param args.summary - Short human-readable summary of the attestation.
 * @param args.content - Free-form content body for the attestation event.
 * @param args.expiration - Unix timestamp after which the attestation expires (NIP-40).
 * @param args.relays - Explicit relay URLs to publish to; omit to use the active identity's NIP-65 outbox.
 * @returns The signed event, publish result, and an optional warning if attesting from a non-master identity.
 * @example
 * const result = await handleTrustAttest(ctx, pool, {
 *   type: 'identity',
 *   subject: 'a1b2c3d4...', // hex pubkey
 *   identifier: 'alice@example.com',
 *   summary: 'Verified email identity',
 * })
 * console.log(result.event.id, result.warning)
 */
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

/**
 * Read attestations from relays, filtered by subject/type/attestor.
 *
 * @param npub - The npub used to resolve outbox relays for the query.
 * @param args.subject - Hex public key of the subject to filter by.
 * @param args.type - Attestation type string to filter by.
 * @param args.attestor - Hex public key of the attestor to filter by.
 * @returns Array of raw kind 31000 Nostr events matching the filter.
 * @example
 * const events = await handleTrustRead(pool, 'npub1...', {
 *   subject: 'a1b2c3d4...',
 *   type: 'identity',
 * })
 * console.log(`Found ${events.length} attestations`)
 */
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

/**
 * Validate attestation event structure.
 *
 * @param event - A raw Nostr event expected to be a kind 31000 attestation.
 * @returns `valid` flag and an array of validation error messages (empty when valid).
 * @example
 * const { valid, errors } = handleTrustVerify(event)
 * if (!valid) console.error('Invalid attestation:', errors)
 */
export function handleTrustVerify(event: NostrEvent): { valid: boolean; errors: string[] } {
  const result = validateAttestation(event)
  return { valid: result.valid, errors: result.errors ?? [] }
}

/**
 * Create and publish a revocation for an attestation.
 *
 * @param args.type - Attestation type of the original attestation being revoked.
 * @param args.identifier - Identifier value of the original attestation being revoked.
 * @param args.originalAttestorPubkey - Hex public key of the original attestor; if supplied, the active identity must match or an error is thrown.
 * @returns The signed revocation event and publish result.
 * @example
 * const { event, publish } = await handleTrustRevoke(ctx, pool, {
 *   type: 'identity',
 *   identifier: 'alice@example.com',
 *   originalAttestorPubkey: 'a1b2c3d4...',
 * })
 */
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

/**
 * Send an attestation request as a NIP-17 structured DM.
 *
 * @param args.recipientPubkeyHex - Hex public key of the intended attestor.
 * @param args.subject - Hex public key of the subject for whom attestation is being requested.
 * @param args.attestationType - Attestation type string being requested (e.g. `"identity"`).
 * @param args.message - Optional human-readable note to include in the request.
 * @returns The sealed NIP-17 DM event and publish result.
 * @example
 * const { event } = await handleTrustRequest(ctx, pool, {
 *   recipientPubkeyHex: 'a1b2c3d4...',
 *   subject: 'b2c3d4e5...',
 *   attestationType: 'skill',
 *   message: 'Can you vouch for my Rust skills?',
 * })
 */
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

/**
 * Scan NIP-17 DMs for attestation request payloads.
 *
 * @returns Array of parsed attestation requests extracted from incoming DMs, each containing the sender pubkey, subject, attestation type, and optional message.
 * @example
 * const requests = await handleTrustRequestList(ctx, pool)
 * for (const req of requests) {
 *   console.log(`${req.from} wants attestation of type "${req.attestationType}" for ${req.subject}`)
 * }
 */
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

/**
 * Publish a linkage proof as a kind 30078 event. Requires confirmation.
 *
 * @param args.mode - `"blind"` (default) reveals only group membership; `"full"` also reveals the derivation purpose and index. This is irreversible.
 * @param args.confirm - Must be `true` to actually publish; pass `false` to receive a warning preview without side effects.
 * @returns The signed event and publish result when confirmed; otherwise `published: false` with a descriptive warning. Returns a warning immediately if the active context does not support linkage proofs.
 * @example
 * // Preview first
 * const preview = await handleTrustProofPublish(ctx, pool, { confirm: false })
 * console.log(preview.warning)
 *
 * // Then confirm
 * const { event, published } = await handleTrustProofPublish(ctx, pool, { mode: 'blind', confirm: true })
 */
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

// ─── trust-rank ───────────────────────────────────────────────────────────────

export interface TrustRankResult {
  event: NostrEvent
  assessment: TrustAssessment
  annotation: TrustAnnotation
}

/**
 * Assess the trust standing of the author of a Nostr event.
 *
 * Runs a full multi-dimensional assessment (Signet verification, WoT proximity,
 * Vault access) against the active identity's TrustContext and returns the
 * original event annotated with the resulting score and attesting paths.
 *
 * @param ctx - Active signing context (used as the assessor's perspective).
 * @param pool - Relay pool for fetching attestation and follow-graph data.
 * @param args.event - The Nostr event whose author should be assessed.
 * @returns The event, full TrustAssessment, and a compact TrustAnnotation.
 */
export async function handleTrustRank(
  ctx: SigningContext,
  pool: RelayPool,
  args: { event: NostrEvent },
): Promise<TrustRankResult> {
  const trustCtx = new TrustContext(ctx, pool, {
    cacheTtl: 5 * 60 * 1000,
    cacheMax: 512,
    trustMode: 'annotate',
  })
  const assessment = await trustCtx.assess(args.event.pubkey)
  return {
    event: args.event,
    assessment,
    annotation: toAnnotation(assessment),
  }
}
