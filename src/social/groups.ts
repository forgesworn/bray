import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

// NIP-29 admin event kinds (ephemeral; processed by the relay)
export const GROUP_KIND_ADD_USER = 9000
export const GROUP_KIND_REMOVE_USER = 9001
export const GROUP_KIND_EDIT_METADATA = 9002
export const GROUP_KIND_CREATE = 9004
export const GROUP_KIND_DELETE = 9005
export const GROUP_KIND_SET_ROLES = 9007

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

/** Create a NIP-29 group (kind 9004 admin event). The relay assigns membership state. */
export async function handleGroupCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    groupId?: string
    name?: string
    about?: string
    picture?: string
    isOpen?: boolean
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const tags: string[][] = []
  if (args.groupId) tags.push(['h', args.groupId])
  if (args.name) tags.push(['name', args.name])
  if (args.about) tags.push(['about', args.about])
  if (args.picture) tags.push(['picture', args.picture])
  if (args.isOpen !== undefined) tags.push([args.isOpen ? 'open' : 'closed'])
  const event = await sign({
    kind: GROUP_KIND_CREATE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Update NIP-29 group metadata (kind 9002 admin event). */
export async function handleGroupUpdate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    groupId: string
    name?: string
    about?: string
    picture?: string
    isOpen?: boolean
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const tags: string[][] = [['h', args.groupId]]
  if (args.name !== undefined) tags.push(['name', args.name])
  if (args.about !== undefined) tags.push(['about', args.about])
  if (args.picture !== undefined) tags.push(['picture', args.picture])
  if (args.isOpen !== undefined) tags.push([args.isOpen ? 'open' : 'closed'])
  const event = await sign({
    kind: GROUP_KIND_EDIT_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Add or update a user in a NIP-29 group (kind 9000 admin event). */
export async function handleGroupAddUser(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    groupId: string
    pubkeyHex: string
    role?: string
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const pTag: string[] = ['p', args.pubkeyHex]
  if (args.role) pTag.push('', args.role)
  const event = await sign({
    kind: GROUP_KIND_ADD_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], pTag],
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Remove a user from a NIP-29 group (kind 9001 admin event). */
export async function handleGroupRemoveUser(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    groupId: string
    pubkeyHex: string
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: GROUP_KIND_REMOVE_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['p', args.pubkeyHex]],
    content: '',
  })
  const publish = await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/** Define role names and permissions in a NIP-29 group (kind 9007 admin event). */
export async function handleGroupSetRoles(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    groupId: string
    roles: Array<{ name: string; permissions?: string[] }>
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const sign = ctx.getSigningFunction()
  const tags: string[][] = [['h', args.groupId]]
  for (const r of args.roles) {
    tags.push(['role', r.name, ...(r.permissions ?? [])])
  }
  const event = await sign({
    kind: GROUP_KIND_SET_ROLES,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
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
