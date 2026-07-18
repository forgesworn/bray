import { randomBytes } from 'node:crypto'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'
import { assertEventSemanticallyValid } from '../event-validation/validator.js'

// Current NIP-29 moderation and user-management kinds.
export const GROUP_KIND_ADD_USER = 9000
export const GROUP_KIND_REMOVE_USER = 9001
export const GROUP_KIND_EDIT_METADATA = 9002
export const GROUP_KIND_DELETE_EVENT = 9005
export const GROUP_KIND_CREATE = 9007
export const GROUP_KIND_DELETE_GROUP = 9008
export const GROUP_KIND_CREATE_INVITE = 9009
export const GROUP_KIND_JOIN = 9021
export const GROUP_KIND_LEAVE = 9022

export const GROUP_KIND_METADATA = 39000
export const GROUP_KIND_ADMINS = 39001
export const GROUP_KIND_MEMBERS = 39002
export const GROUP_KIND_ROLES = 39003
export const GROUP_KIND_FORUM_TOPIC = 11
export const GROUP_KIND_COMMENT = 1111

/** @deprecated Kind 9005 deletes an event, not a group. */
export const GROUP_KIND_DELETE = GROUP_KIND_DELETE_EVENT

export interface GroupInfo {
  id: string
  relay: string
  relayPubkey: string
  found: boolean
  verified: boolean
  name?: string
  about?: string
  picture?: string
  banner?: string
  isPublic: boolean
  isOpen: boolean
  isRestricted: boolean
  isHidden: boolean
  supportedKinds?: number[]
  parent?: string
  children: string[]
  stateWarning?: string
}

export interface GroupMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

export interface GroupAdmin {
  pubkey: string
  roles: string[]
}

export interface GroupRole {
  name: string
  description?: string
  details: string[]
}

export interface GroupForumTopic extends GroupMessage {
  title?: string
}

function hasGroupTag(event: NostrEvent, groupId: string, name: 'h' | 'd'): boolean {
  return event.tags.some(tag => tag[0] === name && tag[1] === groupId)
}

function latest(events: NostrEvent[]): NostrEvent | undefined {
  return events.reduce<NostrEvent | undefined>((best, event) =>
    !best || event.created_at > best.created_at ? event : best, undefined)
}

async function verifiedRelayState(
  pool: RelayPool,
  relay: string,
  groupId: string,
  kinds: number[],
): Promise<{ relayPubkey: string; events: NostrEvent[] }> {
  const relayPubkey = await pool.getRelaySelfPubkey(relay)
  const received = await pool.queryDirect([relay], { kinds, '#d': [groupId], limit: kinds.length })
  const scoped = received.filter(event => kinds.includes(event.kind) && hasGroupTag(event, groupId, 'd'))
  const events = scoped.filter(event => event.pubkey === relayPubkey && verifyEvent(event))
  if (scoped.length > 0 && events.length === 0) {
    throw new Error(`Relay returned NIP-29 state that was not signed by its NIP-11 self key ${relayPubkey}`)
  }
  return { relayPubkey, events }
}

async function signAndPublishGroupEvent(
  ctx: SigningContext,
  pool: RelayPool,
  relay: string,
  template: EventTemplate,
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  assertEventSemanticallyValid(template)
  const event = await ctx.getSigningFunction()(template)
  const publish = await pool.publishDirect([relay], event)
  return { event, publish }
}

function metadataTags(args: {
  groupId: string
  name?: string
  about?: string
  picture?: string
  banner?: string
  isPrivate?: boolean
  isRestricted?: boolean
  isHidden?: boolean
  isOpen?: boolean
  supportedKinds?: number[]
  parent?: string
}): string[][] {
  const tags: string[][] = [['h', args.groupId]]
  if (args.name !== undefined) tags.push(['name', args.name])
  if (args.about !== undefined) tags.push(['about', args.about])
  if (args.picture !== undefined) tags.push(['picture', args.picture])
  if (args.banner !== undefined) tags.push(['banner', args.banner])
  if (args.isPrivate) tags.push(['private'])
  if (args.isRestricted) tags.push(['restricted'])
  if (args.isHidden) tags.push(['hidden'])
  if (args.isOpen === false) tags.push(['closed'])
  if (args.supportedKinds !== undefined) tags.push(['supported_kinds', ...args.supportedKinds.map(String)])
  if (args.parent !== undefined) tags.push(['parent', args.parent])
  return tags
}

