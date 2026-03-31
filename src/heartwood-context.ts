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
    return JSON.parse(result) as PublicIdentity
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
    // The server returns { npub } — decode it to refresh the local pubkey cache
    // (BunkerSigner caches getPublicKey() so we cannot rely on it after a switch)
    const { npub } = JSON.parse(raw) as { npub: string }
    const { decode } = await import('nostr-tools/nip19')
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
