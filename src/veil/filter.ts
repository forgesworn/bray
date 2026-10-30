import type { ScoredEvent } from './scoring.js'

export type TrustMode = 'strict' | 'annotate' | 'off'

export interface FilterOptions {
  mode?: TrustMode
  threshold?: number
  /** Authors let through in strict mode even with no endorsements: the caller's follows and trusted publishers. */
  trustedAuthors?: Set<string>
}

export function filterByTrust(
  events: ScoredEvent[],
  opts?: FilterOptions,
): ScoredEvent[] {
  const mode = opts?.mode ?? 'strict'
  const threshold = opts?.threshold ?? 1

  if (mode === 'off') return events
  if (mode === 'annotate') return events
  // strict
  const trusted = opts?.trustedAuthors
  return events.filter(e => e._trustScore >= threshold || (trusted?.has(e.pubkey) ?? false))
}
