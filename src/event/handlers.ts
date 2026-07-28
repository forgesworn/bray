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
import { verifyEvent } from 'nostr-tools/pure'
import { assertEventSemanticallyValid } from '../event-validation/validator.js'
import type { EventValidationMode, EventValidationResult } from '../event-validation/validator.js'
import { minePow, type MinePowResult } from './pow.js'

export interface PublishRawResult {
  event: NostrEvent
  publish: PublishResult
  /** True when the handler signed the event (vs broadcasting as-is). */
  signed: boolean
  validation: EventValidationResult
  /** Present when NIP-13 proof of work was mined for this event. */
  pow?: Omit<MinePowResult, 'template'>
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
 * @param args - `{ event, noSign?, relays?, timeoutMs?, quorum? }` — the event object to publish,
 *   optional signing control, optional relay overrides, optional per-relay deadline, and optional
 *   minimum number of relays that must accept for `success` to be true.
 * @returns `{ event, publish, signed }` — the final event (post-signing if applicable),
 *   the relay publish result, and whether this handler signed the event.
 * @example
 * await handlePublishRaw(ctx, pool, {
 *   event: { kind: 1, content: 'Hello Nostr!', tags: [] },
 *   timeoutMs: 5000,
 *   quorum: 2,
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
    /** Per-relay deadline in milliseconds. Relays that do not respond within this window are treated as rejected. */
    timeoutMs?: number
    /** Minimum number of relays that must accept the event for `publish.success` to be true. Overrides the default majority rule. */
    quorum?: number
    /** Semantic validation policy. strict-known is the safe default. */
    validationMode?: EventValidationMode
    /** NIP-13 difficulty in leading zero bits. Requires signing (incompatible with `noSign`). */
    pow?: number
    /** Wall-clock budget for mining, in milliseconds. */
    powTimeoutMs?: number
  },
): Promise<PublishRawResult> {
  let event: NostrEvent
  let signed = false
  let validation: EventValidationResult
  let pow: Omit<MinePowResult, 'template'> | undefined

  if (!args.noSign && (!args.event.id || !args.event.sig)) {
    let template = {
      kind: (args.event.kind as number) ?? 1,
      created_at: (args.event.created_at as number) ?? Math.floor(Date.now() / 1000),
      tags: (args.event.tags as string[][]) ?? [],
      content: (args.event.content as string) ?? '',
    }

    if (args.pow !== undefined) {
      // Mine before validating and signing: the nonce tag and the mined
      // created_at are part of the hashed payload, so both the validator and
      // the signer must see the final template.
      const mined = minePow(template, {
        difficulty: args.pow,
        pubkey: ctx.activePublicKeyHex,
        timeoutMs: args.powTimeoutMs,
      })
      template = mined.template
      const { template: _discard, ...stats } = mined
      pow = stats
    }

    validation = assertEventSemanticallyValid(template, args.validationMode)
    const sign = ctx.getSigningFunction()
    event = await sign(template)
    signed = true
  } else {
    if (args.pow !== undefined) {
      throw new Error('pow requires signing — it cannot be combined with noSign or a pre-signed event')
    }
    event = args.event as NostrEvent
    validation = assertEventSemanticallyValid(event, args.validationMode)
    if (!verifyEvent(event)) {
      throw new Error('Pre-signed event has an invalid event ID or signature')
    }
  }

  const opts = { timeoutMs: args.timeoutMs }
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event, opts)
    : await pool.publish(ctx.activeNpub, event, opts)

  // Apply quorum override: if caller specified a minimum, recompute success.
  if (args.quorum !== undefined) {
    const met = publish.accepted.length >= args.quorum
    ;(publish as { success: boolean }).success = met
  }

  return { event, publish, signed, validation, ...(pow ? { pow } : {}) }
}
