/**
 * nostr-bray SDK — factory API for programmatic use.
 *
 * Usage:
 *   const bray = await createBray({ sec: 'nsec1...', relays: ['wss://relay.damus.io'] })
 *   await bray.post('gm nostr')
 *   await bray.dm(pubkey, 'hello')
 *   bray.destroy()
 *
 * Env-based fallback (option 2 — reads NOSTR_SECRET_KEY / NOSTR_RELAYS):
 *   const bray = await defaultBray()
 */

import { loadConfig, detectKeyFormat } from './config.js'
import { IdentityContext } from './context.js'
import { RelayPool } from './relay-pool.js'
import { Nip65Manager } from './nip65.js'

import { handleIdentityCreate, handleIdentityList, handleIdentityProve } from './identity/handlers.js'
import { handleBackupShamir, handleRestoreShamir } from './identity/shamir.js'
import { handleIdentityBackup, handleIdentityRestore, handleIdentityMigrate } from './identity/migration.js'

import { handleSocialPost, handleSocialReply, handleSocialReact, handleSocialDelete, handleSocialRepost, handleSocialProfileGet, handleSocialProfileSet, handleContactsGet, handleContactsFollow, handleContactsUnfollow, handlePublishEvent } from './social/handlers.js'
import { handleDmSend, handleDmRead } from './social/dm.js'
import { handleNotifications, handleFeed } from './social/notifications.js'
import { handleNipPublish, handleNipRead } from './social/nips.js'

import { handleTrustAttest, handleTrustRead, handleTrustVerify, handleTrustRevoke, handleTrustRequest, handleTrustRequestList, handleTrustProofPublish } from './trust/handlers.js'
import { handleTrustRingProve, handleTrustRingVerify } from './trust/ring.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from './trust/spoken.js'

import { handleRelayInfo, handleRelayList, handleRelaySet, handleRelayQuery } from './relay/handlers.js'

import { handleZapSend, handleZapBalance, handleZapMakeInvoice, handleZapLookupInvoice, handleZapListTransactions, handleZapReceipts, handleZapDecode, resolveNwcUri } from './zap/handlers.js'

import { handleDuressConfigure, handleDuressActivate } from './safety/handlers.js'

import { handlePublishRaw } from './event/handlers.js'

import { handleDecode, handleEncodeNpub, handleEncodeNote, handleEncodeNprofile, handleEncodeNevent, handleEncodeNsec, handleVerify, handleEncrypt, handleDecrypt, handleCount, handleFetch, handleKeyPublic, handleFilter, handleNipList, handleNipShow } from './util/handlers.js'
import { handleKeyEncrypt, handleKeyDecrypt } from './util/ncryptsec.js'

import type { Filter } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

// ─── Config ──────────────────────────────────────────────────────────────────

/** Minimal config needed to construct a BrayClient. */
export interface BrayClientConfig {
  /** nsec, hex private key, or BIP-39 mnemonic */
  sec?: string
  /** bunker:// URI for NIP-46 remote signing (use instead of sec) */
  bunkerUri?: string
  /** Relay URLs. Defaults to NOSTR_RELAYS env var if omitted. */
  relays?: string[]
  /** Nostr Wallet Connect URI for zap operations */
  nwcUri?: string
  /** Path to wallets JSON file (multi-wallet NWC lookup) */
  walletsFile?: string
  /** SOCKS5h proxy for Tor */
  torProxy?: string
  allowClearnetWithTor?: boolean
  /**
   * Allow relays on private networks (localhost, RFC 1918, etc). Set only for
   * dev/test scenarios — gated by the BRAY_ALLOW_PRIVATE_RELAYS=1 env var in
   * the CLI and server.
   */
  allowPrivateRelays?: boolean
  nip04Enabled?: boolean
}

// ─── Client interface ─────────────────────────────────────────────────────────

export interface BrayClient {
  // ── Identity ────────────────────────────────────────────────────────────────
  /** Active identity npub */
  readonly npub: string

  /** Active identity pubkey in hex */
  readonly hexPubkey: string

  /** Current relay set for the active identity */
  readonly relays: { read: string[]; write: string[] }

  /** Generate a fresh identity — does NOT switch active identity */
  create(): { npub: string; mnemonic: string }

