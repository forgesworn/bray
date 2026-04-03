/**
 * NIP-17 gift-wrap helpers that work with any SigningContext (local keys OR remote bunker).
 *
 * nostr-tools' wrapEvent/unwrapEvent require raw private key bytes, which are
 * unavailable when signing is delegated to a NIP-46 bunker. These helpers
 * reimplement the NIP-59 gift-wrap flow using the SigningContext interface
 * (nip44Encrypt, nip44Decrypt, getSigningFunction) so that both local-key
 * and bunker modes work identically.
 */

import { generateSecretKey, finalizeEvent, getEventHash } from 'nostr-tools/pure'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { SigningContext } from './signing-context.js'

const TWO_DAYS = 2 * 24 * 60 * 60
const now = () => Math.round(Date.now() / 1000)
const randomNow = () => Math.round(now() - Math.random() * TWO_DAYS)

interface Recipient {
  publicKey: string
  relayUrl?: string
}

/** Build the unsigned kind-14 rumor (inner DM event). */
function createRumor(
  senderPubkeyHex: string,
  recipient: Recipient | Recipient[],
  message: string,
): Record<string, unknown> {
  const recipients = Array.isArray(recipient) ? recipient : [recipient]
  const tags: string[][] = []
  for (const r of recipients) {
    tags.push(r.relayUrl ? ['p', r.publicKey, r.relayUrl] : ['p', r.publicKey])
  }
  const rumor = {
    created_at: Math.ceil(Date.now() / 1000),
    kind: 14,
    tags,
    content: message,
    pubkey: senderPubkeyHex,
  }
  // Rumor needs an id (hash) but no signature
  ;(rumor as any).id = getEventHash(rumor as any)
  return rumor
}

/**
 * Wrap a DM as a NIP-17 gift-wrapped event using the SigningContext.
 *
 * Flow (NIP-59):
 *   1. Build unsigned rumor (kind 14) with sender pubkey + message
 *   2. Create seal (kind 13): NIP-44 encrypt rumor with sender key, sign with sender key
 *   3. Create gift wrap (kind 1059): NIP-44 encrypt seal with random ephemeral key
 *
 * The sender's private key is never accessed directly -- all crypto operations
 * go through ctx.nip44Encrypt() and ctx.getSigningFunction(), which delegate
 * to the bunker in NIP-46 mode.
 */
export async function wrapEventAsync(
  ctx: SigningContext,
  recipient: Recipient,
  message: string,
): Promise<NostrEvent> {
  const senderPubkeyHex = ctx.activePublicKeyHex

  // 1. Build the rumor (unsigned kind-14)
  const rumor = createRumor(senderPubkeyHex, recipient, message)

  // 2. Create the seal (kind 13) -- encrypted with sender's key, signed by sender
  const sealContent = await ctx.nip44Encrypt(recipient.publicKey, JSON.stringify(rumor))
  const sign = ctx.getSigningFunction()
  const seal = await sign({
    kind: 13,
    content: sealContent,
    created_at: randomNow(),
    tags: [],
  })

  // 3. Create the gift wrap (kind 1059) -- encrypted with random ephemeral key
  const randomSk = generateSecretKey()
  const { getConversationKey, encrypt } = await import('nostr-tools/nip44')
  const ck = getConversationKey(randomSk, recipient.publicKey)
  const wrapContent = encrypt(JSON.stringify(seal), ck)

  const wrap = finalizeEvent(
    {
      kind: 1059,
      content: wrapContent,
      created_at: randomNow(),
      tags: [['p', recipient.publicKey]],
    },
    randomSk,
  ) as unknown as NostrEvent

  // Zeroise the ephemeral key
  randomSk.fill(0)

  return wrap
}

/**
 * Unwrap a NIP-17 gift-wrapped event using the SigningContext.
 *
 * Flow:
 *   1. Decrypt the gift wrap (kind 1059) content to get the seal
 *   2. Decrypt the seal (kind 13) content to get the rumor
 *   3. Return the rumor (the actual DM content)
 */
export async function unwrapEventAsync(
  ctx: SigningContext,
  wrap: NostrEvent,
): Promise<{ pubkey: string; content: string; created_at: number; tags: string[][] }> {
  // 1. Decrypt outer layer (gift wrap -> seal)
  //    The wrap was encrypted by a random ephemeral key; we decrypt using
  //    our key + the wrap's pubkey (the ephemeral key's public half).
  const sealJson = await ctx.nip44Decrypt(wrap.pubkey, wrap.content)
  const seal = JSON.parse(sealJson)

  // 2. Decrypt inner layer (seal -> rumor)
  //    The seal was encrypted by the sender's key; we decrypt using
  //    our key + the seal's pubkey (the sender's public key).
  const rumorJson = await ctx.nip44Decrypt(seal.pubkey, seal.content)
  const rumor = JSON.parse(rumorJson)

  return rumor
}
