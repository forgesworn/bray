import { handleSocialPost, handleSocialReply, handleSocialReact, handleSocialDelete, handleSocialRepost, handleSocialProfileGet, handleSocialProfileSet, handleContactsGet, handleContactsFollow, handleContactsUnfollow } from '../../social/handlers.js'
import { handleDmSend, handleDmRead } from '../../social/dm.js'
import { handleNotifications, handleFeed } from '../../social/notifications.js'
import { handleNipPublish, handleNipRead } from '../../social/nips.js'
import { handleBlossomUpload, handleBlossomList, handleBlossomDelete } from '../../social/blossom.js'
import { handleGroupInfo, handleGroupChat, handleGroupSend, handleGroupMembers } from '../../social/groups.js'
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
      if (existsSync(content)) content = readFileSync(content, 'utf-8')
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
        relay: '',
        groupId: req(1, 'group-info <group-id>'),
      }))
      break

    case 'group-chat':
      out(await handleGroupChat(pool, ctx.activeNpub, {
        groupId: req(1, 'group-chat <group-id>'),
        limit: parseInt(flag('limit', '20')!, 10),
      }), fmt.formatGroupChat)
      break

    case 'group-send':
      out(await handleGroupSend(ctx, pool, {
        groupId: req(1, 'group-send <group-id> "message"'),
        content: req(2, 'group-send <group-id> "message"'),
      }))
      break

    case 'group-members':
      out(await handleGroupMembers(pool, ctx.activeNpub, {
        groupId: req(1, 'group-members <group-id>'),
      }))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
