import {
  commit,
  verifyCommitment,
  createRangeProof,
  verifyRangeProof,
  createAgeRangeProof,
  verifyAgeRangeProof,
  serializeRangeProof,
  deserializeRangeProof,
  type PedersenCommitment,
  type RangeProof,
} from '@forgesworn/range-proof'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// --- Commitment primitives ---

export interface CommitResult {
  /** Public commitment point (compressed hex) — safe to share */
  commitment: string
  /** The blinding factor (hex) — MUST be kept secret by the committer */
  blinding: string
}

/** Create a Pedersen commitment to a value. The value and blinding factor are secrets. */
export function handlePrivacyCommit(
  args: { value: number },
): CommitResult {
  const result: PedersenCommitment = commit(args.value)
  return {
    commitment: result.commitment,
    blinding: result.blinding,
  }
}

/** Verify a Pedersen commitment opening (given value + blinding, check it matches commitment). */
export function handlePrivacyOpen(
  args: { commitment: string; value: number; blinding: string },
): { valid: boolean } {
  const valid = verifyCommitment(args.commitment, args.value, args.blinding)
  return { valid }
}

// --- Range proof primitives ---

export interface RangeProveResult {
  /** Serialised range proof (JSON string) */
  proof: string
  /** The public commitment (compressed hex) embedded in the proof */
  commitment: string
}

/** Prove a committed value is within [min, max] without revealing the value. */
export function handlePrivacyProveRange(
  args: { value: number; min: number; max: number; context?: string },
): RangeProveResult {
  const proof = createRangeProof(args.value, args.min, args.max, args.context)
  return {
    proof: serializeRangeProof(proof),
    commitment: proof.commitment,
  }
}

/** Verify a range proof against expected bounds. */
export function handlePrivacyVerifyRange(
  args: { proof: string; min: number; max: number; context?: string },
): { valid: boolean } {
  const proof = deserializeRangeProof(args.proof)
  const valid = verifyRangeProof(proof, args.min, args.max, args.context)
  return { valid }
}

// --- Application-level: age proofs ---

export interface AgeProveResult {
  /** Serialised range proof (JSON string) */
  proof: string
  /** The public commitment (compressed hex) */
  commitment: string
  /** The age range that was proven (e.g. "18+" or "8-12") */
  ageRange: string
}

/** Prove age is within a range (e.g. "18+" or "8-12") without revealing the exact age. */
export function handlePrivacyProveAge(
  args: { age: number; ageRange: string; subjectPubkey?: string },
): AgeProveResult {
  const proof = createAgeRangeProof(args.age, args.ageRange, args.subjectPubkey)
  return {
    proof: serializeRangeProof(proof),
    commitment: proof.commitment,
    ageRange: args.ageRange,
  }
}

/** Verify an age range proof. */
export function handlePrivacyVerifyAge(
  args: { proof: string; ageRange: string; subjectPubkey?: string },
): { valid: boolean } {
  const proof = deserializeRangeProof(args.proof)
  const valid = verifyAgeRangeProof(proof, args.ageRange, args.subjectPubkey)
  return { valid }
}

// --- Application-level: threshold proofs ---

export interface ThresholdProveResult {
  /** Serialised range proof (JSON string) */
  proof: string
  /** The public commitment (compressed hex) */
  commitment: string
  /** The threshold that was proven (value >= threshold) */
  threshold: number
}

/** Maximum value for threshold proofs (2^32 - 1, the range-proof library ceiling). */
const THRESHOLD_CEILING = 4_294_967_295

/** Prove a value exceeds a threshold without revealing the value. */
export function handlePrivacyProveThreshold(
  args: { value: number; threshold: number; context?: string },
): ThresholdProveResult {
  // We prove value is in [threshold, THRESHOLD_CEILING]
  const proof = createRangeProof(args.value, args.threshold, THRESHOLD_CEILING, args.context)
  return {
    proof: serializeRangeProof(proof),
    commitment: proof.commitment,
    threshold: args.threshold,
  }
}

/** Verify a threshold proof. */
export function handlePrivacyVerifyThreshold(
  args: { proof: string; threshold: number; context?: string },
): { valid: boolean } {
  const proof = deserializeRangeProof(args.proof)
  const valid = verifyRangeProof(proof, args.threshold, THRESHOLD_CEILING, args.context)
  return { valid }
}

// --- Nostr integration ---

/** The kind used for application-specific data (NIP-78) */
const RANGE_PROOF_KIND = 30078

export interface PublishProofResult {
  event: NostrEvent
  publish: PublishResult
}

/** Publish a range proof as a kind 30078 Nostr event. */
export async function handlePrivacyPublishProof(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    proof: string
    label: string
    subjectPubkey?: string
  },
): Promise<PublishProofResult> {
  // Validate the proof deserialises cleanly before publishing
  const parsed = deserializeRangeProof(args.proof)

  const tags: string[][] = [
    ['d', `range-proof:${args.label}`],
    ['range-proof-type', args.label],
    ['commitment', parsed.commitment],
    ['range', `${parsed.min}-${parsed.max}`],
  ]

  if (args.subjectPubkey) {
    tags.push(['p', args.subjectPubkey])
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: RANGE_PROOF_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.proof,
  })

  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

export interface ReadProofResult {
  id: string
  pubkey: string
  label: string
  commitment: string
  range: string
  subjectPubkey?: string
  valid: boolean
  createdAt: number
}

/** Fetch and verify range proof events for a pubkey. */
export async function handlePrivacyReadProof(
  pool: RelayPool,
  npub: string,
  args: { authorPubkey?: string; label?: string },
): Promise<ReadProofResult[]> {
  const filter: Record<string, unknown> = {
    kinds: [RANGE_PROOF_KIND],
  }
  if (args.authorPubkey) {
    filter.authors = [args.authorPubkey]
  }
  // NIP-78 d-tag filter
  if (args.label) {
    filter['#d'] = [`range-proof:${args.label}`]
  }

  const events = await pool.query(npub, filter as any)
  const results: ReadProofResult[] = []

  for (const event of events) {
    // Only process events that look like range proofs
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')
    if (!dTag || !dTag[1]?.startsWith('range-proof:')) continue

    const label = dTag[1].replace('range-proof:', '')
    const commitmentTag = event.tags.find((t: string[]) => t[0] === 'commitment')
    const rangeTag = event.tags.find((t: string[]) => t[0] === 'range')
    const pTag = event.tags.find((t: string[]) => t[0] === 'p')

    // Attempt to verify the proof
    let valid = false
    try {
      const proof = deserializeRangeProof(event.content)
      valid = verifyRangeProof(proof, proof.min, proof.max, proof.context)
    } catch {
      // Invalid proof content — valid stays false
    }

    results.push({
      id: event.id,
      pubkey: event.pubkey,
      label,
      commitment: commitmentTag?.[1] ?? '',
      range: rangeTag?.[1] ?? '',
      subjectPubkey: pTag?.[1],
      valid,
      createdAt: event.created_at,
    })
  }

  return results
}
