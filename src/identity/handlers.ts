import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { fromMnemonic } from 'nsec-tree'
import type { LinkageProof } from 'nsec-tree'
import type { SigningContext, ExtendedSigningContext } from '../signing-context.js'
import type { PublicIdentity } from '../types.js'
import type { RelayPool } from '../relay-pool.js'

export interface DeriveResult extends PublicIdentity {
  hint?: string
}

/**
 * Generate a fresh identity — returns mnemonic + master npub, no raw private keys.
 *
 * @returns An object containing the `npub` (bech32 master public key) and the
 *   24-word BIP-39 `mnemonic` that seeds the identity tree. Store the mnemonic
 *   securely; it cannot be recovered from this response.
 *
 * @example
 * const { npub, mnemonic } = handleIdentityCreate()
 * // npub1abc...
 * // mnemonic: "abandon ability able about above absent absorb abstract ..."
 */
export function handleIdentityCreate(): { npub: string; mnemonic: string } {
  const mnemonic = generateMnemonic(wordlist, 256) // 24 words
  const root = fromMnemonic(mnemonic)
  const npub = root.masterPubkey
  root.destroy()
  return { npub, mnemonic }
}

/**
 * Derive a child identity by purpose and index.
 *
 * @param args - Derivation parameters.
 * @param args.purpose - A human-readable label for the derivation path (e.g. `"payments"`, `"social"`).
 * @param args.index - Zero-based integer index within the given purpose branch.
 * @returns The derived {@link DeriveResult} containing the child npub and, on first
 *   derivation, a `hint` suggesting the guided setup workflow.
 *
 * @example
 * const identity = await handleIdentityDerive(ctx, { purpose: 'social', index: 0 })
 * console.log(identity.npub)  // npub1xyz...
 * console.log(identity.hint)  // Set only when this is the first child derivation
 */
export async function handleIdentityDerive(
  ctx: ExtendedSigningContext,
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

/**
 * Derive a named persona.
 *
 * @param args - Persona derivation parameters.
 * @param args.name - Display name for the persona (e.g. `"work"`, `"anon"`).
 * @param args.index - Zero-based integer distinguishing multiple personas with the same name.
 * @returns The {@link PublicIdentity} of the newly derived persona, containing its npub.
 *
 * @example
 * const persona = await handleIdentityDerivePersona(ctx, { name: 'work', index: 0 })
 * console.log(persona.npub)  // npub1...
 */
export async function handleIdentityDerivePersona(
  ctx: ExtendedSigningContext,
  args: { name: string; index: number },
): Promise<PublicIdentity> {
  return ctx.derivePersona(args.name, args.index)
}

/**
 * Switch active identity.
 *
 * @param args - Switch target parameters.
 * @param args.target - Purpose label or persona name of the identity to activate.
 * @param args.index - Optional zero-based index within the target branch; defaults to `0`.
 * @returns An object with the `npub` of the newly active identity.
 *
 * @example
 * const { npub } = await handleIdentitySwitch(ctx, { target: 'social', index: 1 })
 * console.log(npub)  // npub1...
 */
export async function handleIdentitySwitch(
  ctx: ExtendedSigningContext,
  args: { target: string; index?: number },
): Promise<{ npub: string }> {
  await ctx.switch(args.target, args.index)
  return { npub: ctx.activeNpub }
}

/**
 * List all known identities — returns public info only.
 *
 * @returns An array of {@link PublicIdentity} objects (npub + metadata) for every
 *   identity currently cached in the context. Never includes key material.
 *
 * @example
 * const identities = await handleIdentityList(ctx)
 * identities.forEach(id => console.log(id.npub))
 */
export async function handleIdentityList(ctx: SigningContext): Promise<PublicIdentity[]> {
  return ctx.listIdentities()
}

export interface AcceptMigrationResult {
  acceptanceEventId: string
  oldNpub: string
  newNpub: string
  migrationVerified: boolean
}

/**
 * Accept a migration from an external signer. Signs and publishes the acceptance event.
 *
 * @param args - Migration acceptance parameters.
 * @param args.oldNpub - The bech32 npub of the identity being migrated away from.
 * @param args.migrationEventId - Optional event ID of a kind-30078 migration event to
 *   fetch from relays and verify before signing the acceptance.
 * @returns An {@link AcceptMigrationResult} describing the published acceptance event ID,
 *   the old and new npubs, and whether the migration event was cryptographically verified.
 *
 * @example
 * const result = await handleAcceptMigration(ctx, pool, {
 *   oldNpub: 'npub1old...',
 *   migrationEventId: 'abc123...',
 * })
 * console.log(result.acceptanceEventId)  // event id of the published acceptance
 * console.log(result.migrationVerified)  // true if the migration event signature checked out
 */
export async function handleAcceptMigration(
  ctx: SigningContext,
  pool: RelayPool,
  args: { oldNpub: string; migrationEventId?: string },
): Promise<AcceptMigrationResult> {
  const { decode: decodeBech32 } = await import('nostr-tools/nip19')
  const oldPubkeyHex = decodeBech32(args.oldNpub).data as unknown as string

  let migrationVerified = false

  // If a migration event ID is provided, fetch and verify it
  if (args.migrationEventId) {
    const events = await pool.query(ctx.activeNpub, {
      ids: [args.migrationEventId],
    })

    if (events.length === 0) {
      throw new Error(`Migration event ${args.migrationEventId} not found on relays`)
    }

    const migrationEvent = events[0]
    const { verifyEvent } = await import('nostr-tools/pure')
    if (!verifyEvent(migrationEvent)) {
      throw new Error('Migration event has invalid signature')
    }
    if (migrationEvent.pubkey !== oldPubkeyHex) {
      throw new Error(`Migration event was signed by ${migrationEvent.pubkey}, expected ${oldPubkeyHex}`)
    }

    migrationVerified = true
  }

  // Sign the acceptance event
  const sign = ctx.getSigningFunction()
  const acceptanceEvent = await sign({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `migration-accept:${oldPubkeyHex}`],
      ['p', oldPubkeyHex],
      ...(args.migrationEventId ? [['e', args.migrationEventId]] : []),
    ],
    content: JSON.stringify({
      type: 'migration-acceptance',
      from: args.oldNpub,
      to: ctx.activeNpub,
    }),
  })

  await pool.publish(ctx.activeNpub, acceptanceEvent)

  return {
    acceptanceEventId: acceptanceEvent.id,
    oldNpub: args.oldNpub,
    newNpub: ctx.activeNpub,
    migrationVerified,
  }
}

/**
 * Create a linkage proof for the active identity. Defaults to blind (no purpose/index).
 *
 * @param args - Proof options.
 * @param args.mode - `'blind'` omits purpose and index from the proof (default);
 *   `'full'` includes the full derivation path, enabling third-party verification of the
 *   parent–child relationship.
 * @returns A {@link LinkageProof} that can be embedded in a Nostr event to attest the
 *   link between a child identity and its master.
 *
 * @example
 * const proof = await handleIdentityProve(ctx, { mode: 'full' })
 * // Embed proof.proof in a kind-30078 event content to publish the linkage
 */
export async function handleIdentityProve(
  ctx: ExtendedSigningContext,
  args: { mode?: 'blind' | 'full' },
): Promise<LinkageProof> {
  return ctx.prove(args.mode ?? 'blind')
}
