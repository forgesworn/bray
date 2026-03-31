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

/** Derive a named persona */
export async function handleIdentityDerivePersona(
  ctx: ExtendedSigningContext,
  args: { name: string; index: number },
): Promise<PublicIdentity> {
  return ctx.derivePersona(args.name, args.index)
}

/** Switch active identity */
export async function handleIdentitySwitch(
  ctx: ExtendedSigningContext,
  args: { target: string; index?: number },
): Promise<{ npub: string }> {
  await ctx.switch(args.target, args.index)
  return { npub: ctx.activeNpub }
}

/** List all known identities — returns public info only */
export async function handleIdentityList(ctx: SigningContext): Promise<PublicIdentity[]> {
  return ctx.listIdentities()
}

export interface AcceptMigrationResult {
  acceptanceEventId: string
  oldNpub: string
  newNpub: string
  migrationVerified: boolean
}

/** Accept a migration from an external signer. Signs and publishes the acceptance event. */
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

/** Create a linkage proof for the active identity. Defaults to blind (no purpose/index). */
export async function handleIdentityProve(
  ctx: ExtendedSigningContext,
  args: { mode?: 'blind' | 'full' },
): Promise<LinkageProof> {
  return ctx.prove(args.mode ?? 'blind')
}
