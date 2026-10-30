import { vi } from 'vitest'
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

/**
 * Build a kind 3 follow list owned by `owner`.
 */
export function mockFollowEvent(owner: string, follows: string[], createdAt = Math.floor(Date.now() / 1000)): NostrEvent {
  return {
    id: nextId(),
    pubkey: owner,
    created_at: createdAt,
    kind: 3,
    tags: follows.map(f => ['p', f]),
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

export interface MockRingProofOptions {
  /** Who published the aggregated proof */
  publisher: string
  subject: string
  /** Sorted ring members (hex pubkeys) */
  members: string[]
  /** One veil-sig tag per key image */
  keyImages: string[]
  /** electionId inside each signature JSON (default: one shared scope) */
  electionId?: string
  threshold?: number
}

/**
 * Build a kind 30382 ring proof with real-looking tags. The signatures are
 * placeholders: tests mock verifyProof, so only the tag shapes matter.
 */
export function mockRingProofEvent(opts: MockRingProofOptions): NostrEvent {
  const electionId = opts.electionId ?? 'scope-default'
  return {
    id: nextId(),
    pubkey: opts.publisher,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30382,
    tags: [
      ['d', opts.subject],
      ['veil-ring', ...opts.members],
      ['veil-threshold', String(opts.threshold ?? 1), String(opts.members.length)],
      ...opts.keyImages.map(image => ['veil-sig', JSON.stringify({ electionId }), image]),
    ],
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

export interface MockVeilPoolOptions {
  /** Answers kind 30382 queries */
  assertions?: NostrEvent[]
  /** Answers kind 3 queries */
  follows?: NostrEvent[]
  /** Answers any other query (feed or notification events) */
  other?: NostrEvent[]
}

/**
 * A relay pool that answers by filter: kind 3 returns the follow events,
 * kind 30382 returns the assertions, anything else returns `other`.
 */
export function mockVeilPool(opts: MockVeilPoolOptions = {}) {
  return {
    query: vi.fn().mockImplementation((_npub: string, filter: { kinds?: number[]; authors?: string[] }) => {
      if (filter.kinds?.includes(3)) {
        return Promise.resolve((opts.follows ?? []).filter(e => !filter.authors || filter.authors.includes(e.pubkey)))
      }
      if (filter.kinds?.includes(30382)) return Promise.resolve(opts.assertions ?? [])
      return Promise.resolve(opts.other ?? [])
    }),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}