/** Fetch and verify relay-generated group metadata (kind 39000). */
export async function handleGroupInfo(
  pool: RelayPool,
  _npub: string,
  args: { relay: string; groupId: string },
): Promise<GroupInfo> {
  const { relayPubkey, events } = await verifiedRelayState(pool, args.relay, args.groupId, [GROUP_KIND_METADATA])
  const event = latest(events)
  const value = (name: string) => event?.tags.find(tag => tag[0] === name)?.[1]
  const present = (name: string) => event?.tags.some(tag => tag[0] === name) ?? false
  const supported = event?.tags.find(tag => tag[0] === 'supported_kinds')?.slice(1)
    .map(Number).filter(Number.isInteger)
  return {
    id: args.groupId,
    relay: args.relay,
    relayPubkey,
    found: Boolean(event),
    verified: Boolean(event),
    name: value('name') ?? value('title'),
    about: value('about') ?? value('description'),
    picture: value('picture') ?? value('image'),
    banner: value('banner'),
    isPublic: !present('private'),
    isOpen: !present('closed'),
    isRestricted: present('restricted'),
    isHidden: present('hidden'),
    supportedKinds: supported,
    parent: value('parent'),
    children: event?.tags.filter(tag => tag[0] === 'child' && tag[1]).map(tag => tag[1]!) ?? [],
    stateWarning: event ? undefined : 'No group metadata was returned; the group may be absent, hidden, or inaccessible.',
  }
}

/** Fetch group chat messages (kind 9) from the group's host relay. */
export async function handleGroupChat(
  pool: RelayPool,
  _npub: string,
  args: { relay: string; groupId: string; limit?: number },
): Promise<GroupMessage[]> {
  const events = await pool.queryDirect([args.relay], {
    kinds: [9], '#h': [args.groupId], limit: args.limit ?? 20,
  })
  return events
    .filter(event => verifyEvent(event) && hasGroupTag(event, args.groupId, 'h'))
    .sort((a, b) => a.created_at - b.created_at)
    .map(event => ({ id: event.id, pubkey: event.pubkey, content: event.content, createdAt: event.created_at }))
}

/** Send a kind 9 chat message to exactly one group relay. */
export async function handleGroupSend(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; content: string },
) {
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: 9, created_at: Math.floor(Date.now() / 1000), tags: [['h', args.groupId]], content: args.content,
  })
}

/** Create a group with kind 9007; metadata is a separate kind 9002 operation. */
export async function handleGroupCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    relay: string
    groupId?: string
    name?: string
    about?: string
    picture?: string
    banner?: string
    isPrivate?: boolean
    isRestricted?: boolean
    isHidden?: boolean
    isOpen?: boolean
    supportedKinds?: number[]
    parent?: string
  },
): Promise<{
  groupId: string
  event: NostrEvent
  publish: PublishResult
  metadataEvent?: NostrEvent
  metadataPublish?: PublishResult
  warning?: string
}> {
  const groupId = args.groupId ?? randomBytes(16).toString('hex')
  const created = await signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_CREATE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId]],
    content: '',
  })
  const wantsMetadata = [
    args.name, args.about, args.picture, args.banner, args.isPrivate,
    args.isRestricted, args.isHidden, args.isOpen, args.supportedKinds, args.parent,
  ].some(value => value !== undefined)
  if (!wantsMetadata) return { groupId, ...created }
  if (!created.publish.success) {
    return { groupId, ...created, warning: 'Create-group was not accepted; metadata was not published.' }
  }
  const metadata = await handleGroupUpdate(ctx, pool, { ...args, groupId })
  return {
    groupId,
    ...created,
    metadataEvent: metadata.event,
    metadataPublish: metadata.publish,
  }
}

