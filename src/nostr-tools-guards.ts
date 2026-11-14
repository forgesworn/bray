import type { EventTemplate, VerifiedEvent } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'

/**
 * Guards for three nostr-tools (2.24) behaviours that otherwise mislead or crash
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

const sendGuardedRelays = new WeakSet<AbstractRelay>()

/** The pending-publish entry nostr-tools keeps per event id; private in its types. */
type PendingPublish = { reject(reason: unknown): void; timeout: ReturnType<typeof setTimeout> }

/**
 * Keep a send on a closed connection from ending the process.
 *
 * nostr-tools sends an AUTH answer, and a subscription's REQ, without awaiting
 * the send, and `send` rejects once the connection has closed. A relay that
 * dropped the connection while the AUTH signature was still being made (a
 * remote signer can take many seconds) therefore left a rejection nothing
 * handled, and Node exited. Every send gets a handler here. A failed AUTH send
 * also fails that AUTH at once with the send's error, the one nostr-tools'
 * own automatic answer already ignores, instead of leaving it to report
 * "auth timed out" seconds later.
 */
function guardSends(relay: AbstractRelay): void {
  if (sendGuardedRelays.has(relay)) return
  sendGuardedRelays.add(relay)
  const send = relay.send.bind(relay)
  relay.send = message => {
    const sent = send(message)
    sent.catch(err => { if (message.startsWith('["AUTH",')) failPendingAuth(relay, message, err) })
    return sent
  }
}

function failPendingAuth(relay: AbstractRelay, message: string, err: unknown): void {
  let id: unknown
  try { id = (JSON.parse(message) as [string, { id?: unknown }])[1]?.id } catch { return }
  if (typeof id !== 'string') return
  const pending = (relay as unknown as { openEventPublishes: Map<string, PendingPublish> }).openEventPublishes
  const entry = pending.get(id)
  if (!entry) return
  clearTimeout(entry.timeout)
  pending.delete(id)
  entry.reject(err)
}

/**
 * Guard every relay a nostr-tools SimplePool connects to, as above. Call it
 * once, straight after creating the pool.
 */
export function guardRelaySends(pool: object): void {
  // The relay map is protected in nostr-tools' types. ensureRelay is the only
  // place a relay is made, and it adds the relay to the map before it starts
  // connecting, so the relay is guarded before any message can arrive. The map
  // is read on each call because destroy() replaces it.
  const p = pool as { relays: Map<string, AbstractRelay>; ensureRelay: (...args: unknown[]) => Promise<AbstractRelay> }
  const ensureRelay = p.ensureRelay.bind(pool)
  p.ensureRelay = (...args) => {
    const ready = ensureRelay(...args)
    for (const relay of p.relays.values()) guardSends(relay)
    return ready
  }
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
