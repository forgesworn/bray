/**
 * HeartwoodContext — a BunkerContext that speaks nsec-tree extensions.
 *
 * Heartwood is a hardware signing appliance that implements NIP-46 with
 * extension methods for identity derivation, switching, proofs, and recovery.
 * HeartwoodContext auto-detects these extensions by probing the remote signer.
 */

import { BunkerContext, withTimeout, TimeoutError, REQUEST_TIMEOUT_MS } from './bunker-context.js'
import type { LinkageProof } from 'nsec-tree'
import type { PublicIdentity } from './types.js'
import type { ExtendedSigningContext } from './signing-context.js'

/**
 * Why {@link HeartwoodContext.listIdentities} is unavailable for this
 * pairing, set by {@link HeartwoodContext.probe} when it could not confirm
 * identity listing works.
 *
 * - `'denied'` -- the device (or a strict-policy slot) refused
 *   `heartwood_list_identities` with an unauthorised/denied error.
 * - `'pending-approval'` -- the probe's `heartwood_list_identities` request
 *   timed out, most likely because it is awaiting a button press on the
 *   device right now.
 */
export type HeartwoodListingUnavailableReason = 'denied' | 'pending-approval'

/** Matches an error whose text indicates the remote signer does not know the method at all. */
function isMethodUnknownError(message: string): boolean {
  return /unsupported method|method not found|unknown method|no such method|not implemented/i.test(message)
}

/** Matches an error whose text indicates the request was understood but refused by policy. */
function isUnauthorisedError(message: string): boolean {
  return /unauthori[sz]ed|denied|not permitted|forbidden/i.test(message)
}

/** How long a Heartwood request runs before we hint that it's probably
 *  waiting on a device button press. Well under REQUEST_TIMEOUT_MS so the
 *  hint has a chance to show before the request either completes or times out. */
const APPROVAL_HINT_MS = 3_000

/**
 * Wrap a Heartwood NIP-46 request with the standard 60s timeout, and log a
 * one-off hint to stderr if it's still pending after {@link APPROVAL_HINT_MS}.
 * bray is an MCP server over stdio, so this MUST go to stderr (console.error,
 * same channel every other log line in this codebase uses) and never stdout,
 * which carries the JSON-RPC transport.
 */
function withApprovalHint<T>(promise: Promise<T>, label: string): Promise<T> {
  const hint = setTimeout(() => {
    console.error(`Waiting for approval on your Heartwood (${label})...`)
  }, APPROVAL_HINT_MS)
  return withTimeout(promise, REQUEST_TIMEOUT_MS, label).finally(() => clearTimeout(hint))
}

/** Extract a human-readable message from whatever `sendRequest` rejected with.
 *  NIP-46 error responses reject with a bare string (the signer's `error`
 *  field); our own code (timeouts, network failures) rejects with an `Error`. */
function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return String(e)
}

export class HeartwoodContext extends BunkerContext implements ExtendedSigningContext {
  /** Whether `listIdentities()` (and thus features that depend on the
   *  device's identity list) is expected to work for this pairing. `true`
   *  unless `probe()` could not confirm listing works. */
  listingAvailable = true

  /** Set by `probe()` alongside `listingAvailable = false`; explains why. */
  listingUnavailableReason?: HeartwoodListingUnavailableReason

  /** Human-readable explanation of `listingUnavailableReason`, suitable for
   *  logging or surfacing to a caller. Undefined when listing is available. */
  listingUnavailableMessage?: string

  /**
   * Probe a connected BunkerContext for Heartwood extensions.
   *
   * Returns `null` when the remote signer does not speak the Heartwood
   * dialect at all (method unknown/unsupported, or a response that doesn't
   * look like an identity list) -- the base context stays a plain bunker,
   * silently, as before.
   *
   * Returns a `HeartwoodContext` in every other case where the device IS a
   * Heartwood but identity listing could not be confirmed:
   * - the request was refused by policy (`unauthorised`/denied -- e.g. a
   *   strict slot that doesn't list `heartwood_list_identities`), or
   * - the request timed out, most likely because it's awaiting a button
   *   press on the device right now.
   *
   * In both of those cases `listingAvailable` is set to `false` and
   * `listingUnavailableReason` / `listingUnavailableMessage` explain why.
   * Callers that only check "is this a Heartwood" (`hw !== null` /
   * `instanceof HeartwoodContext`) see no change in behaviour.
   */
  static async probe(base: BunkerContext): Promise<HeartwoodContext | null> {
    // Cast to access protected signer — safe because HeartwoodContext extends BunkerContext
    const signer = (base as HeartwoodContext).signer
    let result: string
    try {
      result = await withTimeout(
        signer.sendRequest('heartwood_list_identities', []),
        REQUEST_TIMEOUT_MS,
        'heartwood probe (heartwood_list_identities)',
      )
    } catch (e) {
      const message = errorMessage(e)
      if (e instanceof TimeoutError) {
        return HeartwoodContext.upgrade(base, 'pending-approval',
          'Heartwood is awaiting approval on the device for identity listing ' +
          '(heartwood_list_identities timed out) -- approve the pending request on the device.')
      }
      if (isUnauthorisedError(message)) {
        return HeartwoodContext.upgrade(base, 'denied',
          'Heartwood denied identity listing for this pairing; allow heartwood_list_identities for this app in Sapwood.')
      }
      if (isMethodUnknownError(message)) return null
      // Anything else is genuinely ambiguous -- keep the previous, conservative
      // behaviour of treating it as "not a Heartwood" rather than guessing.
      return null
    }
    if (!isHeartwoodIdentitiesResponse(result)) return null
    // Re-class the base context as HeartwoodContext. Object.setPrototypeOf
    // only swaps the prototype -- it does NOT re-run class field
    // initialisers on an object that was constructed as a plain
    // BunkerContext, so `listingAvailable` must be set explicitly here.
    const hw = Object.setPrototypeOf(base, HeartwoodContext.prototype) as HeartwoodContext
    hw.listingAvailable = true
    hw.listingUnavailableReason = undefined
    hw.listingUnavailableMessage = undefined
    return hw
  }

