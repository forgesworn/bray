import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { IdentityContext } from '../../src/context.js'
import {
  GROUP_KIND_ADD_USER,
  GROUP_KIND_CREATE,
  GROUP_KIND_CREATE_INVITE,
  GROUP_KIND_DELETE_EVENT,
  GROUP_KIND_DELETE_GROUP,
  GROUP_KIND_EDIT_METADATA,
  GROUP_KIND_JOIN,
  handleGroupAddUser,
  handleGroupAdmins,
  handleGroupCreate,
  handleGroupCreateInvite,
  handleGroupDelete,
  handleGroupDeleteEvent,
  handleGroupForumComment,
  handleGroupForumTopicCreate,
  handleGroupInfo,
  handleGroupJoin,
  handleGroupMembers,
  handleGroupRoles,
  handleGroupSend,
} from '../../src/social/groups.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const RELAY_KEY = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 2 : 0)
const RELAY_PUBKEY = getPublicKey(RELAY_KEY)
const RELAY = 'wss://groups.example.com'

function relayEvent(kind: number, groupId: string, tags: string[][], created_at = 1_000) {
  return finalizeEvent({ kind, tags: [['d', groupId], ...tags], content: '', created_at }, RELAY_KEY)
}

function mockPool(events: any[] = []) {
  return {
    getRelaySelfPubkey: vi.fn().mockResolvedValue(RELAY_PUBKEY),
    queryDirect: vi.fn().mockResolvedValue(events),
    publishDirect: vi.fn().mockResolvedValue({
      success: true, allAccepted: true, accepted: [RELAY], rejected: [], errors: [],
    }),
  }
}

