import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { fromMnemonic } from 'nsec-tree'
import type { LinkageProof } from 'nsec-tree'
import type { IdentityContext } from '../context.js'
import type { PublicIdentity } from '../types.js'

export interface DeriveResult extends PublicIdentity {
  hint?: string
}

/** Generate a fresh identity — returns mnemonic + master npub, no raw private keys */
export function handleIdentityCreate(): { npub: string; mnemonic: string } {
  const mnemonic = generateMnemonic(wordlist, 256) // 24 words
  const root = fromMnemonic(mnemonic)
  const npub = root.masterPubkey
  root.destroy()
  return { npub, mnemonic }
}

/** Derive a child identity by purpose and index */
export async function handleIdentityDerive(
  ctx: IdentityContext,
  args: { purpose: string; index: number },
): Promise<DeriveResult> {
  // Check before deriving — if only master exists, this is the first derivation
  const identitiesBefore = await ctx.listIdentities()
  const isFirstDerivation = identitiesBefore.length <= 1

  const identity = await ctx.derive(args.purpose, args.index)
  const result: DeriveResult = { ...identity }

  if (isFirstDerivation) {
    result.hint = 'Consider running identity-setup for guided safe identity creation with backup and relay configuration.'
  }

  return result
}

/** Derive a named persona */
export async function handleIdentityDerivePersona(
  ctx: IdentityContext,
  args: { name: string; index: number },
): Promise<PublicIdentity> {
  return ctx.derivePersona(args.name, args.index)
}

/** Switch active identity */
export async function handleIdentitySwitch(
  ctx: IdentityContext,
  args: { target: string; index?: number },
): Promise<{ npub: string }> {
  await ctx.switch(args.target, args.index)
  return { npub: ctx.activeNpub }
}

/** List all known identities — returns public info only */
export async function handleIdentityList(ctx: IdentityContext): Promise<PublicIdentity[]> {
  return ctx.listIdentities()
}

/** Create a linkage proof for the active identity. Defaults to blind (no purpose/index). */
export async function handleIdentityProve(
  ctx: IdentityContext,
  args: { mode?: 'blind' | 'full' },
): Promise<LinkageProof> {
  return ctx.prove(args.mode ?? 'blind')
}
