import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface GroupInfo {
  id: string
  name?: string
  about?: string
  picture?: string
  isOpen?: boolean
}

export interface GroupMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

/** Fetch group metadata (kind 39000) */
export async function handleGroupInfo(
  pool: RelayPool,
  npub: string,
  args: { relay: string; groupId: string },
): Promise<GroupInfo> {
  const events = await pool.query(npub, {
    kinds: [39000],
    '#d': [args.groupId],
  })

  if (events.length === 0) return { id: args.groupId }

  const best = events.reduce((a: NostrEvent, b: NostrEvent) =>
    b.created_at > a.created_at ? b : a
  )

  const nameTag = best.tags.find(t => t[0] === 'name')
  const aboutTag = best.tags.find(t => t[0] === 'about')
  const pictureTag = best.tags.find(t => t[0] === 'picture')
  const openTag = best.tags.find(t => t[0] === 'open')

  return {
    id: args.groupId,
    name: nameTag?.[1],
    about: aboutTag?.[1],
    picture: pictureTag?.[1],
    isOpen: openTag !== undefined,
  }
}

/** Fetch group chat messages (kind 9) */
export async function handleGroupChat(
  pool: RelayPool,
  npub: string,
  args: { groupId: string; limit?: number },
): Promise<GroupMessage[]> {
  const events = await pool.query(npub, {
    kinds: [9],
    '#h': [args.groupId],
    limit: args.limit ?? 20,
  })

  return events
    .sort((a, b) => a.created_at - b.created_at)
    .map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.created_at,
    }))
}

/** Send a message to a group (kind 9) */
export async function handleGroupSend(
  ctx: SigningContext,
  pool: RelayPool,
  args: { groupId: string; content: string },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId]],
    content: args.content,
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** List group members (kind 39002) */
export async function handleGroupMembers(
  pool: RelayPool,
  npub: string,
  args: { groupId: string },
): Promise<Array<{ pubkey: string; role?: string }>> {
  const events = await pool.query(npub, {
    kinds: [39002],
    '#d': [args.groupId],
  })

  if (events.length === 0) return []

  const best = events.reduce((a: NostrEvent, b: NostrEvent) =>
    b.created_at > a.created_at ? b : a
  )

  return best.tags
    .filter(t => t[0] === 'p')
    .map(t => ({ pubkey: t[1], role: t[3] || undefined }))
}