  /** List all identities in the nsec-tree */
  list(): Promise<import('./types.js').PublicIdentity[]>

  /** Derive a child identity by purpose */
  derive(purpose: string, index?: number): Promise<import('./identity/handlers.js').DeriveResult>

  /** Derive a named persona */
  persona(name: string, index?: number): Promise<import('./identity/handlers.js').DeriveResult>

  /** Switch active identity */
  switch(target: string, index?: number): Promise<void>

  /** Create a linkage proof */
  prove(mode?: 'blind' | 'full'): Promise<unknown>

  /** Publish linkage proof to relays (irreversible) */
  proofPublish(mode?: 'blind' | 'full', opts?: { confirm?: boolean }): Promise<unknown>

  /** Shamir backup to a directory */
  backup(outputDir: string, opts?: { threshold?: number; shares?: number }): { files: string[]; threshold: number; shares: number }

  /** Restore identity from Shamir shards */
  restore(files: string[], threshold?: number): Uint8Array

  /** Fetch profile/contacts/relays as a bundle for a pubkey */
  identityBackup(pubkeyHex: string): Promise<unknown>

  /** Re-sign a backup bundle under the active identity */
  identityRestore(pubkeyHex: string): Promise<unknown>

  /** Migrate from an old identity */
  migrate(oldPubkeyHex: string, oldNpub: string, opts?: { confirm?: boolean }): Promise<unknown>

  // ── Social ──────────────────────────────────────────────────────────────────
  /** Post a text note (kind 1) */
  post(content: string, opts?: { tags?: string[][]; relays?: string[] }): Promise<import('./social/handlers.js').PostResult>

  /** Reply to an event */
  reply(eventId: string, eventPubkey: string, content: string, opts?: { relays?: string[] }): Promise<unknown>

  /** React to an event */
  react(eventId: string, eventPubkey: string, reaction?: string, opts?: { relays?: string[] }): Promise<unknown>

  /** Like an event (react with '+') */
  like(eventId: string, eventPubkey: string, opts?: { relays?: string[] }): Promise<unknown>

  /** Request deletion of your event (kind 5) */
  delete(eventId: string, reason?: string, opts?: { relays?: string[] }): Promise<unknown>

  /** Repost/boost an event (kind 6) */
  repost(eventId: string, eventPubkey: string, opts?: { relays?: string[] }): Promise<unknown>

  /** Fetch a profile */
  profile(pubkeyHex: string): Promise<unknown>

  /** Fetch the active identity's own profile */
  myProfile(): Promise<unknown>

  /** Set profile metadata */
  profileSet(profile: Record<string, unknown>, opts?: { confirm?: boolean; relays?: string[] }): Promise<unknown>

  /** List who a pubkey follows */
  contacts(pubkeyHex: string): Promise<unknown>

  /** List who the active identity follows */
  myContacts(): Promise<unknown>

  /** Follow a pubkey */
  follow(pubkeyHex: string, opts?: { relay?: string; petname?: string; relays?: string[] }): Promise<unknown>

  /** Unfollow a pubkey */
  unfollow(pubkeyHex: string, opts?: { relays?: string[] }): Promise<unknown>

  /** Send a NIP-17 encrypted DM */
  dm(recipientPubkeyHex: string, message: string, opts?: { nip04?: boolean; relays?: string[] }): Promise<unknown>

  /** Read received DMs */
  dmRead(): Promise<unknown>

  /** Fetch text note feed */
  feed(opts?: { limit?: number }): Promise<unknown>

  /** Fetch mentions, replies, reactions, zaps */
  notifications(opts?: { limit?: number }): Promise<unknown>

  /** Publish a community NIP (kind 30817) */
  nipPublish(identifier: string, title: string, content: string, opts?: { kinds?: number[]; relays?: string[] }): Promise<unknown>

  /** Fetch community NIPs */
  nipRead(opts?: { author?: string; identifier?: string; kind?: number }): Promise<unknown>

  // ── Trust ───────────────────────────────────────────────────────────────────
  /** Attest to an assertion */
  attest(assertionId: string, opts?: { type?: string; summary?: string; subject?: string; relays?: string[] }): Promise<unknown>

