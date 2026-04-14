/**
 * NIP-65 outbox model helpers.
 *
 * Resolves read/write relay lists for any pubkey and publishes events
 * following the outbox model: broadcast to the author's write relays
 * and to the read relays of every pubkey mentioned in p-tags.
 */

import { decode } from 'nostr-tools/nip19'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult, RelaySet } from '../types.js'
import { parseRelayTags } from '../nip65.js'

// ---------------------------------------------------------------------------
// Shared: fetch kind 10002 for an arbitrary hex pubkey
// ---------------------------------------------------------------------------

async function fetchRelayList(
  pool: RelayPool,
  lookupNpub: string,
  targetHex: string,
  defaultRelays: string[],
): Promise<RelaySet> {
  const events = await pool.query(lookupNpub, {
    kinds: [10002],
    authors: [targetHex],
  })

  const verified = events.filter((e: NostrEvent) => e.pubkey === targetHex && verifyEvent(e))

  if (verified.length === 0) {
    return { read: [...defaultRelays], write: [...defaultRelays] }
  }

  const best = verified.reduce((a: NostrEvent, b: NostrEvent) =>
    b.created_at > a.created_at ? b : a,
  )

  return parseRelayTags(best.tags)
}

// ---------------------------------------------------------------------------
// handleOutboxRelays
// ---------------------------------------------------------------------------

export interface OutboxRelaysResult {
  pubkey: string
  relays: RelaySet
  /** True when the relay list came from a NIP-65 kind 10002 event */
  resolved: boolean
}

/**
 * Resolve the NIP-65 read/write relay list for any pubkey.
 *
 * Accepts npub, hex pubkey, or nprofile (the encoded pubkey is extracted).
 * Falls back to the identity's default relay set when no kind 10002 event
 * is found.
 *
 * @param ctx - Active signing context (used as the query identity for relay routing).
 * @param pool - Relay pool.
 * @param targetPubkey - npub, hex pubkey, or nprofile of the target.
 * @returns Resolved relay set plus metadata.
 */
export async function handleOutboxRelays(
  ctx: SigningContext,
  pool: RelayPool,
  args: { targetPubkey: string },
): Promise<OutboxRelaysResult> {
  let hex: string

  const raw = args.targetPubkey.trim()
  if (raw.startsWith('npub') || raw.startsWith('nprofile')) {
    const decoded = decode(raw)
    if (decoded.type === 'npub') {
      hex = decoded.data as string
    } else if (decoded.type === 'nprofile') {
      hex = (decoded.data as { pubkey: string }).pubkey
    } else {
      throw new Error(`Unsupported bech32 type: ${decoded.type}`)
    }
  } else if (/^[0-9a-f]{64}$/i.test(raw)) {
    hex = raw.toLowerCase()
  } else {
    throw new Error(`Invalid pubkey: expected npub, nprofile, or 64-char hex — got "${raw}"`)
  }

  const defaultRelays = pool.getRelays(ctx.activeNpub).read

  const beforeEvents = await pool.query(ctx.activeNpub, {
    kinds: [10002],
    authors: [hex],
    limit: 1,
  })

  const verified = beforeEvents.filter((e: NostrEvent) => e.pubkey === hex && verifyEvent(e))
  const resolved = verified.length > 0

  const relaySet = resolved
    ? parseRelayTags(
        verified.reduce((a: NostrEvent, b: NostrEvent) =>
          b.created_at > a.created_at ? b : a,
        ).tags,
      )
    : { read: [...defaultRelays], write: [...defaultRelays] }

  return { pubkey: hex, relays: relaySet, resolved }
}

// ---------------------------------------------------------------------------
// handleOutboxPublish
// ---------------------------------------------------------------------------

export interface OutboxPublishResult {
  event: NostrEvent
  /** Relays the event was sent to (author write + p-tag read relays) */
  targetRelays: string[]
  publish: PublishResult
}

/**
 * Publish an event following the NIP-65 outbox model.
 *
 * Broadcasts to:
 * 1. The author's write relays (resolved from NIP-65 kind 10002, or defaults).
 * 2. The read relays of every pubkey mentioned in the event's p-tags.
 *
 * The event must already be signed (id + sig present). If not, it is signed
 * with the active identity before broadcasting.
 *
 * @param ctx - Active signing context.
 * @param pool - Relay pool.
 * @param args - `{ event, timeoutMs? }`.
 * @returns The final event, the relay URLs targeted, and the publish result.
 */
export async function handleOutboxPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    event: Record<string, unknown>
    timeoutMs?: number
  },
): Promise<OutboxPublishResult> {
  let event: NostrEvent

  if (!args.event.id || !args.event.sig) {
    const sign = ctx.getSigningFunction()
    event = await sign({
      kind: (args.event.kind as number) ?? 1,
      created_at: (args.event.created_at as number) ?? Math.floor(Date.now() / 1000),
      tags: (args.event.tags as string[][]) ?? [],
      content: (args.event.content as string) ?? '',
    })
  } else {
    event = args.event as NostrEvent
  }

  const authorHex = event.pubkey
  const defaultRelays = pool.getRelays(ctx.activeNpub).read

  // Resolve author write relays
  const authorRelaySet = await fetchRelayList(pool, ctx.activeNpub, authorHex, defaultRelays)
  const targetSet = new Set<string>(authorRelaySet.write)

  // Resolve read relays for each p-tagged pubkey
  const pTaggedPubkeys = event.tags
    .filter(t => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]))
    .map(t => t[1])

  await Promise.all(
    pTaggedPubkeys.map(async (hex) => {
      const relaySet = await fetchRelayList(pool, ctx.activeNpub, hex, defaultRelays)
      for (const r of relaySet.read) targetSet.add(r)
    }),
  )

  const targetRelays = Array.from(targetSet)
  const publish = await pool.publishDirect(targetRelays, event, { timeoutMs: args.timeoutMs })

  return { event, targetRelays, publish }
}