/** Update complete NIP-29 group metadata (kind 9002). */
export async function handleGroupUpdate(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    relay: string
    groupId: string
    name?: string
    about?: string
    picture?: string
    banner?: string
    isPrivate?: boolean
    isRestricted?: boolean
    isHidden?: boolean
    isOpen?: boolean
    supportedKinds?: number[]
    parent?: string
  },
) {
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_EDIT_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags: metadataTags(args),
    content: '',
  })
}

/** Add/update a member and zero or more relay-defined roles (kind 9000). */
export async function handleGroupAddUser(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; pubkeyHex: string; role?: string; roles?: string[] },
) {
  const roles = args.roles ?? (args.role ? [args.role] : [])
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_ADD_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['p', args.pubkeyHex, ...roles]],
    content: '',
  })
}

/** Remove a user from a group (kind 9001). */
export async function handleGroupRemoveUser(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; pubkeyHex: string },
) {
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_REMOVE_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['p', args.pubkeyHex]],
    content: '',
  })
}

/** List relay-generated members (kind 39002); this event may be partial or absent. */
export async function handleGroupMembers(
  pool: RelayPool,
  _npub: string,
  args: { relay: string; groupId: string },
): Promise<Array<{ pubkey: string }>> {
  const { events } = await verifiedRelayState(pool, args.relay, args.groupId, [GROUP_KIND_MEMBERS])
  return latest(events)?.tags
    .filter(tag => tag[0] === 'p' && tag[1])
    .map(tag => ({ pubkey: tag[1]! })) ?? []
}

/** Inspect relay-generated admins and their role labels (kind 39001). */
export async function handleGroupAdmins(
  pool: RelayPool,
  args: { relay: string; groupId: string },
): Promise<GroupAdmin[]> {
  const { events } = await verifiedRelayState(pool, args.relay, args.groupId, [GROUP_KIND_ADMINS])
  return latest(events)?.tags
    .filter(tag => tag[0] === 'p' && tag[1])
    .map(tag => ({ pubkey: tag[1]!, roles: tag.slice(2).filter(Boolean) })) ?? []
}

/** Inspect relay-supported role labels (kind 39003). Roles are relay policy, not client-defined permissions. */
export async function handleGroupRoles(
  pool: RelayPool,
  args: { relay: string; groupId: string },
): Promise<GroupRole[]> {
  const { events } = await verifiedRelayState(pool, args.relay, args.groupId, [GROUP_KIND_ROLES])
  return latest(events)?.tags
    .filter(tag => tag[0] === 'role' && tag[1])
    .map(tag => ({ name: tag[1]!, description: tag[2] || undefined, details: tag.slice(2) })) ?? []
}

/** Fetch verified metadata, admins, members and roles in one relay-scoped view. */
export async function handleGroupInspect(pool: RelayPool, npub: string, args: { relay: string; groupId: string }) {
  const [info, admins, members, roles] = await Promise.all([
    handleGroupInfo(pool, npub, args),
    handleGroupAdmins(pool, args),
    handleGroupMembers(pool, npub, args),
    handleGroupRoles(pool, args),
  ])
  return { info, admins, members, roles, memberListMayBePartial: true }
}

/** Create an invite code through kind 9009. */
export async function handleGroupCreateInvite(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; code?: string },
) {
  const code = args.code ?? randomBytes(18).toString('base64url')
  const result = await signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_CREATE_INVITE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['code', code]],
    content: '',
  })
  return { code, ...result }
}

/** Request admission with optional invite code (kind 9021). */
export async function handleGroupJoin(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; code?: string },
) {
  const tags: string[][] = [['h', args.groupId]]
  if (args.code) tags.push(['code', args.code])
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_JOIN, created_at: Math.floor(Date.now() / 1000), tags, content: '',
  })
}

/** Leave a group (kind 9022). */
export async function handleGroupLeave(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string },
) {
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_LEAVE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId]],
    content: '',
  })
}

