import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

/** Configure a duress persona — derives it and pre-warms relay connections */
export async function handleDuressConfigure(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { personaName?: string },
): Promise<{ npub: string; configured: boolean }> {
  const name = args.personaName ?? 'anonymous'
  const persona = await ctx.derivePersona(name, 0)
  return { npub: persona.npub, configured: true }
}

/** Activate duress persona — switches identity. Response is identical to identity_switch. */
export async function handleDuressActivate(
  ctx: IdentityContext,
  args: { personaName?: string },
): Promise<{ npub: string }> {
  const name = args.personaName ?? 'anonymous'
  await ctx.switch(name)
  return { npub: ctx.activeNpub }
}
