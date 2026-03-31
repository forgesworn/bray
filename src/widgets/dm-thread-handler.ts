/**
 * Widget handler for the DM thread view. Calls existing handleDmConversation,
 * enriches with partner profile and image fetched server-side.
 */

import { decode } from 'nostr-tools/nip19'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import { handleDmConversation } from '../social/dm.js'
import { handleSocialProfileGet } from '../social/handlers.js'
import { fetchProfileImage } from './profile-images.js'

export interface DmThreadMessage {
  id: string
  content?: string
  createdAt: number
  fromSelf: boolean
  protocol: 'nip17' | 'nip04-deprecated'
}

export interface DmThreadPartnerProfile {
  name?: string
  pictureDataUri?: string
  npub: string
}

export interface DmThreadResult {
  messages: DmThreadMessage[]
  partnerProfile: DmThreadPartnerProfile
  _partnerPubkeyHex: string
}

const MAX_MESSAGES = 50

export async function handleDmThreadWidget(
  ctx: SigningContext,
  pool: RelayPool,
  args: { withPubkeyHex: string },
): Promise<DmThreadResult> {
  const activeHex = decode(ctx.activeNpub).data as string

  // Fetch conversation (already filtered and sorted chronologically)
  const conversation = await handleDmConversation(ctx, pool, {
    withPubkeyHex: args.withPubkeyHex,
    limit: MAX_MESSAGES * 2, // fetch more to account for both sides
  })

  // Map to widget shape, limit to MAX_MESSAGES most recent
  const messages: DmThreadMessage[] = conversation
    .slice(-MAX_MESSAGES)
    .map(m => ({
      id: m.id,
      content: m.decrypted ? m.content : undefined,
      createdAt: m.createdAt,
      fromSelf: m.from === activeHex,
      protocol: m.protocol,
    }))

  // Fetch partner profile
  let partnerName: string | undefined
  let partnerPictureDataUri: string | undefined

  try {
    const profile = await handleSocialProfileGet(pool, ctx.activeNpub, args.withPubkeyHex)
    partnerName = (profile?.display_name as string) || (profile?.name as string) || undefined
    const picture = profile?.picture as string | undefined
    if (picture) {
      partnerPictureDataUri = await fetchProfileImage(picture)
    }
  } catch { /* partner profile may not exist */ }

  let partnerNpub: string
  try {
    const { npubEncode } = await import('nostr-tools/nip19')
    partnerNpub = npubEncode(args.withPubkeyHex)
  } catch {
    partnerNpub = args.withPubkeyHex
  }

  return {
    messages,
    partnerProfile: {
      name: partnerName,
      pictureDataUri: partnerPictureDataUri,
      npub: partnerNpub,
    },
    _partnerPubkeyHex: args.withPubkeyHex,
  }
}
