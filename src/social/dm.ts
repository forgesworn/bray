import { wrapEvent } from 'nostr-tools/nip17'
import * as nip04 from 'nostr-tools/nip04'
import type { Event as NostrEvent } from 'nostr-tools'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface DmSendResult {
  event: NostrEvent
  protocol: 'nip17' | 'nip04-deprecated'
  publish: PublishResult
}

export interface DmReadEntry {
  id: string
  from: string
  content?: string
  createdAt: number
  protocol: 'nip17' | 'nip04-deprecated'
  decrypted: boolean
  error?: string
}

/** Send a DM. Uses NIP-17 gift wrap by default. NIP-04 only if explicitly requested and enabled. */
export async function handleDmSend(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    recipientPubkeyHex: string
    message: string
    nip04?: boolean
    nip04Enabled?: boolean
    recipientRelay?: string
  },
): Promise<DmSendResult> {
  if (args.nip04) {
    if (!args.nip04Enabled) {
      throw new Error('NIP-04 is not enabled. Set NIP04_ENABLED=1 to use legacy DMs.')
    }

    // NIP-04 legacy DM (kind 4)
    const encrypted = await nip04.encrypt(ctx.activePrivateKey, args.recipientPubkeyHex, args.message)
    const sign = ctx.getSigningFunction()
    const event = await sign({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', args.recipientPubkeyHex]],
      content: encrypted,
    })
    console.error('Warning: NIP-04 DMs are deprecated. Prefer NIP-17 gift-wrapped DMs.')
    const publish = await pool.publish(ctx.activeNpub, event)
    return { event, protocol: 'nip04-deprecated', publish }
  }

  // NIP-17 gift-wrapped DM (default)
  const event = wrapEvent(
    ctx.activePrivateKey,
    { publicKey: args.recipientPubkeyHex, relayUrl: args.recipientRelay },
    args.message,
  )
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, protocol: 'nip17', publish }
}

/** Read DMs addressed to the active identity */
export async function handleDmRead(
  ctx: IdentityContext,
  pool: RelayPool,
): Promise<DmReadEntry[]> {
  // Fetch gift wraps (kind 1059) and legacy DMs (kind 4) addressed to us
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1059, 4],
    '#p': [ctx.activeNpub], // simplified — in production use hex pubkey
    limit: 50,
  })

  const results: DmReadEntry[] = []

  for (const event of events) {
    if (event.kind === 1059) {
      // NIP-17 gift wrap — try to unwrap
      try {
        const { unwrapEvent } = await import('nostr-tools/nip17')
        const unwrapped = unwrapEvent(event, ctx.activePrivateKey)
        results.push({
          id: event.id,
          from: unwrapped.pubkey,
          content: unwrapped.content,
          createdAt: unwrapped.created_at,
          protocol: 'nip17',
          decrypted: true,
        })
      } catch {
        results.push({
          id: event.id,
          from: event.pubkey,
          createdAt: event.created_at,
          protocol: 'nip17',
          decrypted: false,
          error: 'Could not decrypt NIP-17 gift wrap',
        })
      }
    } else if (event.kind === 4) {
      // NIP-04 legacy DM
      try {
        const decrypted = await nip04.decrypt(ctx.activePrivateKey, event.pubkey, event.content)
        results.push({
          id: event.id,
          from: event.pubkey,
          content: decrypted,
          createdAt: event.created_at,
          protocol: 'nip04-deprecated',
          decrypted: true,
        })
      } catch {
        results.push({
          id: event.id,
          from: event.pubkey,
          createdAt: event.created_at,
          protocol: 'nip04-deprecated',
          decrypted: false,
          error: 'Could not decrypt NIP-04 message',
        })
      }
    }
  }

  return results
}
