import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'

/** Kinds to backup and the subset that can be re-signed */
const BACKUP_KINDS = [0, 3, 10002, 31000]
const RESIGNABLE_KINDS = new Set([0, 3, 10002])

export interface BackupBundle {
  pubkeyHex: string
  events: NostrEvent[]
}

export interface RestoreResult {
  restored: Array<{ kind: number; id: string }>
  skipped: Array<{ kind: number; reason: string }>
}

export interface MigrateSummary {
  profileFields: string[]
  contactCount: number
  relayCount: number
  attestationCount: number
}

export interface MigrateResult {
  status: 'preview' | 'migrated'
  summary: MigrateSummary
}

/** Fetch all relevant events for a pubkey (profile, contacts, relay list, attestations) */
export async function handleIdentityBackup(
  pool: RelayPool,
  pubkeyHex: string,
  npub: string,
): Promise<BackupBundle> {
  const events = await pool.query(npub, {
    kinds: BACKUP_KINDS,
    authors: [pubkeyHex],
  })

  return { pubkeyHex, events }
}

/** Re-sign migratable events under the active identity. Skips attestations (trust chain protection). */
export async function handleIdentityRestore(
  ctx: IdentityContext,
  pool: RelayPool,
  backup: BackupBundle,
): Promise<RestoreResult> {
  const sign = ctx.getSigningFunction()
  const restored: RestoreResult['restored'] = []
  const skipped: RestoreResult['skipped'] = []

  for (const event of backup.events) {
    // Verify signature and author before re-signing
    if (!verifyEvent(event) || event.pubkey !== backup.pubkeyHex) {
      skipped.push({
        kind: event.kind,
        reason: `Event ${event.id} failed signature verification or author mismatch`,
      })
      continue
    }

    if (!RESIGNABLE_KINDS.has(event.kind)) {
      skipped.push({
        kind: event.kind,
        reason: `Kind ${event.kind} attestation — cannot re-sign (trust chain protection)`,
      })
      continue
    }

    // Re-sign the event content under the new identity
    const template: EventTemplate = {
      kind: event.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: event.tags,
      content: event.content,
    }

    const signed = await sign(template)
    restored.push({ kind: event.kind, id: signed.id })
  }

  return { restored, skipped }
}

/** Migrate identity: preview first, then execute when confirmed */
export async function handleIdentityMigrate(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { oldPubkeyHex: string; oldNpub: string; confirm: boolean },
): Promise<MigrateResult> {
  const backup = await handleIdentityBackup(pool, args.oldPubkeyHex, args.oldNpub)

  // Build summary
  const profileEvent = backup.events.find(e => e.kind === 0)
  let profileFields: string[] = []
  if (profileEvent) {
    try {
      const parsed = JSON.parse(profileEvent.content)
      profileFields = Object.keys(parsed)
    } catch { /* empty profile */ }
  }

  const contactEvent = backup.events.find(e => e.kind === 3)
  const contactCount = contactEvent?.tags.filter(t => t[0] === 'p').length ?? 0

  const relayEvent = backup.events.find(e => e.kind === 10002)
  const relayCount = relayEvent?.tags.filter(t => t[0] === 'r').length ?? 0

  const attestationCount = backup.events.filter(e => e.kind === 31000).length

  const summary: MigrateSummary = { profileFields, contactCount, relayCount, attestationCount }

  if (!args.confirm) {
    return { status: 'preview', summary }
  }

  // Execute migration: re-sign migratable events
  await handleIdentityRestore(ctx, pool, backup)

  // Publish linkage proof connecting old → new (only if operating as a derived identity)
  try {
    const proof = await ctx.prove('full')
    const sign = ctx.getSigningFunction()
    const proofEvent = await sign({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `migration:${args.oldPubkeyHex}`],
        ['p', args.oldPubkeyHex],
      ],
      content: JSON.stringify(proof),
    })
    await pool.publish(args.oldNpub, proofEvent)
  } catch {
    // Master identity can't produce tree proofs — migration proceeds without linkage proof
  }

  return { status: 'migrated', summary }
}
