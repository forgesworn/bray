import { wrapEvent } from 'nostr-tools/nip17'
import * as nip04 from 'nostr-tools/nip04'
import { decode, npubEncode } from 'nostr-tools/nip19'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { Nip65Manager } from '../nip65.js'
import type { PublishResult } from '../types.js'
import type { VeilScoring } from '../veil/scoring.js'
import type { TrustContext, TrustAnnotation } from '../trust-context.js'
import { toAnnotation } from '../trust-context.js'

export interface DmSendResult {
  event: NostrEvent
  senderCopy?: NostrEvent
  protocol: 'nip17' | 'nip04-deprecated'
  publish: PublishResult
  senderCopyPublish?: PublishResult
  relayWarning?: string
}

export interface DmReadEntry {
  id: string
  from: string
  content?: string
  createdAt: number
  protocol: 'nip17' | 'nip04-deprecated'
  decrypted: boolean
  error?: string
  senderTrustScore?: number
  _trust?: TrustAnnotation
}

/** Send a DM. Uses NIP-17 gift wrap by default. NIP-04 only if explicitly requested and enabled. */
export async function handleDmSend(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    recipientPubkeyHex: string
    message: string
    nip04?: boolean
    nip04Enabled?: boolean
    recipientRelay?: string
    nip65?: Nip65Manager
  },
): Promise<DmSendResult> {
  if (args.nip04) {
    if (!args.nip04Enabled) {
      throw new Error('NIP-04 is not enabled. Set NIP04_ENABLED=1 to use legacy DMs.')
    }

    // NIP-04 legacy DM (kind 4)
    const encrypted = await nip04.encrypt((ctx as IdentityContext).activePrivateKey, args.recipientPubkeyHex, args.message)
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
  // Look up recipient's inbox relays via NIP-65 for proper delivery
  let recipientRelays: string[] = []
  if (args.nip65) {
    try {
      const recipientNpub = npubEncode(args.recipientPubkeyHex)
      const relaySet = await args.nip65.loadForIdentity(recipientNpub, args.recipientPubkeyHex)
      recipientRelays = relaySet.read // recipient reads from their read relays
    } catch { /* fall back to sender's relays */ }
  }

  const recipientRelayHint = args.recipientRelay ?? recipientRelays[0]

  // Wrap for recipient
  const event = wrapEvent(
    (ctx as IdentityContext).activePrivateKey,
    { publicKey: args.recipientPubkeyHex, relayUrl: recipientRelayHint },
    args.message,
  )

  // Publish to recipient's relays (primary) and sender's relays (fallback)
  let publish: PublishResult
  if (recipientRelays.length > 0) {
    // Merge recipient read relays with sender write relays for best coverage
    const senderRelays = pool.getRelays(ctx.activeNpub).write
    const allRelays = [...new Set([...recipientRelays, ...senderRelays])]
    publish = await pool.publishDirect(allRelays, event)
  } else {
    publish = await pool.publish(ctx.activeNpub, event)
  }

  // Sender copy — wrap the same message addressed to ourselves so our client shows sent DMs.
  // The inner rumor's p-tag (set by wrapEvent) points to us, but clients use the
  // outer gift-wrap's p-tag to route, and the inner content to display.
  const senderHex = (decode(ctx.activeNpub).data as string)
  const senderCopy = wrapEvent(
    (ctx as IdentityContext).activePrivateKey,
    { publicKey: senderHex, relayUrl: recipientRelayHint },
    args.message,
  )
  const senderCopyPublish = await pool.publish(ctx.activeNpub, senderCopy)

  const result: DmSendResult = { event, senderCopy, protocol: 'nip17', publish, senderCopyPublish }

  if (recipientRelays.length > 0 && publish.accepted.length === 0) {
    result.relayWarning = "None of recipient's inbox relays accepted the message. It may not be delivered."
  }

  return result
}

/** Read DMs addressed to the active identity */
export async function handleDmRead(
  ctx: SigningContext,
  pool: RelayPool,
  args?: { since?: number; limit?: number; _scoring?: VeilScoring; _trustCtx?: TrustContext },
): Promise<DmReadEntry[]> {
  // Fetch gift wraps (kind 1059) and legacy DMs (kind 4) addressed to us
  const activeHex = decode(ctx.activeNpub).data as string
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1059, 4],
    '#p': [activeHex],
    limit: args?.limit ?? 50,
    ...(args?.since ? { since: args.since } : {}),
  })

  const entries = await decryptDmEvents(ctx, events)

  if (args?._scoring) {
    for (const entry of entries) {
      const score = await args._scoring.scorePubkey(entry.from)
      entry.senderTrustScore = score.score
    }
  }

  if (args?._trustCtx && args._trustCtx.mode !== 'off') {
    for (const entry of entries) {
      const assessment = await args._trustCtx.assess(entry.from)
      entry._trust = toAnnotation(assessment)
    }
  }

  return entries
}

/** Read DM conversation with a specific pubkey — filters to messages from that person only */
export async function handleDmConversation(
  ctx: SigningContext,
  pool: RelayPool,
  args: { withPubkeyHex: string; limit?: number; _scoring?: VeilScoring; _trustCtx?: TrustContext },
): Promise<DmReadEntry[]> {
  const allMessages = await handleDmRead(ctx, pool, { limit: args.limit ?? 100, _scoring: args._scoring, _trustCtx: args._trustCtx })
  return allMessages
    .filter(m => m.from === args.withPubkeyHex)
    .sort((a, b) => a.createdAt - b.createdAt) // chronological for conversation view
}

/** Decrypt a list of DM events (kind 1059 gift wrap + kind 4 legacy) */
async function decryptDmEvents(
  ctx: SigningContext,
  events: NostrEvent[],
): Promise<DmReadEntry[]> {
  const results: DmReadEntry[] = []

  for (const event of events) {
    if (event.kind === 1059) {
      // NIP-17 gift wrap — try to unwrap
      try {
        const { unwrapEvent } = await import('nostr-tools/nip17')
        const unwrapped = unwrapEvent(event, (ctx as IdentityContext).activePrivateKey)
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
        const decrypted = await nip04.decrypt((ctx as IdentityContext).activePrivateKey, event.pubkey, event.content)
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