  /** Re-class `base` as a HeartwoodContext with listing marked unavailable. */
  private static upgrade(
    base: BunkerContext,
    reason: HeartwoodListingUnavailableReason,
    message: string,
  ): HeartwoodContext {
    const hw = Object.setPrototypeOf(base, HeartwoodContext.prototype) as HeartwoodContext
    hw.listingAvailable = false
    hw.listingUnavailableReason = reason
    hw.listingUnavailableMessage = message
    return hw
  }

  /** Derive a child identity by purpose and index on the Heartwood device.
   *  Does not depend on `heartwood_list_identities` -- works even when
   *  `listingAvailable` is `false`. */
  async derive(purpose: string, index: number): Promise<PublicIdentity> {
    const result = await withApprovalHint(
      this.signer.sendRequest('heartwood_derive', [purpose, String(index)]),
      'heartwood derive',
    )
    return JSON.parse(result) as PublicIdentity
  }

  /** Derive a named persona on the Heartwood device.
   *  Does not depend on `heartwood_list_identities` -- works even when
   *  `listingAvailable` is `false`. */
  async derivePersona(name: string, index: number): Promise<PublicIdentity> {
    const result = await withApprovalHint(
      this.signer.sendRequest('heartwood_derive_persona', [name, String(index)]),
      'heartwood derive persona',
    )
    return JSON.parse(result) as PublicIdentity
  }

  /** List all known identities on the Heartwood device.
   *
   * Throws immediately, without a device round trip, when `probe()` already
   * established that listing isn't available for this pairing -- retrying
   * would just re-hit the same denial or wait out the same timeout. */
  override async listIdentities(): Promise<PublicIdentity[]> {
    if (!this.listingAvailable) {
      throw new Error(this.listingUnavailableMessage ?? 'Heartwood identity listing is unavailable for this pairing.')
    }
    const result = await withApprovalHint(
      this.signer.sendRequest('heartwood_list_identities', []),
      'heartwood list identities',
    )
    return JSON.parse(result) as PublicIdentity[]
  }

  /** Switch the active identity on the Heartwood device.
   *  Does not depend on `heartwood_list_identities` -- works even when
   *  `listingAvailable` is `false`. */
  async switch(purposeOrName: string, index?: number): Promise<void> {
    const params = index !== undefined
      ? [purposeOrName, String(index)]
      : [purposeOrName]
    const raw = await withApprovalHint(
      this.signer.sendRequest('heartwood_switch', params),
      'heartwood switch',
    )
    // Parse response — device may return { npub } object or a bare npub string
    const { decode, npubEncode } = await import('nostr-tools/nip19')
    let npub: string | undefined
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') {
        npub = parsed
      } else if (parsed && typeof parsed.npub === 'string') {
        npub = parsed.npub
      } else if (parsed && typeof parsed.pubkey === 'string') {
        // Some devices return { pubkey: hex }
        npub = npubEncode(parsed.pubkey)
      }
    } catch {
      // raw may itself be a bare npub (no JSON wrapping)
      if (typeof raw === 'string' && raw.startsWith('npub1')) npub = raw
    }
    if (!npub) {
      throw new Error(`heartwood_switch returned unexpected response: ${JSON.stringify(raw)}`)
    }
    const decoded = decode(npub)
    if (decoded.type === 'npub') {
      this.pubkeyHex = decoded.data as unknown as string
    }
  }

  /** Create a linkage proof on the Heartwood device. */
  async prove(mode: 'blind' | 'full' = 'blind'): Promise<LinkageProof> {
    const result = await withApprovalHint(
      this.signer.sendRequest('heartwood_create_proof', [this.activePublicKeyHex, mode]),
      'heartwood create proof',
    )
    return JSON.parse(result) as LinkageProof
  }

  /** Recover identities by scanning derived keys on the Heartwood device. */
  async recover(lookahead?: number): Promise<PublicIdentity[]> {
    const params = lookahead !== undefined ? [String(lookahead)] : []
    const result = await withApprovalHint(
      this.signer.sendRequest('heartwood_recover', params),
      'heartwood recover',
    )
    return JSON.parse(result) as PublicIdentity[]
  }
}

/** Check if a context is a HeartwoodContext instance. */
export function isHeartwoodContext(ctx: unknown): ctx is HeartwoodContext {
  return ctx instanceof HeartwoodContext
}

/**
 * Validate the raw JSON response from `heartwood_list_identities` before
 * upgrading a BunkerContext to a HeartwoodContext. Prevents a signer that
 * happens to return any parseable JSON (a bare number, string, or `[]`) from
 * tricking the probe into promoting the prototype — which would leave every
 * downstream Heartwood call to blow up mid-operation.
 *
 * Expected shape: array of objects each with an `npub` string. The array may
 * be empty (a device with no identities derived yet) but must still be an
 * array.
 */
export function isHeartwoodIdentitiesResponse(raw: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  if (!Array.isArray(parsed)) return false
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return false
    if (typeof (entry as Record<string, unknown>).npub !== 'string') return false
  }
  return true
}