describe('current relay-scoped NIP-29 handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => { ctx = new IdentityContext(TEST_NSEC, 'nsec') })

  it('uses the current moderation kind assignments', () => {
    expect(GROUP_KIND_ADD_USER).toBe(9000)
    expect(GROUP_KIND_EDIT_METADATA).toBe(9002)
    expect(GROUP_KIND_DELETE_EVENT).toBe(9005)
    expect(GROUP_KIND_CREATE).toBe(9007)
    expect(GROUP_KIND_DELETE_GROUP).toBe(9008)
    expect(GROUP_KIND_CREATE_INVITE).toBe(9009)
  })

  it('reads metadata from the explicit relay and verifies the NIP-11 self signer', async () => {
    const event = relayEvent(39000, 'g1', [
      ['name', 'Verified Group'], ['about', 'Relay scoped'], ['private'], ['closed'],
      ['supported_kinds', '9', '11'], ['child', 'forum'],
    ])
    const pool = mockPool([event])
    const result = await handleGroupInfo(pool as any, 'npub-unused', { relay: RELAY, groupId: 'g1' })

    expect(result).toMatchObject({
      relay: RELAY, relayPubkey: RELAY_PUBKEY, verified: true,
      name: 'Verified Group', isPublic: false, isOpen: false,
      supportedKinds: [9, 11], children: ['forum'],
    })
    expect(pool.queryDirect).toHaveBeenCalledWith([RELAY], expect.objectContaining({ kinds: [39000], '#d': ['g1'] }))
  })

  it('rejects relay-generated state signed by a different key', async () => {
    const foreignKey = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 3 : 0)
    const event = finalizeEvent({ kind: 39000, tags: [['d', 'g1']], content: '', created_at: 1 }, foreignKey)
    await expect(handleGroupInfo(mockPool([event]) as any, 'npub-unused', {
      relay: RELAY, groupId: 'g1',
    })).rejects.toThrow(/NIP-11 self key/)
  })

  it('parses members, admins and relay-defined roles from the correct state kinds', async () => {
    const members = relayEvent(39002, 'g1', [['p', 'a'.repeat(64)], ['p', 'b'.repeat(64)]])
    const admins = relayEvent(39001, 'g1', [['p', 'a'.repeat(64), 'admin', 'moderator']])
    const roles = relayEvent(39003, 'g1', [['role', 'admin', 'May manage group'], ['role', 'moderator', 'May delete events']])

    expect(await handleGroupMembers(mockPool([members]) as any, 'unused', { relay: RELAY, groupId: 'g1' }))
      .toEqual([{ pubkey: 'a'.repeat(64) }, { pubkey: 'b'.repeat(64) }])
    expect(await handleGroupAdmins(mockPool([admins]) as any, { relay: RELAY, groupId: 'g1' }))
      .toEqual([{ pubkey: 'a'.repeat(64), roles: ['admin', 'moderator'] }])
    expect(await handleGroupRoles(mockPool([roles]) as any, { relay: RELAY, groupId: 'g1' }))
      .toEqual([
        { name: 'admin', description: 'May manage group', details: ['May manage group'] },
        { name: 'moderator', description: 'May delete events', details: ['May delete events'] },
      ])
  })

  it('publishes group chat and moderation events only to the host relay', async () => {
    const pool = mockPool()
    const sent = await handleGroupSend(ctx, pool as any, { relay: RELAY, groupId: 'g1', content: 'hello' })
    expect(sent.event).toMatchObject({ kind: 9, content: 'hello' })
    expect(sent.event.tags).toContainEqual(['h', 'g1'])
    expect(pool.publishDirect).toHaveBeenCalledWith([RELAY], sent.event)

    const added = await handleGroupAddUser(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', pubkeyHex: 'a'.repeat(64), roles: ['admin', 'moderator'],
    })
    expect(added.event.kind).toBe(9000)
    expect(added.event.tags).toContainEqual(['p', 'a'.repeat(64), 'admin', 'moderator'])
  })

  it('creates with kind 9007 and sends metadata separately with kind 9002', async () => {
    const pool = mockPool()
    const result = await handleGroupCreate(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', name: 'New Group', isOpen: false, supportedKinds: [9, 11],
    })
    expect(result.event.kind).toBe(9007)
    expect(result.event.tags).toEqual([['h', 'g1']])
    expect(result.metadataEvent?.kind).toBe(9002)
    expect(result.metadataEvent?.tags).toContainEqual(['name', 'New Group'])
    expect(result.metadataEvent?.tags).toContainEqual(['closed'])
    expect(pool.publishDirect).toHaveBeenCalledTimes(2)
  })

  it('creates invite codes and includes them in join requests', async () => {
    const pool = mockPool()
    const invite = await handleGroupCreateInvite(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', code: 'invite-123',
    })
    expect(invite.event.kind).toBe(9009)
    expect(invite.event.tags).toContainEqual(['code', 'invite-123'])

    const join = await handleGroupJoin(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', code: invite.code,
    })
    expect(join.event.kind).toBe(GROUP_KIND_JOIN)
    expect(join.event.tags).toContainEqual(['code', 'invite-123'])
  })

  it('requires explicit confirmation for event and whole-group deletion', async () => {
    const pool = mockPool()
    const eventId = 'e'.repeat(64)
    await expect(handleGroupDeleteEvent(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', eventId,
    })).rejects.toThrow(/confirm/)
    const removed = await handleGroupDeleteEvent(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', eventId, confirm: true,
    })
    expect(removed.event.kind).toBe(9005)
    expect(removed.event.tags).toContainEqual(['e', eventId])

    await expect(handleGroupDelete(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', confirmGroupId: 'wrong',
    })).rejects.toThrow(/exactly match/)
    const deleted = await handleGroupDelete(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', confirmGroupId: 'g1',
    })
    expect(deleted.event.kind).toBe(9008)
  })

  it('publishes kind 11 topics and schema-correct NIP-22 kind 1111 comments', async () => {
    const pool = mockPool()
    const topic = await handleGroupForumTopicCreate(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', title: 'Topic', content: 'Opening post',
    })
    expect(topic.event.kind).toBe(11)
    expect(topic.event.tags).toContainEqual(['h', 'g1'])
    expect(topic.event.tags).toContainEqual(['title', 'Topic'])

    pool.queryDirect.mockResolvedValue([topic.event])
    const comment = await handleGroupForumComment(ctx, pool as any, {
      relay: RELAY, groupId: 'g1', topicId: topic.event.id, content: 'First reply',
    })
    expect(comment.event.kind).toBe(1111)
    expect(comment.event.tags).toContainEqual(['E', topic.event.id, RELAY, topic.event.pubkey])
    expect(comment.event.tags).toContainEqual(['K', '11'])
    expect(comment.event.tags).toContainEqual(['e', topic.event.id, RELAY, topic.event.pubkey])
    expect(comment.event.tags).toContainEqual(['k', '11'])
  })
})
