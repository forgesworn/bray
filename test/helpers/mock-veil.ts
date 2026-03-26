import type { Event as NostrEvent } from 'nostr-tools'

/**
 * Factory functions for mock NIP-85 (kind 30382) assertion events — just
 * enough structure to exercise the VeilScoring logic.
 */

let _seq = 0

function nextId(): string {
  return String(++_seq).padStart(64, '0')
}

export interface MockAssertionOptions {
  /** Provider pubkey (who is asserting) */
  provider?: string
  /** Subject pubkey (who is being assessed) */
  subject?: string
  /** Whether to include a veil-ring tag (anonymous ring endorsement) */
  ringEndorsement?: boolean
  /** Additional metric tags, e.g. [['rank', '80']] */
  metrics?: string[][]
}

/**
 * Build a minimal kind 30382 NIP-85 assertion event.
 */
export function mockAssertionEvent(opts: MockAssertionOptions = {}): NostrEvent {
  const provider = opts.provider ?? 'a'.padEnd(64, 'a')
  const subject = opts.subject ?? 'b'.padEnd(64, 'b')

  const tags: string[][] = [
    ['d', subject],
    ['p', provider],
    ...(opts.ringEndorsement ? [['veil-ring', provider]] : []),
    ...(opts.metrics ?? []),
  ]

  return {
    id: nextId(),
    pubkey: provider,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30382,
    tags,
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}