  /** Make a direct claim */
  claim(type: string, opts?: { subject?: string; identifier?: string; summary?: string; relays?: string[] }): Promise<unknown>

  /** Read attestations */
  trustRead(opts?: { subject?: string; type?: string; attestor?: string }): Promise<unknown>

  /** Validate attestation structure — pure, sync */
  trustVerify(event: NostrEvent): { valid: boolean; errors: string[] }

  /** Revoke an attestation */
  trustRevoke(type: string, identifier: string): Promise<unknown>

  /** Send an attestation request via DM */
  trustRequest(recipientPubkeyHex: string, subject: string, attestationType: string): Promise<unknown>

  /** Scan DMs for attestation requests */
  trustRequestList(): Promise<unknown>

  /** Create a ring signature proof */
  ringProve(attestationType: string, ring: string[], opts?: { relays?: string[] }): Promise<unknown>

  /** Verify a ring signature — pure, sync */
  ringVerify(event: NostrEvent): { valid: boolean }

  /** Generate a spoken token — pure, sync */
  spokenChallenge(secret: string, context: string, counter: number): unknown

  /** Verify a spoken token — pure, sync */
  spokenVerify(secret: string, context: string, counter: number, input: string): unknown

  // ── Relay ───────────────────────────────────────────────────────────────────
  /** List relays for active identity */
  relayList(opts?: { compare?: string }): Promise<unknown>

  /** Publish kind 10002 relay list */
  relaySet(relays: Array<{ url: string; read?: boolean; write?: boolean }>, opts?: { confirm?: boolean }): Promise<unknown>

  /** Fetch NIP-11 relay info */
  relayInfo(url: string): Promise<unknown>

  /** Query events via REQ */
  req(filter: Partial<Filter>): Promise<NostrEvent[]>

  // ── Zap ─────────────────────────────────────────────────────────────────────
  /** Pay a bolt11 invoice via NWC */
  zapSend(bolt11: string): Promise<unknown>

  /** Request wallet balance via NWC */
  zapBalance(): Promise<unknown>

  /** Generate invoice via NWC */
  zapInvoice(amountMsats: number, description?: string): Promise<unknown>

  /** Look up invoice status */
  zapLookup(paymentHash: string): Promise<unknown>

  /** List recent transactions */
  zapTransactions(opts?: { limit?: number }): Promise<unknown>

  /** Fetch zap receipts */
  zapReceipts(opts?: { limit?: number }): Promise<unknown>

  /** Decode a bolt11 invoice — pure, sync */
  zapDecode(bolt11: string): unknown

  // ── Safety ──────────────────────────────────────────────────────────────────
  safetyConfigure(personaName?: string): Promise<unknown>
  safetyActivate(personaName?: string): Promise<unknown>

  // ── Event ───────────────────────────────────────────────────────────────────
  /** Build and publish an arbitrary event */
  event(kind: number, opts?: { content?: string; tags?: string[][]; relays?: string[] }): Promise<unknown>

  /** Sign+broadcast an event (optionally skip signing with noSign) */
  publishRaw(event: Record<string, unknown>, opts?: { noSign?: boolean; relays?: string[] }): Promise<unknown>

  // ── Utility — all sync/pure ─────────────────────────────────────────────────
  /** Decode a nip19 entity */
  decode(input: string): unknown

  /** Encode hex pubkey as npub */
  encodeNpub(hex: string): string

  /** Encode hex event ID as note */
  encodeNote(hex: string): string

  /** Encode pubkey + relays as nprofile */
  encodeNprofile(pubkey: string, relays?: string[]): string

  /** Encode event ID + relays as nevent */
  encodeNevent(id: string, relays?: string[], author?: string): string

  /** Encode hex private key as nsec */
  encodeNsec(hex: string): string

  /** Derive pubkey from secret key */
  keyPublic(secret: string): { pubkeyHex: string; npub: string }

  /** Encrypt key as ncryptsec (NIP-49) */
  keyEncrypt(secret: string, password: string): { ncryptsec: string }

  /** Decrypt ncryptsec (NIP-49) */
  keyDecrypt(ncryptsec: string, password: string): { pubkeyHex: string; npub: string }

