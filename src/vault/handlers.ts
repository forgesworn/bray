import {
  deriveContentKey,
  contentKeyToHex,
  getCurrentEpochId,
  encrypt,
  decrypt,
  defaultConfig,
  revokePubkey as dominionRevoke,
  addToTier,
  KIND_VAULT_SHARE,
} from 'dominion-protocol'
import { buildVaultConfigEvent, buildVaultShareEvent, parseVaultShare } from 'dominion-protocol/nostr'
import { getConversationKey, encrypt as nip44Encrypt, decrypt as nip44Decrypt } from 'nostr-tools/nip44'
import { npubEncode, decode } from 'nostr-tools/nip19'
import type { Event as NostrEvent } from 'nostr-tools'
import type { DominionConfig } from 'dominion-protocol'
import type { SigningContext } from '../signing-context.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { TrustContext, TrustAnnotation } from '../trust-context.js'
import type { PublishResult } from '../types.js'

// ─── Result types ─────────────────────────────────────────────────────────────

export interface VaultCreateResult {
  event: NostrEvent
  publish: PublishResult
  tiers: string[]
}

export interface VaultEncryptResult {
  ciphertext: string
  tier: string
  epoch: string
}

export interface VaultShareResult {
  published: number
  failed: number
  recipients: string[]
}

export interface VaultReadResult {
  plaintext: string
  tier: string
  epoch: string
}

export interface VaultReadSharedResult {
  plaintext: string
  tier: string
  epoch: string
  sharedBy: string
}

export interface VaultRevokeResult {
  event: NostrEvent
  publish: PublishResult
  revokedPubkey: string
}

export interface VaultMemberEntry {
  pubkey: string
  npub: string
  tier: string
  trust?: TrustAnnotation
}

export interface VaultMembersResult {
  members: VaultMemberEntry[]
  total: number
}

export interface VaultConfigResult {
  tierNames: string[]
  tierCounts: Record<string, number>
  revokedCount: number
  grantCount: number
  currentEpoch: string
  authorNpub: string
}

