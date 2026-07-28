/**
 * NIP-59 gift wrap for arbitrary events.
 *
 * `src/nip17-wrap.ts` wraps DMs specifically: it builds a kind 14 rumor from a
 * message string. This is the general form — seal and wrap any event you like,
 * which is what `nak gift wrap` does and what NIP-59 actually describes.
 *
 * Three layers:
 *   rumor  — an unsigned event, signed by nobody, identified only by its hash
 *   seal   — kind 13, the rumor NIP-44 encrypted to the recipient, signed by you
 *   wrap   — kind 1059, the seal NIP-44 encrypted under a throwaway key
 *
 * Only the wrap is public, and it is signed by an ephemeral key, so nothing
 * on the wire links back to the sender.
 *
 * All crypto goes through the SigningContext rather than a raw private key, so
 * this works unchanged under NIP-46 where the key lives in a remote bunker.
 */

import { finalizeEvent, generateSecretKey, getEventHash } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'

/** Timestamps are randomised up to two days back, per NIP-59, to frustrate correlation. */
const TWO_DAYS = 2 * 24 * 60 * 60
const randomNow = (): number => Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS)

const HEX64 = /^[0-9a-f]{64}$/i

/** An event to be wrapped. Anything already signed has its signature dropped: a rumor is unsigned by definition. */
export interface RumorInput {
  kind: number
  content?: string
  tags?: string[][]
  created_at?: number
}

export interface GiftWrapResult {
  /** The kind 1059 wrap, ready to publish. */
  wrap: NostrEvent
  /** The rumor's id, which the recipient will see after unwrapping. */
  rumorId: string
  recipient: string
}

/**
 * Seal and wrap an event for one recipient.
 *
 * @throws if the recipient pubkey is not 64-char hex.
 */
export async function handleGiftWrap(
  ctx: SigningContext,
  args: { event: RumorInput; recipientPubkey: string },
): Promise<GiftWrapResult> {
  const recipient = args.recipientPubkey.toLowerCase()
  if (!HEX64.test(recipient)) {
    throw new Error('recipientPubkey must be a 64-character hex public key')
  }

  // A rumor carries an id but no signature — that is what makes it deniable.
  const rumor = {
    pubkey: ctx.activePublicKeyHex,
    created_at: args.event.created_at ?? Math.floor(Date.now() / 1000),
    kind: args.event.kind,
    tags: args.event.tags ?? [],
    content: args.event.content ?? '',
  }
  const rumorId = getEventHash(rumor as any)
  const rumorWithId = { ...rumor, id: rumorId }

  // Seal: rumor encrypted to the recipient, signed by us
  const sealContent = await ctx.nip44Encrypt(recipient, JSON.stringify(rumorWithId))
  const sign = ctx.getSigningFunction()
  const seal = await sign({
    kind: 13,
    content: sealContent,
    created_at: randomNow(),
    tags: [],
  })

  // Wrap: seal encrypted under a throwaway key, so the wrap is unattributable
  const ephemeralSk = generateSecretKey()
  try {
    const { getConversationKey, encrypt } = await import('nostr-tools/nip44')
    const ck = getConversationKey(ephemeralSk, recipient)
    const wrap = finalizeEvent(
      {
        kind: 1059,
        content: encrypt(JSON.stringify(seal), ck),
        created_at: randomNow(),
        tags: [['p', recipient]],
      },
      ephemeralSk,
    ) as unknown as NostrEvent

    return { wrap, rumorId, recipient }
  } finally {
    ephemeralSk.fill(0)
  }
}

export interface GiftUnwrapResult {
  /** The rumor that was hidden inside. */
  rumor: { id?: string; pubkey: string; kind: number; content: string; tags: string[][]; created_at: number }
  /** Pubkey that signed the seal — the real sender. */
  sender: string
  /**
   * Whether the seal's signer matches the rumor's claimed author.
   *
   * A mismatch means someone sealed an event attributed to a third party.
   * NIP-59 requires the recipient to check this; a rumor is unsigned, so its
   * `pubkey` field is a claim, not proof.
   */
  senderMatchesRumor: boolean
}

/**
 * Unwrap a kind 1059 gift wrap back to its rumor.
 *
 * @throws if the event is not a gift wrap, or either layer fails to decrypt.
 */
export async function handleGiftUnwrap(
  ctx: SigningContext,
  args: { event: NostrEvent },
): Promise<GiftUnwrapResult> {
  const wrap = args.event
  if (wrap?.kind !== 1059) {
    throw new Error(`Expected a kind 1059 gift wrap, got kind ${wrap?.kind}`)
  }

  // Outer layer: decrypt against the ephemeral pubkey that signed the wrap
  let seal: NostrEvent
  try {
    seal = JSON.parse(await ctx.nip44Decrypt(wrap.pubkey, wrap.content))
  } catch (e) {
    throw new Error(`Could not decrypt the gift wrap — it may not be addressed to this identity: ${(e as Error).message}`)
  }
  if (seal?.kind !== 13) {
    throw new Error(`Expected a kind 13 seal inside the wrap, got kind ${seal?.kind}`)
  }

  // Inner layer: decrypt against the seal's signer, which is the real sender
  let rumor: GiftUnwrapResult['rumor']
  try {
    rumor = JSON.parse(await ctx.nip44Decrypt(seal.pubkey, seal.content))
  } catch (e) {
    throw new Error(`Could not decrypt the seal: ${(e as Error).message}`)
  }

  return {
    rumor,
    sender: seal.pubkey,
    senderMatchesRumor: rumor.pubkey === seal.pubkey,
  }
}
