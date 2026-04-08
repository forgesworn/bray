/**
 * HeartwoodContext — a BunkerContext that speaks nsec-tree extensions.
 *
 * Heartwood is a hardware signing appliance that implements NIP-46 with
 * extension methods for identity derivation, switching, proofs, and recovery.
 * HeartwoodContext auto-detects these extensions by probing the remote signer.
 */

import { BunkerContext } from './bunker-context.js'
import type { LinkageProof } from 'nsec-tree'
import type { PublicIdentity } from './types.js'
import type { ExtendedSigningContext } from './signing-context.js'

export class HeartwoodContext extends BunkerContext implements ExtendedSigningContext {
  /**
   * Probe a connected BunkerContext for Heartwood extensions.
   * Returns a HeartwoodContext if extensions are available, null otherwise.
   *
   * The probe sends a single heartwood_list_identities request. If the remote
   * signer responds with a result (not an error), the extensions are available.
   */
  static async probe(base: BunkerContext): Promise<HeartwoodContext | null> {
    try {
      // Cast to access protected signer — safe because HeartwoodContext extends BunkerContext
      const signer = (base as HeartwoodContext).signer
      const result = await signer.sendRequest('heartwood_list_identities', [])
      // If we got a result, extensions are available
      JSON.parse(result) // validate it's parseable
      // Re-class the base context as HeartwoodContext
      return Object.setPrototypeOf(base, HeartwoodContext.prototype) as HeartwoodContext
    } catch {
      return null
    }
  }

  /** Derive a child identity by purpose and index on the Heartwood device. */
  async derive(purpose: string, index: number): Promise<PublicIdentity> {
    const result = await this.signer.sendRequest(
      'heartwood_derive',
      [purpose, String(index)],
    )
    return JSON.parse(result) as PublicIdentity
  }

  /** Derive a named persona on the Heartwood device. */
  async derivePersona(name: string, index: number): Promise<PublicIdentity> {
    const result = await this.signer.sendRequest(
      'heartwood_derive_persona',
      [name, String(index)],
    )
    const identity = JSON.parse(result) as PublicIdentity
    // Log purpose so we can verify it matches nostr:persona:{name} convention
    if (identity.purpose && identity.purpose !== `nostr:persona:${name}`) {
      console.error(`[heartwood] note: device returned purpose "${identity.purpose}", bray uses "nostr:persona:${name}"`)
    }
    return identity
  }

  /** List all known identities on the Heartwood device. */
  override async listIdentities(): Promise<PublicIdentity[]> {
    const result = await this.signer.sendRequest('heartwood_list_identities', [])
    return JSON.parse(result) as PublicIdentity[]
  }

  /** Switch the active identity on the Heartwood device. */
  async switch(purposeOrName: string, index?: number): Promise<void> {
    const params = index !== undefined
      ? [purposeOrName, String(index)]
      : [purposeOrName]
    const raw = await this.signer.sendRequest('heartwood_switch', params)
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
    const result = await this.signer.sendRequest(
      'heartwood_create_proof',
      [this.activePublicKeyHex, mode],
    )
    return JSON.parse(result) as LinkageProof
  }

  /** Recover identities by scanning derived keys on the Heartwood device. */
  async recover(lookahead?: number): Promise<PublicIdentity[]> {
    const params = lookahead !== undefined ? [String(lookahead)] : []
    const result = await this.signer.sendRequest('heartwood_recover', params)
    return JSON.parse(result) as PublicIdentity[]
  }
}

/** Check if a context is a HeartwoodContext instance. */
export function isHeartwoodContext(ctx: unknown): ctx is HeartwoodContext {
  return ctx instanceof HeartwoodContext
}
