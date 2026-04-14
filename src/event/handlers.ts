/**
 * Event handlers — generic event construction and broadcasting.
 *
 * These handlers are called by both the CLI (Phase 1) and, in Phase 2,
 * will be exported via the public SDK surface.
 */

import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface PublishRawResult {
  event: NostrEvent
  publish: PublishResult
  /** True when the handler signed the event (vs broadcasting as-is). */
  signed: boolean
}

/**
 * Broadcast a pre-built or partially-built Nostr event.
 *
 * Signing behaviour:
 * - `noSign: false` (default): if the event lacks `id` or `sig`, sign it
 *   with the active identity before broadcasting.
 * - `noSign: true`: broadcast the event exactly as supplied (caller is
 *   responsible for a valid id/sig; relay will reject if they are wrong).
 *
 * Relay selection:
 * - `relays` present: broadcast to those URLs only (per-command override).
 * - `relays` absent: use the identity's relay set (NOSTR_RELAYS / NIP-65).
 *
 * Full per-relay reporting, quorum semantics, and timeout flags are
 * Phase 4 item B. This implementation returns the standard PublishResult.
 *
 * @param args - `{ event, noSign?, relays? }` — the event object to publish, an optional flag to
 *   skip signing, and an optional list of relay WebSocket URLs to target.
 * @returns `{ event, publish, signed }` — the final event (post-signing if applicable),
 *   the relay publish result, and whether this handler signed the event.
 * @example
 * await handlePublishRaw(ctx, pool, {
 *   event: { kind: 1, content: 'Hello Nostr!', tags: [] },
 * })
 * // { event: { id: 'abc...', sig: 'def...', ... }, publish: { success: true, ... }, signed: true }
 */
export async function handlePublishRaw(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    event: Record<string, unknown>
    noSign?: boolean
    relays?: string[]
  },
): Promise<PublishRawResult> {
  let event: NostrEvent
  let signed = false

  if (!args.noSign && (!args.event.id || !args.event.sig)) {
    const sign = ctx.getSigningFunction()
    event = await sign({
      kind: (args.event.kind as number) ?? 1,
      created_at: (args.event.created_at as number) ?? Math.floor(Date.now() / 1000),
      tags: (args.event.tags as string[][]) ?? [],
      content: (args.event.content as string) ?? '',
    })
    signed = true
  } else {
    event = args.event as NostrEvent
  }

  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)

  return { event, publish, signed }
}