/** Delete one event from group state (kind 9005); requires explicit confirmation. */
export async function handleGroupDeleteEvent(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; eventId: string; confirm?: boolean },
) {
  if (args.confirm !== true) throw new Error('Deleting a group event requires confirm: true')
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_DELETE_EVENT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['e', args.eventId]],
    content: '',
  })
}

/** Delete a whole group (kind 9008); confirmation must repeat the group ID. */
export async function handleGroupDelete(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; confirmGroupId?: string },
) {
  if (args.confirmGroupId !== args.groupId) {
    throw new Error('Deleting a group requires confirmGroupId to exactly match groupId')
  }
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_DELETE_GROUP,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId]],
    content: '',
  })
}

/** List verified kind 11 forum topics hosted by a NIP-29 group. */
export async function handleGroupForumTopics(
  pool: RelayPool,
  args: { relay: string; groupId: string; limit?: number },
): Promise<GroupForumTopic[]> {
  const events = await pool.queryDirect([args.relay], {
    kinds: [GROUP_KIND_FORUM_TOPIC], '#h': [args.groupId], limit: args.limit ?? 50,
  })
  return events
    .filter(event => verifyEvent(event) && hasGroupTag(event, args.groupId, 'h'))
    .sort((a, b) => b.created_at - a.created_at)
    .map(event => ({
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      title: event.tags.find(tag => tag[0] === 'title')?.[1],
    }))
}

/** Publish a kind 11 forum topic to one group relay. */
export async function handleGroupForumTopicCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; title: string; content: string },
) {
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_FORUM_TOPIC,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', args.groupId], ['title', args.title]],
    content: args.content,
  })
}

/** List NIP-22 comments scoped to one kind 11 topic. */
export async function handleGroupForumComments(
  pool: RelayPool,
  args: { relay: string; groupId: string; topicId: string; limit?: number },
): Promise<GroupMessage[]> {
  const events = await pool.queryDirect([args.relay], {
    kinds: [GROUP_KIND_COMMENT], '#h': [args.groupId], '#E': [args.topicId], limit: args.limit ?? 100,
  })
  return events
    .filter(event => verifyEvent(event) && hasGroupTag(event, args.groupId, 'h'))
    .sort((a, b) => a.created_at - b.created_at)
    .map(event => ({ id: event.id, pubkey: event.pubkey, content: event.content, createdAt: event.created_at }))
}

/** Publish a NIP-22 comment or reply under a kind 11 topic. */
export async function handleGroupForumComment(
  ctx: SigningContext,
  pool: RelayPool,
  args: { relay: string; groupId: string; topicId: string; parentId?: string; content: string },
) {
  const ids = [...new Set([args.topicId, args.parentId].filter((id): id is string => Boolean(id)))]
  const referenced = await pool.queryDirect([args.relay], { ids, limit: ids.length })
  const byId = new Map(referenced.filter(verifyEvent).map(event => [event.id, event]))
  const root = byId.get(args.topicId)
  if (!root || root.kind !== GROUP_KIND_FORUM_TOPIC || !hasGroupTag(root, args.groupId, 'h')) {
    throw new Error('Forum topic was not found as a verified kind 11 event in this group relay')
  }
  const parent = args.parentId ? byId.get(args.parentId) : root
  if (!parent || ![GROUP_KIND_FORUM_TOPIC, GROUP_KIND_COMMENT].includes(parent.kind)
    || !hasGroupTag(parent, args.groupId, 'h')) {
    throw new Error('Forum comment parent was not found in this group relay')
  }
  const tags: string[][] = [
    ['h', args.groupId],
    ['E', root.id, args.relay, root.pubkey],
    ['K', String(root.kind)],
    ['P', root.pubkey, args.relay],
    ['e', parent.id, args.relay, parent.pubkey],
    ['k', String(parent.kind)],
    ['p', parent.pubkey, args.relay],
  ]
  return signAndPublishGroupEvent(ctx, pool, args.relay, {
    kind: GROUP_KIND_COMMENT,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.content,
  })
}
