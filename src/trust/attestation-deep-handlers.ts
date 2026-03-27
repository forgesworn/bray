import { parseAttestation, isRevoked, attestationFilter, revocationFilter, createAttestation, isValid } from 'nostr-attestations'
import type { Attestation, FilterParams } from 'nostr-attestations'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

/** Parse a kind 31000 attestation event into a fully typed object */
export function handleTrustAttestParse(event: NostrEvent): Attestation | null {
  return parseAttestation(event)
}

/** Build a Nostr relay filter for attestation queries */
export function handleTrustAttestFilter(args: {
  type?: string
  subject?: string
  attestor?: string
  schema?: string
  since?: number
  until?: number
}): Filter {
  const params: FilterParams = {}
  if (args.type) params.type = args.type
  if (args.subject) params.subject = args.subject
  if (args.attestor) params.authors = [args.attestor]
  if (args.schema) params.schema = args.schema

  const filter = attestationFilter(params) as unknown as Filter

  // Add time range if specified
  if (args.since != null) (filter as Record<string, unknown>).since = args.since
  if (args.until != null) (filter as Record<string, unknown>).until = args.until

  return filter
}

/** Create and publish an attestation with occurredAt field */
export async function handleTrustAttestTemporal(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    type?: string
    identifier?: string
    subject?: string
    assertionId?: string
    assertionRelay?: string
    summary?: string
    content?: string
    expiration?: number
    occurredAt: number
    validFrom?: number
    validTo?: number
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  if (!args.type && !args.assertionId) {
    throw new Error('at least one of type or assertionId must be provided')
  }
  if (!Number.isFinite(args.occurredAt)) {
    throw new Error('occurredAt must be a finite number')
  }

  const template = createAttestation({
    type: args.type,
    identifier: args.identifier,
    subject: args.subject,
    assertion: args.assertionId ? {
      id: args.assertionId,
      relay: args.assertionRelay,
    } : undefined,
    summary: args.summary,
    content: args.content,
    expiration: args.expiration,
    occurredAt: args.occurredAt,
    validFrom: args.validFrom,
    validTo: args.validTo,
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

/** Follow endorsement references to build a transitive trust chain */
export async function handleTrustAttestChain(
  pool: RelayPool,
  npub: string,
  args: {
    startSubject: string
    type?: string
    maxDepth?: number
  },
): Promise<{
  chain: Array<{
    attestor: string
    subject: string | null
    type: string
    createdAt: number
    eventId: string
    depth: number
    validity: { valid: boolean; reason?: string }
  }>
  depth: number
}> {
  const maxDepth = Math.min(args.maxDepth ?? 3, 10)
  const chain: Array<{
    attestor: string
    subject: string | null
    type: string
    createdAt: number
    eventId: string
    depth: number
    validity: { valid: boolean; reason?: string }
  }> = []

  const visited = new Set<string>()
  let currentSubjects = [args.startSubject]

  for (let depth = 0; depth < maxDepth && currentSubjects.length > 0; depth++) {
    const nextSubjects: string[] = []

    for (const subject of currentSubjects) {
      if (visited.has(subject)) continue
      visited.add(subject)

      const filter = attestationFilter({
        subject,
        type: args.type,
      }) as unknown as Filter

      const events = await pool.query(npub, filter)

      for (const event of events) {
        const parsed = parseAttestation(event)
        if (!parsed) continue

        const validity = isValid(event)
        chain.push({
          attestor: parsed.pubkey,
          subject: parsed.subject,
          type: parsed.type,
          createdAt: parsed.createdAt,
          eventId: event.id,
          depth,
          validity,
        })

        // Follow the chain: the attestor becomes a subject at the next depth
        if (!visited.has(parsed.pubkey)) {
          nextSubjects.push(parsed.pubkey)
        }
      }
    }

    currentSubjects = nextSubjects
  }

  return { chain, depth: Math.min(maxDepth, chain.length > 0 ? chain[chain.length - 1].depth + 1 : 0) }
}

/** Check if a specific attestation has been revoked */
export async function handleTrustAttestCheckRevoked(
  pool: RelayPool,
  npub: string,
  args: {
    type?: string
    identifier?: string
    assertionId?: string
    assertionAddress?: string
  },
): Promise<{
  revoked: boolean
  event?: NostrEvent
  reason?: string
}> {
  // Build the revocation filter based on what's provided
  let filter: Filter
  if (args.type && args.identifier) {
    filter = revocationFilter(args.type, args.identifier) as unknown as Filter
  } else if (args.assertionId || args.assertionAddress) {
    filter = revocationFilter({
      assertionId: args.assertionId,
      assertionAddress: args.assertionAddress,
    }) as unknown as Filter
  } else {
    throw new Error('provide (type + identifier) or (assertionId | assertionAddress)')
  }

  const events = await pool.query(npub, filter)

  if (events.length === 0) {
    return { revoked: false }
  }

  // Find the most recent event (addressable events: relays return the latest)
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0]

  if (isRevoked(latest)) {
    // Extract reason tag if present
    const reasonTag = latest.tags.find(t => t[0] === 'reason')
    return {
      revoked: true,
      event: latest,
      reason: reasonTag?.[1],
    }
  }

  return { revoked: false, event: latest }
}