  /** Verify event hash and signature — pure */
  verify(event: NostrEvent): { valid: boolean; errors: string[] }

  /** NIP-44 encrypt for a recipient */
  encrypt(recipientPubkeyHex: string, plaintext: string): string

  /** NIP-44 decrypt from a sender */
  decrypt(senderPubkeyHex: string, ciphertext: string): string

  /** Count events matching a filter */
  count(filter: Partial<Filter>): Promise<unknown>

  /** Fetch events by nip19 code */
  fetch(nip19: string): Promise<unknown>

  /** Test if an event matches a filter — pure */
  filter(event: NostrEvent, filter: Filter): { matches: boolean }

  /** List all official NIPs */
  nipList(): Promise<Array<{ number: number; title: string }>>

  /** Show a specific NIP */
  nipShow(number: number): Promise<{ number: number; content: string }>

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  /** Close connections and zero key material */
  destroy(): void
}

// ─── Implementation ───────────────────────────────────────────────────────────

class BrayClientImpl implements BrayClient {
  readonly #ctx: IdentityContext
  readonly #pool: RelayPool
  readonly #walletsFile: string
  readonly #nwcUri: string | undefined
  readonly #nip04Enabled: boolean

  constructor(
    ctx: IdentityContext,
    pool: RelayPool,
    walletsFile: string,
    nwcUri: string | undefined,
    nip04Enabled: boolean,
  ) {
    this.#ctx = ctx
    this.#pool = pool
    this.#walletsFile = walletsFile
    this.#nwcUri = nwcUri
    this.#nip04Enabled = nip04Enabled
  }

