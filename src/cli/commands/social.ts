import {
  handleSocialPost, handleSocialReply, handleSocialReact, handleSocialDelete,
  handleSocialRepost, handleSocialProfileGet, handleSocialProfileSet,
  handleContactsGet, handleContactsFollow, handleContactsUnfollow,
  handleDmSend, handleDmRead,
  handleNotifications, handleFeed,
  handleNipPublish, handleNipRead,
  handleBlossomUpload, handleBlossomList, handleBlossomDelete,
  handleGroupInfo, handleGroupChat, handleGroupSend, handleGroupMembers,
  handleGroupCreate, handleGroupUpdate, handleGroupAddUser, handleGroupRemoveUser,
  handleGroupAdmins, handleGroupRoles, handleGroupInspect,
  handleGroupCreateInvite, handleGroupJoin, handleGroupLeave,
  handleGroupDeleteEvent, handleGroupDelete,
  handleGroupForumTopics, handleGroupForumTopicCreate, handleGroupForumComments, handleGroupForumComment,
} from '../../exports.js'
import * as fmt from '../../format.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
  config: any,
): Promise<void> {
  const { req, flag, flags, hasFlag, out } = h

  switch (cmd) {
    case 'post':
      out(await handleSocialPost(ctx, pool, { content: req(1, 'post "message"'), relays: flags('relay') }), fmt.formatPost)
      break

    case 'reply':
      out(await handleSocialReply(ctx, pool, {
        content: req(3, 'reply <event-id> <pubkey> "text"'),
        replyTo: req(1, 'reply <event-id> <pubkey> "text"'),
        replyToPubkey: req(2, 'reply <event-id> <pubkey> "text"'),
        relays: flags('relay'),
      }))
      break

    case 'react':
      out(await handleSocialReact(ctx, pool, {
        eventId: req(1, 'react <event-id> <pubkey> [emoji]'),
        eventPubkey: req(2, 'react <event-id> <pubkey> [emoji]'),
        reaction: cmdArgs[3] ?? '+',
        relays: flags('relay'),
      }))
      break

    case 'profile':
      out(await handleSocialProfileGet(pool, ctx.activeNpub, req(1, 'profile <pubkey-hex>')), fmt.formatProfile)
      break

    case 'profile-set': {
      const profile = JSON.parse(req(1, 'profile-set \'{"name":"..."}\''))
      out(await handleSocialProfileSet(ctx, pool, { profile, confirm: hasFlag('confirm'), relays: flags('relay') }))
      break
    }

    case 'delete':
      out(await handleSocialDelete(ctx, pool, {
        eventId: req(1, 'delete <event-id> [reason]'),
        reason: cmdArgs[2],
        relays: flags('relay'),
      }))
      break

    case 'repost':
      out(await handleSocialRepost(ctx, pool, {
        eventId: req(1, 'repost <event-id> <pubkey>'),
        eventPubkey: req(2, 'repost <event-id> <pubkey>'),
        relays: flags('relay'),
      }))
      break

    case 'contacts':
      out(await handleContactsGet(pool, ctx.activeNpub, req(1, 'contacts <pubkey-hex>')), fmt.formatContacts)
      break

    case 'follow':
      out(await handleContactsFollow(ctx, pool, {
        pubkeyHex: req(1, 'follow <pubkey-hex> [relay] [petname]'),
        relay: cmdArgs[2],
        petname: cmdArgs[3],
        relays: flags('relay'),
      }))
      break

    case 'unfollow':
      out(await handleContactsUnfollow(ctx, pool, {
        pubkeyHex: req(1, 'unfollow <pubkey-hex>'),
        relays: flags('relay'),
      }))
      break

    case 'dm':
      out(await handleDmSend(ctx, pool, {
        recipientPubkeyHex: req(1, 'dm <pubkey-hex> "message"'),
        message: req(2, 'dm <pubkey-hex> "message"'),
        nip04: hasFlag('nip04'),
        nip04Enabled: config.nip04Enabled,
        relays: flags('relay'),
      }))
      break

    case 'dm-read':
      out(await handleDmRead(ctx, pool), fmt.formatDms)
      break

    case 'feed':
      out(await handleFeed(ctx, pool, { limit: parseInt(flag('limit', '20')!, 10) }), fmt.formatFeed)
      break

    case 'notifications':
      out(await handleNotifications(ctx, pool, { limit: parseInt(flag('limit', '50')!, 10) }), fmt.formatNotifications)
      break

    case 'nip-publish': {
      const id = req(1, 'nip-publish <identifier> <title> <content-or-file>')
      const title = req(2, 'nip-publish <identifier> <title> <content-or-file>')
      let content = req(3, 'nip-publish <identifier> <title> <content-or-file>')
      const { existsSync, readFileSync } = await import('node:fs')
      const { validateInputPath } = await import('../../validation.js')
      if (existsSync(content)) {
        // Treat the third arg as a path when it resolves to an existing file.
        // Validate against the input allowlist so a pasted path like
        // /etc/shadow does not get slurped into a published NIP.
        content = readFileSync(validateInputPath(content), 'utf-8')
      }
      const kindsStr = flag('kinds')
      const kinds = kindsStr ? kindsStr.split(',').map(Number) : undefined
      out(await handleNipPublish(ctx, pool, { identifier: id, title, content, kinds, relays: flags('relay') }))
      break
    }

    case 'nip-read':
      out(await handleNipRead(pool, ctx.activeNpub, {
        author: flag('author'),
        identifier: flag('identifier'),
        kind: flag('kind') ? parseInt(flag('kind')!, 10) : undefined,
      }))
      break

    case 'blossom-upload':
      out(await handleBlossomUpload(ctx, {
        server: req(1, 'blossom-upload <server> <file>'),
        filePath: req(2, 'blossom-upload <server> <file>'),
      }))
      break

    case 'blossom-list':
      out(await handleBlossomList({
        server: req(1, 'blossom-list <server> <pubkey>'),
        pubkeyHex: req(2, 'blossom-list <server> <pubkey>'),
      }))
      break

    case 'blossom-delete':
      out(await handleBlossomDelete(ctx, {
        server: req(1, 'blossom-delete <server> <sha256>'),
        sha256: req(2, 'blossom-delete <server> <sha256>'),
      }))
      break

    case 'group-info':
      out(await handleGroupInfo(pool, ctx.activeNpub, {
        relay: req(1, 'group-info <relay-url> <group-id>'),
        groupId: req(2, 'group-info <relay-url> <group-id>'),
      }))
      break

    case 'group-chat':
      out(await handleGroupChat(pool, ctx.activeNpub, {
        relay: req(1, 'group-chat <relay-url> <group-id>'),
        groupId: req(2, 'group-chat <relay-url> <group-id>'),
        limit: parseInt(flag('limit', '20')!, 10),
      }), fmt.formatGroupChat)
      break

    case 'group-send':
      out(await handleGroupSend(ctx, pool, {
        relay: req(1, 'group-send <relay-url> <group-id> "message"'),
        groupId: req(2, 'group-send <relay-url> <group-id> "message"'),
        content: req(3, 'group-send <relay-url> <group-id> "message"'),
      }))
      break

    case 'group-members':
      out(await handleGroupMembers(pool, ctx.activeNpub, {
        relay: req(1, 'group-members <relay-url> <group-id>'),
        groupId: req(2, 'group-members <relay-url> <group-id>'),
      }))
      break

    case 'group-admins':
      out(await handleGroupAdmins(pool, {
        relay: req(1, 'group-admins <relay-url> <group-id>'),
        groupId: req(2, 'group-admins <relay-url> <group-id>'),
      }))
      break

    case 'group-roles':
      out(await handleGroupRoles(pool, {
        relay: req(1, 'group-roles <relay-url> <group-id>'),
        groupId: req(2, 'group-roles <relay-url> <group-id>'),
      }))
      break

    case 'group-inspect':
      out(await handleGroupInspect(pool, ctx.activeNpub, {
        relay: req(1, 'group-inspect <relay-url> <group-id>'),
        groupId: req(2, 'group-inspect <relay-url> <group-id>'),
      }))
      break

    case 'group-create':
      out(await handleGroupCreate(ctx, pool, {
        relay: req(1, 'group-create <relay-url> [group-id] [--name X]'),
        groupId: cmdArgs[2]?.startsWith('--') ? undefined : cmdArgs[2],
        name: flag('name'),
        about: flag('about'),
        picture: flag('picture'),
        banner: flag('banner'),
        isPrivate: hasFlag('private') ? true : undefined,
        isRestricted: hasFlag('restricted') ? true : undefined,
        isHidden: hasFlag('hidden') ? true : undefined,
        isOpen: hasFlag('open') ? true : hasFlag('closed') ? false : undefined,
        supportedKinds: flag('supported-kinds')?.split(',').map(Number),
      }))
      break

    case 'group-update':
      out(await handleGroupUpdate(ctx, pool, {
        relay: req(1, 'group-update <relay-url> <group-id> [--name X]'),
        groupId: req(2, 'group-update <relay-url> <group-id> [--name X]'),
        name: flag('name'),
        about: flag('about'),
        picture: flag('picture'),
        banner: flag('banner'),
        isPrivate: hasFlag('private') ? true : undefined,
        isRestricted: hasFlag('restricted') ? true : undefined,
        isHidden: hasFlag('hidden') ? true : undefined,
        isOpen: hasFlag('open') ? true : hasFlag('closed') ? false : undefined,
        supportedKinds: flag('supported-kinds')?.split(',').map(Number),
        parent: flag('parent'),
      }))
      break

    case 'group-add-user':
      out(await handleGroupAddUser(ctx, pool, {
        relay: req(1, 'group-add-user <relay-url> <group-id> <pubkey-hex> [--role admin]'),
        groupId: req(2, 'group-add-user <relay-url> <group-id> <pubkey-hex> [--role admin]'),
        pubkeyHex: req(3, 'group-add-user <relay-url> <group-id> <pubkey-hex> [--role admin]'),
        roles: flags('role'),
      }))
      break

    case 'group-remove-user':
      out(await handleGroupRemoveUser(ctx, pool, {
        relay: req(1, 'group-remove-user <relay-url> <group-id> <pubkey-hex>'),
        groupId: req(2, 'group-remove-user <relay-url> <group-id> <pubkey-hex>'),
        pubkeyHex: req(3, 'group-remove-user <relay-url> <group-id> <pubkey-hex>'),
      }))
      break

    case 'group-invite-create':
      out(await handleGroupCreateInvite(ctx, pool, {
        relay: req(1, 'group-invite-create <relay-url> <group-id> [--code X]'),
        groupId: req(2, 'group-invite-create <relay-url> <group-id> [--code X]'),
        code: flag('code'),
      }))
      break

    case 'group-join':
      out(await handleGroupJoin(ctx, pool, {
        relay: req(1, 'group-join <relay-url> <group-id> [--code X]'),
        groupId: req(2, 'group-join <relay-url> <group-id> [--code X]'),
        code: flag('code'),
      }))
      break

    case 'group-leave':
      out(await handleGroupLeave(ctx, pool, {
        relay: req(1, 'group-leave <relay-url> <group-id>'),
        groupId: req(2, 'group-leave <relay-url> <group-id>'),
      }))
      break

    case 'group-delete-event':
      out(await handleGroupDeleteEvent(ctx, pool, {
        relay: req(1, 'group-delete-event <relay-url> <group-id> <event-id> --confirm'),
        groupId: req(2, 'group-delete-event <relay-url> <group-id> <event-id> --confirm'),
        eventId: req(3, 'group-delete-event <relay-url> <group-id> <event-id> --confirm'),
        confirm: hasFlag('confirm'),
      }))
      break

    case 'group-delete':
      out(await handleGroupDelete(ctx, pool, {
        relay: req(1, 'group-delete <relay-url> <group-id> --confirm <group-id>'),
        groupId: req(2, 'group-delete <relay-url> <group-id> --confirm <group-id>'),
        confirmGroupId: flag('confirm'),
      }))
      break

    case 'group-forum-topics':
      out(await handleGroupForumTopics(pool, {
        relay: req(1, 'group-forum-topics <relay-url> <group-id>'),
        groupId: req(2, 'group-forum-topics <relay-url> <group-id>'),
        limit: parseInt(flag('limit', '50')!, 10),
      }))
      break

    case 'group-forum-topic-create':
      out(await handleGroupForumTopicCreate(ctx, pool, {
        relay: req(1, 'group-forum-topic-create <relay-url> <group-id> <title> <content>'),
        groupId: req(2, 'group-forum-topic-create <relay-url> <group-id> <title> <content>'),
        title: req(3, 'group-forum-topic-create <relay-url> <group-id> <title> <content>'),
        content: req(4, 'group-forum-topic-create <relay-url> <group-id> <title> <content>'),
      }))
      break

    case 'group-forum-comments':
      out(await handleGroupForumComments(pool, {
        relay: req(1, 'group-forum-comments <relay-url> <group-id> <topic-id>'),
        groupId: req(2, 'group-forum-comments <relay-url> <group-id> <topic-id>'),
        topicId: req(3, 'group-forum-comments <relay-url> <group-id> <topic-id>'),
        limit: parseInt(flag('limit', '100')!, 10),
      }))
      break

    case 'group-forum-comment':
      out(await handleGroupForumComment(ctx, pool, {
        relay: req(1, 'group-forum-comment <relay-url> <group-id> <topic-id> <content> [--parent id]'),
        groupId: req(2, 'group-forum-comment <relay-url> <group-id> <topic-id> <content> [--parent id]'),
        topicId: req(3, 'group-forum-comment <relay-url> <group-id> <topic-id> <content> [--parent id]'),
        content: req(4, 'group-forum-comment <relay-url> <group-id> <topic-id> <content> [--parent id]'),
        parentId: flag('parent'),
      }))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
