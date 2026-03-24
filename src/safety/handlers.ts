import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

/** Configure a duress persona — derives it and pre-warms relay connections */
export function handleDuressConfigure(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { personaName?: string },
): { npub: string; configured: boolean } {
  const name = args.personaName ?? 'anonymous'
  const persona = ctx.derivePersona(name, 0)
  return { npub: persona.npub, configured: true }
}

/** Activate duress persona — switches identity. Response is identical to identity_switch. */
export function handleDuressActivate(
  ctx: IdentityContext,
  args: { personaName?: string },
): { npub: string } {
  const name = args.personaName ?? 'anonymous'
  ctx.switch(name)
  return { npub: ctx.activeNpub }
}
