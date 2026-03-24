import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { fromMnemonic } from 'nsec-tree'
import type { IdentityContext } from '../context.js'
import type { PublicIdentity } from '../types.js'

/** Generate a fresh identity — returns mnemonic + master npub, no raw private keys */
export function handleIdentityCreate(): { npub: string; mnemonic: string } {
  const mnemonic = generateMnemonic(wordlist, 256) // 24 words
  const root = fromMnemonic(mnemonic)
  const npub = root.masterPubkey
  root.destroy()
  return { npub, mnemonic }
}

/** Derive a child identity by purpose and index */
export function handleIdentityDerive(
  ctx: IdentityContext,
  args: { purpose: string; index: number },
): PublicIdentity {
  return ctx.derive(args.purpose, args.index)
}

/** Derive a named persona */
export function handleIdentityDerivePersona(
  ctx: IdentityContext,
  args: { name: string; index: number },
): PublicIdentity {
  return ctx.derivePersona(args.name, args.index)
}

/** Switch active identity */
export function handleIdentitySwitch(
  ctx: IdentityContext,
  args: { target: string; index?: number },
): { npub: string } {
  ctx.switch(args.target, args.index)
  return { npub: ctx.activeNpub }
}

/** List all known identities — returns public info only */
export function handleIdentityList(ctx: IdentityContext): PublicIdentity[] {
  return ctx.listIdentities()
}
