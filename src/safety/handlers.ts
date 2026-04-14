import type { ExtendedSigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'

/**
 * Configure a duress persona — derives it and pre-warms relay connections.
 *
 * @param args - `{ personaName? }` — name of the duress persona to derive; defaults to `'anonymous'`.
 * @returns `{ npub, configured: true }` — the npub of the derived duress identity.
 * @example
 * await handleDuressConfigure(ctx, pool, { personaName: 'decoy' })
 * // { npub: 'npub1xyz...', configured: true }
 */
export async function handleDuressConfigure(
  ctx: ExtendedSigningContext,
  pool: RelayPool,
  args: { personaName?: string },
): Promise<{ npub: string; configured: boolean }> {
  const name = args.personaName ?? 'anonymous'
  const persona = await ctx.derivePersona(name, 0)
  return { npub: persona.npub, configured: true }
}

/**
 * Activate duress persona — switches identity. Response is identical to identity_switch.
 *
 * @param args - `{ personaName? }` — name of the duress persona to activate; defaults to `'anonymous'`.
 * @returns `{ npub }` — the npub of the now-active duress identity.
 * @example
 * await handleDuressActivate(ctx, { personaName: 'decoy' })
 * // { npub: 'npub1xyz...' }
 */
export async function handleDuressActivate(
  ctx: ExtendedSigningContext,
  args: { personaName?: string },
): Promise<{ npub: string }> {
  const name = args.personaName ?? 'anonymous'
  await ctx.switch(name)
  return { npub: ctx.activeNpub }
}
