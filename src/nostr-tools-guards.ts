import type { EventTemplate, VerifiedEvent } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'

/**
 * Guards for two nostr-tools (2.24) behaviours that otherwise mislead or crash
 * bray. Every pool bray creates goes through these: the relay pool, the bunker
 * daemon, the bunker client and bunker pairing.
 */

/** Signs a NIP-42 kind 22242 template for one relay. */
export type ChallengeSigner = (evt: EventTemplate) => Promise<VerifiedEvent>

const guardedRelays = new WeakSet<AbstractRelay>()

/**
 * Keep a refused automatic AUTH from ending the process.
 *
 * nostr-tools answers a relay's challenge with `this.auth(this.onauth)` and
 * rethrows any refusal from that promise's `.catch`, where nothing can handle
 * it, so Node exits on the unhandled rejection. A relay that refuses the AUTH
 * (a members-only relay, a key it does not know, an AUTH that names another URL)
 * therefore crashed the CLI, even when the relay would have served the operation
 * without it; the bunker daemon, the bunker client and the MCP server answer
 * challenges the same way and were exposed alike.
 *
 * Only the automatic answer is quietened: it is the one call made with the
 * relay's own `onauth`. `auth()` keeps its first attempt, so an operation that
 * then needs auth (the on-demand retry) still receives the relay's refusal and
 * reports it.
 */
function guardAutomaticAuth(relay: AbstractRelay): void {
  if (guardedRelays.has(relay)) return
  guardedRelays.add(relay)
  const auth = relay.auth.bind(relay)
  relay.auth = signer => {
    const attempt = auth(signer)
    return signer === relay.onauth ? attempt.catch(() => '') : attempt
  }
}

/**
 * Have a nostr-tools SimplePool answer every relay's NIP-42 challenge as it
 * arrives, with each answer guarded as above. `signerFor` returns the signer
 * for a relay URL, or null to leave that relay unanswered; `undefined` stops
 * answering. Use this rather than setting `pool.automaticallyAuth`.
 */
export function setAutomaticAuth(
  pool: object,
  signerFor: ((relayUrl: string) => ChallengeSigner | null) | undefined,
): void {
  // The relay map is protected in nostr-tools' types. nostr-tools calls
  // automaticallyAuth from ensureRelay once the relay is in the map and before
  // it connects, so the guard is in place before any challenge can arrive.
  const relays = (pool as { relays: Map<string, AbstractRelay> }).relays
  ;(pool as { automaticallyAuth?: (url: string) => ChallengeSigner | null }).automaticallyAuth = signerFor && ((url: string) => {
    const sign = signerFor(url)
    const relay = sign ? relays.get(url) : undefined
    if (relay) guardAutomaticAuth(relay)
    return sign
  })
}

/**
 * Whether a resolved per-relay publish result is nostr-tools' report that it
 * could not connect ("connection failure: ..."), which it resolves with instead
 * of rejecting: the event never left this machine. Any other resolved value is
 * the relay's OK message.
 */
export function isConnectionFailure(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('connection failure: ')
}
