/**
 * NIP-13 proof of work.
 *
 * Some relays require a minimum difficulty before they will accept an event.
 * Mining adds a `["nonce", "<counter>", "<target>"]` tag and searches for a
 * `created_at`/nonce combination whose event id has the required number of
 * leading zero bits.
 *
 * nostr-tools ships `minePow`, but its loop is unbounded: asking for difficulty
 * 40 wedges the process with no way out. Since an AI agent picks the difficulty
 * here, mining is bounded by both a wall-clock deadline and an iteration cap,
 * and reports how much work it actually did.
 */

import { getEventHash } from 'nostr-tools/pure'
import { getPow } from 'nostr-tools/nip13'
import type { EventTemplate } from 'nostr-tools'

/** Hard ceiling on requested difficulty. 32 bits is already minutes of work. */
export const MAX_POW_DIFFICULTY = 40

/** Default wall-clock budget for mining, in milliseconds. */
export const DEFAULT_POW_TIMEOUT_MS = 30_000

export interface MinePowOptions {
  /** Target difficulty in leading zero bits. */
  difficulty: number
  /** Public key the event will be signed with — part of the hashed payload. */
  pubkey: string
  /** Wall-clock budget. Defaults to {@link DEFAULT_POW_TIMEOUT_MS}. */
  timeoutMs?: number
}

export interface MinePowResult {
  /** The template with its `nonce` tag and mined `created_at`. */
  template: EventTemplate
  /** Difficulty actually achieved (always >= the target on success). */
  difficulty: number
  /** Target that was requested. */
  target: number
  /** Total hashes computed across the whole mine. */
  iterations: number
  /** Wall-clock time spent mining, in milliseconds. */
  ms: number
}

/**
 * Mine `template` until its event id reaches `difficulty` leading zero bits.
 *
 * Returns a new template; the input is not mutated. The returned `created_at`
 * and `tags` must both be passed through to the signer unchanged, otherwise the
 * id changes and the work is lost.
 *
 * @throws if the difficulty is out of range, or the deadline passes first.
 */
export function minePow(
  template: EventTemplate,
  opts: MinePowOptions,
): MinePowResult {
  const { difficulty, pubkey } = opts

  if (!Number.isInteger(difficulty) || difficulty < 1) {
    throw new Error(`PoW difficulty must be a positive integer, got ${difficulty}`)
  }
  if (difficulty > MAX_POW_DIFFICULTY) {
    throw new Error(`PoW difficulty ${difficulty} exceeds the maximum of ${MAX_POW_DIFFICULTY}`)
  }
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error('PoW mining needs the signing pubkey as 64-char hex')
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_POW_TIMEOUT_MS
  const started = Date.now()
  const deadline = started + timeoutMs

  // Copy tags so a failed or abandoned mine never leaves a nonce on the caller's template
  const tags = template.tags.filter(t => t[0] !== 'nonce').map(t => [...t])
  const nonceTag = ['nonce', '0', String(difficulty)]
  tags.push(nonceTag)

  let createdAt = template.created_at
  let nonce = 0
  let iterations = 0

  while (true) {
    // Roll created_at forward with the clock so the event does not look stale
    // after a long mine. Resets the nonce, matching nostr-tools' behaviour.
    const now = Math.floor(Date.now() / 1000)
    if (now !== createdAt) {
      createdAt = now
      nonce = 0
    }

    nonceTag[1] = String(++nonce)
    iterations++

    const candidate = {
      pubkey,
      created_at: createdAt,
      kind: template.kind,
      tags,
      content: template.content,
    }
    const id = getEventHash(candidate as any)
    const achieved = getPow(id)

    if (achieved >= difficulty) {
      return {
        template: { kind: template.kind, created_at: createdAt, tags, content: template.content },
        difficulty: achieved,
        target: difficulty,
        iterations,
        ms: Date.now() - started,
      }
    }

    // Check the clock every 1024 hashes rather than every hash
    if ((iterations & 0x3ff) === 0 && Date.now() > deadline) {
      throw new Error(
        `PoW mining gave up after ${timeoutMs}ms without reaching difficulty ${difficulty}. ` +
        `Try a lower difficulty or raise the timeout.`,
      )
    }
  }
}

export { getPow }
