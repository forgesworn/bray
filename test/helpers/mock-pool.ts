import { vi } from 'vitest'

/**
 * Validating mock pool — catches the npub-in-filter bug.
 *
 * Real Nostr relays expect hex pubkeys in authors/p-tag filters.
 * This mock validates filter fields to catch bech32 npubs that
 * would cause "bad req: uneven size input to from_hex" on real relays.
 */

const HEX_RE = /^[0-9a-f]{64}$/

function validateFilter(filter: Record<string, unknown>): void {
  // Check authors array — must be hex, not npub
  const authors = filter.authors as string[] | undefined
  if (authors) {
    for (const a of authors) {
      if (a.startsWith('npub1')) {
        throw new Error(`Mock pool: bech32 npub "${a.slice(0, 15)}..." passed in authors filter — relays expect 64-char hex. Use ctx.activePublicKeyHex instead of ctx.activeNpub.`)
      }
      if (!HEX_RE.test(a) && a !== '') {
        throw new Error(`Mock pool: invalid author "${a.slice(0, 15)}..." — expected 64-char hex`)
      }
    }
  }

  // Check #p tag filter — must be hex, not npub
  const pTags = filter['#p'] as string[] | undefined
  if (pTags) {
    for (const p of pTags) {
      if (p.startsWith('npub1')) {
        throw new Error(`Mock pool: bech32 npub "${p.slice(0, 15)}..." passed in #p filter — relays expect 64-char hex. Use ctx.activePublicKeyHex.`)
      }
    }
  }
}

/** Create a mock pool that validates filter fields like a real relay would */
export function createValidatingMockPool(events: any[] = []) {
  return {
    query: vi.fn().mockImplementation(async (_npub: string, filter: any) => {
      validateFilter(filter)
      return events
    }),
    publish: vi.fn().mockResolvedValue({
      success: true,
      allAccepted: true,
      accepted: ['wss://mock.relay'],
      rejected: [],
      errors: [],
    }),
    getRelays: vi.fn().mockReturnValue({
      read: ['wss://mock.relay'],
      write: ['wss://mock.relay'],
    }),
    reconfigure: vi.fn(),
    checkSharedRelays: vi.fn().mockReturnValue([]),
  }
}
