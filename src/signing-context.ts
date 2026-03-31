import type { LinkageProof } from 'nsec-tree'
import type { PublicIdentity, SignFn } from './types.js'

/** Base contract for all signing contexts (local, bunker, Heartwood). */
export interface SigningContext {
  readonly activeNpub: string
  readonly activePublicKeyHex: string
  getSigningFunction(): SignFn
  listIdentities(): Promise<PublicIdentity[]>
  nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string>
  destroy(): void
}

/** Extended contract for contexts that support nsec-tree operations (local, Heartwood). */
export interface ExtendedSigningContext extends SigningContext {
  derive(purpose: string, index: number): Promise<PublicIdentity>
  derivePersona(name: string, index: number): Promise<PublicIdentity>
  switch(purposeOrName: string, index?: number): Promise<void>
  prove(mode?: 'blind' | 'full'): Promise<LinkageProof>
  recover(lookahead?: number): Promise<PublicIdentity[]>
}

/** Type guard: does this context support nsec-tree operations? */
export function hasExtendedIdentity(ctx: SigningContext): ctx is ExtendedSigningContext {
  return 'derive' in ctx && 'switch' in ctx && 'prove' in ctx
}