  get npub(): string { return this.#ctx.activeNpub }
  get hexPubkey(): string { return this.#ctx.activePublicKeyHex }
  get relays(): { read: string[]; write: string[] } { return this.#pool.getRelays(this.#ctx.activeNpub) }

  // ── Identity ────────────────────────────────────────────────────────────────
  create() { return handleIdentityCreate() }
  async list() { return handleIdentityList(this.#ctx) }
  async derive(purpose: string, index = 0) { return this.#ctx.derive(purpose, index) }
  async persona(name: string, index = 0) { return this.#ctx.derivePersona(name, index) }
  async switch(target: string, index?: number) { return this.#ctx.switch(target, index) }
  async prove(mode: 'blind' | 'full' = 'blind') { return handleIdentityProve(this.#ctx, { mode }) }
  async proofPublish(mode: 'blind' | 'full' = 'blind', opts: { confirm?: boolean } = {}) {
    return handleTrustProofPublish(this.#ctx, this.#pool, { mode, confirm: opts.confirm ?? false })
  }
  backup(outputDir: string, opts: { threshold?: number; shares?: number } = {}) {
    return handleBackupShamir({
      secret: new Uint8Array(this.#ctx.activePrivateKey),
      outputDir,
      threshold: opts.threshold ?? 3,
      shares: opts.shares ?? 5,
    })
  }
  restore(files: string[], threshold = 3) {
    return handleRestoreShamir({ files, threshold })
  }
  async identityBackup(pubkeyHex: string) {
    return handleIdentityBackup(this.#pool, pubkeyHex, this.#ctx.activeNpub)
  }
  async identityRestore(pubkeyHex: string) {
    const bundle = await handleIdentityBackup(this.#pool, pubkeyHex, this.#ctx.activeNpub)
    return handleIdentityRestore(this.#ctx, this.#pool, bundle)
  }
  async migrate(oldPubkeyHex: string, oldNpub: string, opts: { confirm?: boolean } = {}) {
    return handleIdentityMigrate(this.#ctx, this.#pool, {
      oldPubkeyHex, oldNpub, confirm: opts.confirm ?? false,
    })
  }

  // ── Social ──────────────────────────────────────────────────────────────────
  async post(content: string, opts: { tags?: string[][]; relays?: string[] } = {}) {
    return handleSocialPost(this.#ctx, this.#pool, { content, ...opts })
  }
  async reply(eventId: string, eventPubkey: string, content: string, opts: { relays?: string[] } = {}) {
    return handleSocialReply(this.#ctx, this.#pool, { content, replyTo: eventId, replyToPubkey: eventPubkey, ...opts })
  }
  async react(eventId: string, eventPubkey: string, reaction = '+', opts: { relays?: string[] } = {}) {
    return handleSocialReact(this.#ctx, this.#pool, { eventId, eventPubkey, reaction, ...opts })
  }
  async like(eventId: string, eventPubkey: string, opts: { relays?: string[] } = {}) {
    return this.react(eventId, eventPubkey, '+', opts)
  }
  async delete(eventId: string, reason?: string, opts: { relays?: string[] } = {}) {
    return handleSocialDelete(this.#ctx, this.#pool, { eventId, reason, ...opts })
  }
  async repost(eventId: string, eventPubkey: string, opts: { relays?: string[] } = {}) {
    return handleSocialRepost(this.#ctx, this.#pool, { eventId, eventPubkey, ...opts })
  }
  async profile(pubkeyHex: string) {
    return handleSocialProfileGet(this.#pool, this.#ctx.activeNpub, pubkeyHex)
  }
  async myProfile() { return this.profile(this.#ctx.activePublicKeyHex) }
  async profileSet(profile: Record<string, unknown>, opts: { confirm?: boolean; relays?: string[] } = {}) {
    return handleSocialProfileSet(this.#ctx, this.#pool, { profile, confirm: opts.confirm ?? false, relays: opts.relays })
  }
  async contacts(pubkeyHex: string) {
    return handleContactsGet(this.#pool, this.#ctx.activeNpub, pubkeyHex)
  }
  async myContacts() { return this.contacts(this.#ctx.activePublicKeyHex) }
  async follow(pubkeyHex: string, opts: { relay?: string; petname?: string; relays?: string[] } = {}) {
    return handleContactsFollow(this.#ctx, this.#pool, { pubkeyHex, ...opts })
  }
  async unfollow(pubkeyHex: string, opts: { relays?: string[] } = {}) {
    return handleContactsUnfollow(this.#ctx, this.#pool, { pubkeyHex, ...opts })
  }
  async dm(recipientPubkeyHex: string, message: string, opts: { nip04?: boolean; relays?: string[] } = {}) {
    return handleDmSend(this.#ctx, this.#pool, {
      recipientPubkeyHex, message,
      nip04: opts.nip04 ?? false,
      nip04Enabled: this.#nip04Enabled,
      relays: opts.relays,
    })
  }
  async dmRead() { return handleDmRead(this.#ctx, this.#pool) }
  async feed(opts: { limit?: number } = {}) {
    return handleFeed(this.#ctx, this.#pool, { limit: opts.limit ?? 20 })
  }
  async notifications(opts: { limit?: number } = {}) {
    return handleNotifications(this.#ctx, this.#pool, { limit: opts.limit ?? 50 })
  }
  async nipPublish(identifier: string, title: string, content: string, opts: { kinds?: number[]; relays?: string[] } = {}) {
    return handleNipPublish(this.#ctx, this.#pool, { identifier, title, content, ...opts })
  }
  async nipRead(opts: { author?: string; identifier?: string; kind?: number } = {}) {
    return handleNipRead(this.#pool, this.#ctx.activeNpub, opts)
  }

  // ── Trust ───────────────────────────────────────────────────────────────────
  async attest(assertionId: string, opts: { type?: string; summary?: string; subject?: string; assertionRelay?: string; relays?: string[] } = {}) {
    return handleTrustAttest(this.#ctx, this.#pool, { assertionId, ...opts })
  }
  async claim(type: string, opts: { subject?: string; identifier?: string; summary?: string; assertionAddress?: string; assertionRelay?: string; relays?: string[] } = {}) {
    return handleTrustAttest(this.#ctx, this.#pool, { type, ...opts })
  }
  async trustRead(opts: { subject?: string; type?: string; attestor?: string } = {}) {
    return handleTrustRead(this.#pool, this.#ctx.activeNpub, opts)
  }
  trustVerify(event: NostrEvent) { return handleTrustVerify(event) }
  async trustRevoke(type: string, identifier: string) {
    return handleTrustRevoke(this.#ctx, this.#pool, { type, identifier })
  }
  async trustRequest(recipientPubkeyHex: string, subject: string, attestationType: string) {
    return handleTrustRequest(this.#ctx, this.#pool, { recipientPubkeyHex, subject, attestationType })
  }
  async trustRequestList() { return handleTrustRequestList(this.#ctx, this.#pool) }
  async ringProve(attestationType: string, ring: string[], opts: { relays?: string[] } = {}) {
    return handleTrustRingProve(this.#ctx, this.#pool, { attestationType, ring, ...opts })
  }
  ringVerify(event: NostrEvent) { return handleTrustRingVerify(event) }
  spokenChallenge(secret: string, context: string, counter: number) {
    return handleTrustSpokenChallenge({ secret, context, counter })
  }
  spokenVerify(secret: string, context: string, counter: number, input: string) {
    return handleTrustSpokenVerify({ secret, context, counter, input })
  }

  // ── Relay ───────────────────────────────────────────────────────────────────
  async relayList(opts: { compare?: string } = {}) {
    return handleRelayList(this.#ctx, this.#pool, opts.compare)
  }
  async relaySet(relays: Array<{ url: string; read?: boolean; write?: boolean }>, opts: { confirm?: boolean } = {}) {
    return handleRelaySet(this.#ctx, this.#pool, { relays, confirm: opts.confirm ?? false })
  }
  async relayInfo(url: string) { return handleRelayInfo(url) }
  async req(filter: Partial<Filter>) {
    return handleRelayQuery(this.#pool, this.#ctx.activeNpub, filter as Filter)
  }

  // ── Zap ─────────────────────────────────────────────────────────────────────
  #nwc() { return resolveNwcUri(this.#ctx, this.#walletsFile, this.#nwcUri) }
  async zapSend(bolt11: string) { return handleZapSend(this.#ctx, this.#pool, { invoice: bolt11, nwcUri: this.#nwc() }) }
  async zapBalance() { return handleZapBalance(this.#ctx, this.#pool, { nwcUri: this.#nwc() }) }
  async zapInvoice(amountMsats: number, description?: string) {
    return handleZapMakeInvoice(this.#ctx, this.#pool, { amountMsats, description, nwcUri: this.#nwc() })
  }
  async zapLookup(paymentHash: string) {
    return handleZapLookupInvoice(this.#ctx, this.#pool, { paymentHash, nwcUri: this.#nwc() })
  }
  async zapTransactions(opts: { limit?: number } = {}) {
    return handleZapListTransactions(this.#ctx, this.#pool, { limit: opts.limit ?? 10, nwcUri: this.#nwc() })
  }
  async zapReceipts(opts: { limit?: number } = {}) {
    return handleZapReceipts(this.#ctx, this.#pool, { limit: opts.limit ?? 20 })
  }
  zapDecode(bolt11: string) { return handleZapDecode(bolt11) }

  // ── Safety ──────────────────────────────────────────────────────────────────
  async safetyConfigure(personaName?: string) { return handleDuressConfigure(this.#ctx, this.#pool, { personaName }) }
  async safetyActivate(personaName?: string) { return handleDuressActivate(this.#ctx, { personaName }) }

  // ── Event ───────────────────────────────────────────────────────────────────
  async event(kind: number, opts: { content?: string; tags?: string[][]; relays?: string[] } = {}) {
    return handlePublishEvent(this.#ctx, this.#pool, {
      kind,
      content: opts.content ?? '',
      tags: opts.tags ?? [],
      relays: opts.relays,
    })
  }
  async publishRaw(event: Record<string, unknown>, opts: { noSign?: boolean; relays?: string[] } = {}) {
    return handlePublishRaw(this.#ctx, this.#pool, {
      event: event as any,
      noSign: opts.noSign ?? false,
      relays: opts.relays,
    })
  }

  // ── Utility ─────────────────────────────────────────────────────────────────
  decode(input: string) { return handleDecode(input) }
  encodeNpub(hex: string) { return handleEncodeNpub(hex) }
  encodeNote(hex: string) { return handleEncodeNote(hex) }
  encodeNprofile(pubkey: string, relays?: string[]) { return handleEncodeNprofile(pubkey, relays) }
  encodeNevent(id: string, relays?: string[], author?: string) { return handleEncodeNevent(id, relays, author) }
  encodeNsec(hex: string) { return handleEncodeNsec(hex) }
  keyPublic(secret: string) { return handleKeyPublic(secret) }
  keyEncrypt(secret: string, password: string) { return handleKeyEncrypt(secret, password) }
  keyDecrypt(ncryptsec: string, password: string) { return handleKeyDecrypt(ncryptsec, password) }
  verify(event: NostrEvent) { return handleVerify(event) }
  encrypt(recipientPubkeyHex: string, plaintext: string) {
    const skHex = Buffer.from(this.#ctx.activePrivateKey).toString('hex')
    return handleEncrypt(skHex, recipientPubkeyHex, plaintext)
  }
  decrypt(senderPubkeyHex: string, ciphertext: string) {
    const skHex = Buffer.from(this.#ctx.activePrivateKey).toString('hex')
    return handleDecrypt(skHex, senderPubkeyHex, ciphertext)
  }
  async count(filter: Partial<Filter>) { return handleCount(this.#pool, this.#ctx.activeNpub, filter as any) }
  async fetch(nip19: string) { return handleFetch(this.#pool, this.#ctx.activeNpub, nip19) }
  filter(event: NostrEvent, filter: Filter) { return handleFilter(event, filter) }
  async nipList() { return handleNipList() }
  async nipShow(number: number) { return handleNipShow(number) }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  destroy() {
    this.#ctx.destroy()
    this.#pool.close()
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a BrayClient from explicit config.
 * Async because bunker init (NIP-46 handshake) may be required.
 */
export async function createBray(config: BrayClientConfig): Promise<BrayClient> {
  const relays = config.relays ?? []
  const pool = new RelayPool({
    torProxy: config.torProxy,
    allowClearnet: config.allowClearnetWithTor || !config.torProxy,
    defaultRelays: relays,
    allowPrivateRelays: config.allowPrivateRelays,
  })

  let ctx: IdentityContext
  if (config.bunkerUri) {
    const { BunkerContext } = await import('./bunker-context.js')
    ctx = await BunkerContext.connect(config.bunkerUri) as unknown as IdentityContext
    await (ctx as any).resolvePublicKey()
  } else {
    if (!config.sec) throw new Error('createBray: provide sec (nsec/hex/mnemonic) or bunkerUri')
    const format = detectKeyFormat(config.sec)
    ctx = new IdentityContext(config.sec, format)
  }

  return new BrayClientImpl(
    ctx,
    pool,
    config.walletsFile ?? '',
    config.nwcUri,
    config.nip04Enabled ?? false,
  )
}

// ─── Default (env-based) singleton ────────────────────────────────────────────

let _default: Promise<BrayClient> | null = null

/**
 * Get or create a singleton BrayClient built from environment variables.
 * Reads NOSTR_SECRET_KEY / BUNKER_URI / NOSTR_RELAYS / NWC_URI etc.
 */
export function defaultBray(): Promise<BrayClient> {
  if (!_default) {
    _default = (async (): Promise<BrayClient> => {
      const config = await loadConfig()
      const pool = new RelayPool({
        torProxy: config.torProxy,
        allowClearnet: config.allowClearnetWithTor || !config.torProxy,
        defaultRelays: config.relays,
        allowPrivateRelays: config.allowPrivateRelays,
      })
      const nip65 = new Nip65Manager(pool, config.relays)

      let ctx: IdentityContext
      if (config.bunkerUri) {
        const { BunkerContext } = await import('./bunker-context.js')
        const { HeartwoodContext } = await import('./heartwood-context.js')
        ctx = await BunkerContext.connect(config.bunkerUri) as unknown as IdentityContext
        await (ctx as any).resolvePublicKey()
        const hw = await HeartwoodContext.probe(ctx as any)
        if (hw) ctx = hw as unknown as IdentityContext
      } else {
        ctx = new IdentityContext(config.secretKey, config.secretFormat)
      }

      // Pre-fetch NIP-65 relay list
      const masterRelays = await nip65.loadForIdentity(ctx.activeNpub)
      pool.reconfigure(ctx.activeNpub, masterRelays)

      return new BrayClientImpl(
        ctx,
        pool,
        config.walletsFile,
        config.nwcUri,
        config.nip04Enabled,
      )
    })()
  }
  return _default!
}
