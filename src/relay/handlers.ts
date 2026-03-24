import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { RelaySet, PublishResult } from '../types.js'

export interface RelayListResult {
  read: string[]
  write: string[]
  sharedWarning?: string
}

export interface RelayEntry {
  url: string
  mode?: 'read' | 'write' // undefined means both
}

/** Get relay list for the active identity, optionally checking for shared relays with another identity */
export function handleRelayList(
  ctx: IdentityContext,
  pool: RelayPool,
  compareWithNpub?: string,
): RelayListResult {
  const relays = pool.getRelays(ctx.activeNpub)
  const result: RelayListResult = {
    read: relays.read,
    write: relays.write,
  }

  if (compareWithNpub) {
    const shared = pool.checkSharedRelays(ctx.activeNpub, compareWithNpub)
    if (shared.length > 0) {
      result.sharedWarning = `Shared relays with ${compareWithNpub}: ${shared.join(', ')}. This may link identities.`
    }
  }

  return result
}

/** Publish a kind 10002 relay list */
export async function handleRelaySet(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { relays: RelayEntry[]; confirm?: boolean },
): Promise<{ event: NostrEvent; published: boolean; publish?: PublishResult; warning?: string }> {
  // Check for existing relay list
  const existing = await pool.query(ctx.activeNpub, {
    kinds: [10002],
    authors: [ctx.activeNpub],
  })

  // Build r-tags
  const tags: string[][] = args.relays.map(r => {
    if (r.mode) return ['r', r.url, r.mode]
    return ['r', r.url]
  })

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })

  if (existing.length > 0 && !args.confirm) {
    return {
      event,
      published: false,
      warning: 'Relay list already exists. Set confirm: true to overwrite.',
    }
  }

  const publish = await pool.publish(ctx.activeNpub, event)

  // Reconfigure the pool with the new relay set
  const read = args.relays.filter(r => !r.mode || r.mode === 'read').map(r => r.url)
  const write = args.relays.filter(r => !r.mode || r.mode === 'write').map(r => r.url)
  pool.reconfigure(ctx.activeNpub, { read, write })

  return { event, published: true, publish }
}

/** Add a single relay to the active identity's relay set */
export function handleRelayAdd(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { url: string; mode?: 'read' | 'write' },
): { reconfigured: boolean } {
  const current = pool.getRelays(ctx.activeNpub)
  const read = [...current.read]
  const write = [...current.write]

  if (!args.mode || args.mode === 'read') {
    if (!read.includes(args.url)) read.push(args.url)
  }
  if (!args.mode || args.mode === 'write') {
    if (!write.includes(args.url)) write.push(args.url)
  }

  pool.reconfigure(ctx.activeNpub, { read, write })
  return { reconfigured: true }
}