export interface VaultRotateResult {
  currentEpoch: string
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an npub or raw hex pubkey to hex. Throws on invalid input. */
function toHexPubkey(pubkeyOrNpub: string): string {
  if (/^npub1/.test(pubkeyOrNpub)) {
    const decoded = decode(pubkeyOrNpub)
    if (decoded.type !== 'npub') throw new Error(`Expected npub, got ${decoded.type}`)
    return decoded.data as string
  }
  if (/^[0-9a-f]{64}$/.test(pubkeyOrNpub)) return pubkeyOrNpub
  throw new Error(`Invalid pubkey: expected 64-char hex or npub1... bech32, got: ${pubkeyOrNpub}`)
}

/** Fetch the latest vault config for a given author pubkey from relays. */
async function fetchVaultConfig(
  pool: RelayPool,
  callerNpub: string,
  authorPubkeyHex: string,
): Promise<DominionConfig | null> {
  const events = await pool.query(callerNpub, {
    kinds: [30078],
    authors: [authorPubkeyHex],
    '#d': ['dominion:vault-config'],
  } as any)

  if (events.length === 0) return null

  const newest = (events as NostrEvent[]).reduce((a, b) =>
    b.created_at > a.created_at ? b : a,
  )

  try {
    return JSON.parse(newest.content) as DominionConfig
  } catch {
    return null
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** Create a vault config with named tiers, sign and publish as kind 30078. */
export async function handleVaultCreate(
  ctx: SigningContext,
  pool: RelayPool,
  args: { tiers: string[] },
): Promise<VaultCreateResult> {
  const authorPubkeyHex = ctx.activePublicKeyHex

  let config = defaultConfig()

  for (const tier of args.tiers) {
    // addToTier creates the tier if it does not exist (passing an empty string as pubkey would be invalid —
    // we just create the key with an empty array by directly mutating the config tiers object)
    config = {
      ...config,
      tiers: {
        ...config.tiers,
        [tier]: config.tiers[tier] !== undefined ? config.tiers[tier] : [],
      },
    }
  }

  const template = buildVaultConfigEvent(authorPubkeyHex, config)
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)

  return {
    event,
    publish,
    tiers: Object.keys(config.tiers),
  }
}

/** Encrypt content with a content key derived from the active identity for a given tier + epoch. */
export async function handleVaultEncrypt(
  ctx: SigningContext,
  args: { content: string; tier: string; epoch?: string },
): Promise<VaultEncryptResult> {
  const privkeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  const epoch = args.epoch ?? getCurrentEpochId()
  const ck = deriveContentKey(privkeyHex, epoch, args.tier)
  try {
    const ciphertext = await encrypt(args.content, ck)
    return { ciphertext, tier: args.tier, epoch }
  } finally {
    ck.fill(0)
  }
}

/** Derive the content key and distribute vault shares to recipients. */
export async function handleVaultShare(
  ctx: SigningContext,
  pool: RelayPool,
  args: { tier: string; recipients: string[]; epoch?: string },
): Promise<VaultShareResult> {
  const privkeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  const privkeyBytes = Buffer.from(privkeyHex, 'hex')
  const epoch = args.epoch ?? getCurrentEpochId()
  const authorPubkeyHex = ctx.activePublicKeyHex
  const ck = deriveContentKey(privkeyHex, epoch, args.tier)
  let published = 0
  let failed = 0
  const successfulRecipients: string[] = []

  try {
    const ckHex = contentKeyToHex(ck)

    for (const recipient of args.recipients) {
      const recipientHex = toHexPubkey(recipient)

      try {
        // NIP-44 encrypt the content key to the recipient
        const conversationKey = getConversationKey(privkeyBytes, recipientHex)
        const encryptedCkHex = nip44Encrypt(ckHex, conversationKey)

        const template = buildVaultShareEvent(authorPubkeyHex, recipientHex, ckHex, epoch, args.tier)
        const sign = ctx.getSigningFunction()
        const event = await sign({
          kind: template.kind,
          created_at: template.created_at,
          tags: template.tags,
          content: encryptedCkHex, // encrypted, not the raw ckHex from the template
        })

        const result = await pool.publish(ctx.activeNpub, event)
        if (result.accepted.length > 0) {
          published++
          successfulRecipients.push(npubEncode(recipientHex))
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
  } finally {
    ck.fill(0)
    privkeyBytes.fill(0)
  }

  return { published, failed, recipients: successfulRecipients }
}

/** Decrypt ciphertext using the content key for the active identity's tier + epoch. */
export async function handleVaultRead(
  ctx: SigningContext,
  args: { ciphertext: string; tier: string; epoch: string },
): Promise<VaultReadResult> {
  const privkeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  const ck = deriveContentKey(privkeyHex, args.epoch, args.tier)
  try {
    const plaintext = await decrypt(args.ciphertext, ck)
    return { plaintext, tier: args.tier, epoch: args.epoch }
  } finally {
    ck.fill(0)
  }
}

/** Fetch a shared vault key from relays, decrypt it, and use it to decrypt ciphertext. */
export async function handleVaultReadShared(
  ctx: SigningContext,
  pool: RelayPool,
  args: { ciphertext: string; authorPubkey: string; tier: string; epoch: string },
): Promise<VaultReadSharedResult> {
  const recipientHex = ctx.activePublicKeyHex
  const authorHex = toHexPubkey(args.authorPubkey)
  const privkeyHex = Buffer.from((ctx as IdentityContext).activePrivateKey).toString('hex')
  const privkeyBytes = Buffer.from(privkeyHex, 'hex')

  try {
    // Query for vault share events from the author for this tier+epoch addressed to us
    const events = await pool.query(ctx.activeNpub, {
      kinds: [KIND_VAULT_SHARE],
      authors: [authorHex],
      '#d': [`${args.epoch}:${args.tier}`],
      '#p': [recipientHex],
    } as any)

    if (events.length === 0) {
      throw new Error(`No vault share found from ${args.authorPubkey} for tier "${args.tier}" epoch "${args.epoch}"`)
    }

    // Use the most recent share event
    const newest = (events as NostrEvent[]).reduce((a, b) =>
      b.created_at > a.created_at ? b : a,
    )

    // NIP-44 decrypt the content key from the share event
    const conversationKey = getConversationKey(privkeyBytes, authorHex)
    const ckHex = nip44Decrypt(newest.content, conversationKey)

    // Reconstruct the content key buffer and decrypt the ciphertext
    const ck = Buffer.from(ckHex, 'hex')
    try {
      const plaintext = await decrypt(args.ciphertext, ck)
      return {
        plaintext,
        tier: args.tier,
        epoch: args.epoch,
        sharedBy: npubEncode(authorHex),
      }
    } finally {
      ck.fill(0)
    }
  } finally {
    privkeyBytes.fill(0)
  }
}

/** Revoke a pubkey from the vault config and publish the updated config. */
export async function handleVaultRevoke(
  ctx: SigningContext,
  pool: RelayPool,
  args: { pubkey: string },
): Promise<VaultRevokeResult> {
  const authorPubkeyHex = ctx.activePublicKeyHex
  const revokedHex = toHexPubkey(args.pubkey)

  const existing = await fetchVaultConfig(pool, ctx.activeNpub, authorPubkeyHex)
  const config = existing ?? defaultConfig()

  const updated = dominionRevoke(config, revokedHex)
  const template = buildVaultConfigEvent(authorPubkeyHex, updated)
  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
  })

  const publish = await pool.publish(ctx.activeNpub, event)

  return { event, publish, revokedPubkey: npubEncode(revokedHex) }
}

/** Fetch vault config and list members annotated with trust levels. */
export async function handleVaultMembers(
  pool: RelayPool,
  trust: TrustContext,
  callerNpub: string,
  args: { authorPubkey?: string },
): Promise<VaultMembersResult> {
  const authorNpub = args.authorPubkey ?? callerNpub
  const authorHex = toHexPubkey(authorNpub)

  const config = await fetchVaultConfig(pool, callerNpub, authorHex)
  if (!config) return { members: [], total: 0 }

  const members: VaultMemberEntry[] = []

  for (const [tierName, tierMembers] of Object.entries(config.tiers)) {
    if (!Array.isArray(tierMembers)) continue

    for (const pubkeyHex of tierMembers) {
      let trustAnnotation: TrustAnnotation | undefined
      try {
        const { toAnnotation } = await import('../trust-context.js')
        const assessment = await trust.assess(pubkeyHex)
        trustAnnotation = toAnnotation(assessment)
      } catch {
        // trust assessment failure is non-fatal — omit annotation
      }

      members.push({
        pubkey: pubkeyHex,
        npub: npubEncode(pubkeyHex),
        tier: tierName,
        trust: trustAnnotation,
      })
    }
  }

  return { members, total: members.length }
}

/** Fetch vault config and return a summary. */
export async function handleVaultConfig(
  pool: RelayPool,
  callerNpub: string,
  args: { authorPubkey?: string },
): Promise<VaultConfigResult> {
  const authorNpub = args.authorPubkey ?? callerNpub
  const authorHex = toHexPubkey(authorNpub)
  const currentEpoch = getCurrentEpochId()

  const config = await fetchVaultConfig(pool, callerNpub, authorHex)
  if (!config) {
    return {
      tierNames: [],
      tierCounts: {},
      revokedCount: 0,
      grantCount: 0,
      currentEpoch,
      authorNpub: npubEncode(authorHex),
    }
  }

  const tierNames = Object.keys(config.tiers)
  const tierCounts: Record<string, number> = {}
  for (const [name, members] of Object.entries(config.tiers)) {
    tierCounts[name] = Array.isArray(members) ? members.length : 0
  }

  return {
    tierNames,
    tierCounts,
    revokedCount: config.revokedPubkeys.length,
    grantCount: config.individualGrants.length,
    currentEpoch,
    authorNpub: npubEncode(authorHex),
  }
}

/** Return the current epoch ID. Purely informational. */
export function handleVaultRotate(): VaultRotateResult {
  const currentEpoch = getCurrentEpochId()
  return {
    currentEpoch,
    message: `Current epoch is ${currentEpoch}. Content keys for this epoch are derived from your private key. To rotate access, revoke recipients and re-share keys for the next epoch.`,
  }
}
