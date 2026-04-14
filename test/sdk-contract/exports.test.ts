/**
 * Public-API contract tests (Item 14).
 *
 * All imports use the package specifier 'nostr-bray' (or subpaths).
 * Never import from '../src/...' or relative paths.
 *
 * Purpose: any breaking change to the exported surface trips these tests.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'

// ── Root barrel ───────────────────────────────────────────────────────────────
import {
  // SDK factory
  createBray,
  defaultBray,
  // Infrastructure
  loadConfig,
  detectKeyFormat,
  IdentityContext,
  RelayPool,
  Nip65Manager,
  // Shared util guard
  hasExtendedIdentity,
  // Stable handlers (spot-check one per category)
  handleIdentityCreate,
  handleSocialPost,
  handleTrustAttest,
  handleRelayList,
  handleZapSend,
  handleDuressConfigure,
  handlePublishRaw,
  handleDecode,
  handleVerify,
} from 'nostr-bray'

// ── Subpath: ./sdk ────────────────────────────────────────────────────────────
import { createBray as createBraySdk, defaultBray as defaultBraySdk } from 'nostr-bray/sdk'

// ── Subpath: ./identity ───────────────────────────────────────────────────────
import { handleIdentityCreate as idCreate, handleIdentityList } from 'nostr-bray/identity'

// ── Subpath: ./social ─────────────────────────────────────────────────────────
import { handleSocialPost as socialPost, handleDmSend } from 'nostr-bray/social'

// ── Subpath: ./trust ──────────────────────────────────────────────────────────
import { handleTrustAttest as trustAttest, handleTrustVerify } from 'nostr-bray/trust'

// ── Subpath: ./relay ──────────────────────────────────────────────────────────
import { handleRelayList as relayList, handleRelayInfo } from 'nostr-bray/relay'

// ── Subpath: ./zap ────────────────────────────────────────────────────────────
import { handleZapSend as zapSend, handleZapDecode } from 'nostr-bray/zap'

// ── Subpath: ./safety ─────────────────────────────────────────────────────────
import { handleDuressConfigure as safetyConf } from 'nostr-bray/safety'

// ── Subpath: ./event ──────────────────────────────────────────────────────────
import { handlePublishRaw as publishRaw } from 'nostr-bray/event'

// ── Subpath: ./util ───────────────────────────────────────────────────────────
import { handleDecode as utilDecode, handleVerify as utilVerify, handleEncodeNpub } from 'nostr-bray/util'

// ── Subpath: ./workflow ───────────────────────────────────────────────────────
import { handleTrustScore, handleFeedDiscover } from 'nostr-bray/workflow'

// ── Subpath: ./dispatch ───────────────────────────────────────────────────────
import { handleDispatchSend, handleDispatchCheck } from 'nostr-bray/dispatch'

// ── Subpath: ./marketplace ────────────────────────────────────────────────────
import { handleMarketplaceDiscover, parseAnnounceEvent } from 'nostr-bray/marketplace'

// ── Subpath: ./privacy ────────────────────────────────────────────────────────
import { handlePrivacyCommit } from 'nostr-bray/privacy'

// ── Subpath: ./moderation ─────────────────────────────────────────────────────
import { handleLabelCreate } from 'nostr-bray/moderation'

// ── Subpath: ./signet ─────────────────────────────────────────────────────────
import { handleSignetVerifiers } from 'nostr-bray/signet'

// ── Subpath: ./vault ──────────────────────────────────────────────────────────
import { handleVaultCreate } from 'nostr-bray/vault'

// ── Subpath: ./handler ────────────────────────────────────────────────────────
import { handleHandlerPublish } from 'nostr-bray/handler'

// ── Subpath: ./musig2 ─────────────────────────────────────────────────────────
import {
  handleMusig2Key,
  handleMusig2Nonce,
  handleMusig2PartialSign,
  handleMusig2Aggregate,
} from 'nostr-bray/musig2'

// ── Subpath: ./sync ───────────────────────────────────────────────────────────
import { handleSyncPull, handleSyncPush } from 'nostr-bray/sync'

// ── Subpath: ./admin ──────────────────────────────────────────────────────────
import { handleAdminCall } from 'nostr-bray/admin'

// ── Subpath: ./relay (curl) ───────────────────────────────────────────────────
import { handleRelayCurl } from 'nostr-bray/relay'

// ── Type-only imports (erased at runtime; presence locks the type surface) ────
import type { BrayClient, BrayClientConfig } from 'nostr-bray'
import type {
  PublicIdentity,
  IdentitySnapshot,
  SignFn,
  RelaySet,
  PublishResult,
  BrayConfig,
  SigningContext,
} from 'nostr-bray'
import type {
  PostResult,
  DmReadEntry,
  ZapReceipt,
  AttestResult,
  RelayHealthEntry,
  PublishRawResult,
  DecodeResult,
} from 'nostr-bray/types'
import type { BrayClient as SdkBrayClient } from 'nostr-bray/sdk'

// ─── Test fixture ─────────────────────────────────────────────────────────────

// Smallest valid secp256k1 private key — never touches a live relay in these tests.
const FIXTURE_HEX_KEY = '0000000000000000000000000000000000000000000000000000000000000001'

// ─── Root barrel exports ──────────────────────────────────────────────────────

describe('nostr-bray root barrel', () => {
  it('exports createBray as an async function', () => {
    expect(typeof createBray).toBe('function')
  })

  it('exports defaultBray as a function', () => {
    expect(typeof defaultBray).toBe('function')
  })

  it('exports loadConfig as a function', () => {
    expect(typeof loadConfig).toBe('function')
  })

  it('exports detectKeyFormat as a function', () => {
    expect(typeof detectKeyFormat).toBe('function')
  })

  it('exports IdentityContext as a class', () => {
    expect(typeof IdentityContext).toBe('function')
  })

  it('exports RelayPool as a class', () => {
    expect(typeof RelayPool).toBe('function')
  })

  it('exports Nip65Manager as a class', () => {
    expect(typeof Nip65Manager).toBe('function')
  })

  it('exports hasExtendedIdentity as a function', () => {
    expect(typeof hasExtendedIdentity).toBe('function')
  })

  it('exports handleIdentityCreate as a function', () => {
    expect(typeof handleIdentityCreate).toBe('function')
  })

  it('exports handleSocialPost as a function', () => {
    expect(typeof handleSocialPost).toBe('function')
  })

  it('exports handleTrustAttest as a function', () => {
    expect(typeof handleTrustAttest).toBe('function')
  })

  it('exports handleRelayList as a function', () => {
    expect(typeof handleRelayList).toBe('function')
  })

  it('exports handleZapSend as a function', () => {
    expect(typeof handleZapSend).toBe('function')
  })

  it('exports handleDuressConfigure as a function', () => {
    expect(typeof handleDuressConfigure).toBe('function')
  })

  it('exports handlePublishRaw as a function', () => {
    expect(typeof handlePublishRaw).toBe('function')
  })

  it('exports handleDecode as a function', () => {
    expect(typeof handleDecode).toBe('function')
  })

  it('exports handleVerify as a function', () => {
    expect(typeof handleVerify).toBe('function')
  })
})

// ─── Subpath re-exports agree with root barrel ────────────────────────────────

describe('nostr-bray/sdk subpath', () => {
  it('re-exports createBray', () => {
    expect(createBraySdk).toBe(createBray)
  })

  it('re-exports defaultBray', () => {
    expect(defaultBraySdk).toBe(defaultBray)
  })
})

describe('nostr-bray/identity subpath', () => {
  it('re-exports handleIdentityCreate', () => {
    expect(idCreate).toBe(handleIdentityCreate)
  })

  it('exports handleIdentityList as a function', () => {
    expect(typeof handleIdentityList).toBe('function')
  })
})

describe('nostr-bray/social subpath', () => {
  it('re-exports handleSocialPost', () => {
    expect(socialPost).toBe(handleSocialPost)
  })

  it('exports handleDmSend as a function', () => {
    expect(typeof handleDmSend).toBe('function')
  })
})

describe('nostr-bray/trust subpath', () => {
  it('re-exports handleTrustAttest', () => {
    expect(trustAttest).toBe(handleTrustAttest)
  })

  it('exports handleTrustVerify as a function', () => {
    expect(typeof handleTrustVerify).toBe('function')
  })
})

describe('nostr-bray/relay subpath', () => {
  it('re-exports handleRelayList', () => {
    expect(relayList).toBe(handleRelayList)
  })

  it('exports handleRelayInfo as a function', () => {
    expect(typeof handleRelayInfo).toBe('function')
  })
})

describe('nostr-bray/zap subpath', () => {
  it('re-exports handleZapSend', () => {
    expect(zapSend).toBe(handleZapSend)
  })

  it('exports handleZapDecode as a function', () => {
    expect(typeof handleZapDecode).toBe('function')
  })
})

describe('nostr-bray/safety subpath', () => {
  it('exports handleDuressConfigure as a function', () => {
    expect(safetyConf).toBe(handleDuressConfigure)
  })
})

describe('nostr-bray/event subpath', () => {
  it('exports handlePublishRaw as a function', () => {
    expect(publishRaw).toBe(handlePublishRaw)
  })
})

describe('nostr-bray/util subpath', () => {
  it('re-exports handleDecode', () => {
    expect(utilDecode).toBe(handleDecode)
  })

  it('re-exports handleVerify', () => {
    expect(utilVerify).toBe(handleVerify)
  })

  it('exports handleEncodeNpub as a function', () => {
    expect(typeof handleEncodeNpub).toBe('function')
  })
})

describe('nostr-bray/workflow subpath', () => {
  it('exports handleTrustScore as a function', () => {
    expect(typeof handleTrustScore).toBe('function')
  })

  it('exports handleFeedDiscover as a function', () => {
    expect(typeof handleFeedDiscover).toBe('function')
  })
})

describe('nostr-bray/dispatch subpath', () => {
  it('exports handleDispatchSend as a function', () => {
    expect(typeof handleDispatchSend).toBe('function')
  })

  it('exports handleDispatchCheck as a function', () => {
    expect(typeof handleDispatchCheck).toBe('function')
  })
})

describe('nostr-bray/marketplace subpath', () => {
  it('exports handleMarketplaceDiscover as a function', () => {
    expect(typeof handleMarketplaceDiscover).toBe('function')
  })

  it('exports parseAnnounceEvent as a function', () => {
    expect(typeof parseAnnounceEvent).toBe('function')
  })
})

describe('nostr-bray/privacy subpath', () => {
  it('exports handlePrivacyCommit as a function', () => {
    expect(typeof handlePrivacyCommit).toBe('function')
  })
})

describe('nostr-bray/moderation subpath', () => {
  it('exports handleLabelCreate as a function', () => {
    expect(typeof handleLabelCreate).toBe('function')
  })
})

describe('nostr-bray/signet subpath', () => {
  it('exports handleSignetVerifiers as a function', () => {
    expect(typeof handleSignetVerifiers).toBe('function')
  })
})

describe('nostr-bray/vault subpath', () => {
  it('exports handleVaultCreate as a function', () => {
    expect(typeof handleVaultCreate).toBe('function')
  })
})

describe('nostr-bray/handler subpath', () => {
  it('exports handleHandlerPublish as a function', () => {
    expect(typeof handleHandlerPublish).toBe('function')
  })
})

describe('nostr-bray/musig2 subpath', () => {
  it('exports handleMusig2Key as a function', () => {
    expect(typeof handleMusig2Key).toBe('function')
  })

  it('exports handleMusig2Nonce as a function', () => {
    expect(typeof handleMusig2Nonce).toBe('function')
  })

  it('exports handleMusig2PartialSign as a function', () => {
    expect(typeof handleMusig2PartialSign).toBe('function')
  })

  it('exports handleMusig2Aggregate as a function', () => {
    expect(typeof handleMusig2Aggregate).toBe('function')
  })
})

describe('nostr-bray/sync subpath', () => {
  it('exports handleSyncPull as a function', () => {
    expect(typeof handleSyncPull).toBe('function')
  })

  it('exports handleSyncPush as a function', () => {
    expect(typeof handleSyncPush).toBe('function')
  })
})

describe('nostr-bray/admin subpath', () => {
  it('exports handleAdminCall as a function', () => {
    expect(typeof handleAdminCall).toBe('function')
  })
})

describe('nostr-bray/relay subpath (curl)', () => {
  it('exports handleRelayCurl as a function', () => {
    expect(typeof handleRelayCurl).toBe('function')
  })
})

describe('musig2 2-of-2 flow', () => {
  it('runs a complete 2-party signing round without errors', () => {
    const alice = handleMusig2Key()
    const bob = handleMusig2Key()
    expect(alice.pubKey).toMatch(/^[0-9a-f]{64}$/)
    expect(alice.secKey).toMatch(/^[0-9a-f]{64}$/)

    const aliceNonce = handleMusig2Nonce(alice.secKey)
    const bobNonce = handleMusig2Nonce(bob.secKey)
    expect(aliceNonce.pubNonce).toMatch(/^[0-9a-f]{132}$/)
    expect(aliceNonce.secNonce).toMatch(/^[0-9a-f]{194}$/)

    const msg = '0101010101010101010101010101010101010101010101010101010101010101'
    const pubKeys = [alice.pubKey, bob.pubKey]
    const pubNonces = [aliceNonce.pubNonce, bobNonce.pubNonce]

    const alicePSig = handleMusig2PartialSign(alice.secKey, aliceNonce.secNonce, pubNonces, pubKeys, msg)
    const bobPSig = handleMusig2PartialSign(bob.secKey, bobNonce.secNonce, pubNonces, pubKeys, msg)
    expect(alicePSig.partialSig).toMatch(/^[0-9a-f]{64}$/)

    const { sig } = handleMusig2Aggregate([alicePSig.partialSig, bobPSig.partialSig], pubNonces, pubKeys, msg)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
  })
})

// ─── BrayClient instance shape ────────────────────────────────────────────────

describe('createBray instance shape', () => {
  let client: BrayClient

  it('constructs from a hex private key with no relays', async () => {
    client = await createBray({ sec: FIXTURE_HEX_KEY, relays: [] })
    expect(client).toBeDefined()
  })

  it('exposes npub as a string', () => {
    expect(typeof client.npub).toBe('string')
    expect(client.npub).toMatch(/^npub1/)
  })

  it('exposes hexPubkey as a 64-char hex string', () => {
    expect(typeof client.hexPubkey).toBe('string')
    expect(client.hexPubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('exposes relays with read/write arrays', () => {
    expect(Array.isArray(client.relays.read)).toBe(true)
    expect(Array.isArray(client.relays.write)).toBe(true)
  })

  // Stable identity methods
  it('has create() method', () => { expect(typeof client.create).toBe('function') })
  it('has list() method', () => { expect(typeof client.list).toBe('function') })
  it('has derive() method', () => { expect(typeof client.derive).toBe('function') })
  it('has persona() method', () => { expect(typeof client.persona).toBe('function') })
  it('has switch() method', () => { expect(typeof client.switch).toBe('function') })
  it('has prove() method', () => { expect(typeof client.prove).toBe('function') })
  it('has backup() method', () => { expect(typeof client.backup).toBe('function') })
  it('has restore() method', () => { expect(typeof client.restore).toBe('function') })

  // Social
  it('has post() method', () => { expect(typeof client.post).toBe('function') })
  it('has reply() method', () => { expect(typeof client.reply).toBe('function') })
  it('has react() method', () => { expect(typeof client.react).toBe('function') })
  it('has like() method', () => { expect(typeof client.like).toBe('function') })
  it('has dm() method', () => { expect(typeof client.dm).toBe('function') })
  it('has dmRead() method', () => { expect(typeof client.dmRead).toBe('function') })
  it('has myProfile() method', () => { expect(typeof client.myProfile).toBe('function') })
  it('has myContacts() method', () => { expect(typeof client.myContacts).toBe('function') })
  it('has follow() method', () => { expect(typeof client.follow).toBe('function') })
  it('has unfollow() method', () => { expect(typeof client.unfollow).toBe('function') })

  // Trust
  it('has attest() method', () => { expect(typeof client.attest).toBe('function') })
  it('has trustVerify() method', () => { expect(typeof client.trustVerify).toBe('function') })
  it('has ringVerify() method', () => { expect(typeof client.ringVerify).toBe('function') })
  it('has spokenChallenge() method', () => { expect(typeof client.spokenChallenge).toBe('function') })
  it('has spokenVerify() method', () => { expect(typeof client.spokenVerify).toBe('function') })

  // Relay
  it('has relayList() method', () => { expect(typeof client.relayList).toBe('function') })
  it('has relaySet() method', () => { expect(typeof client.relaySet).toBe('function') })
  it('has relayInfo() method', () => { expect(typeof client.relayInfo).toBe('function') })
  it('has req() method', () => { expect(typeof client.req).toBe('function') })

  // Zap
  it('has zapSend() method', () => { expect(typeof client.zapSend).toBe('function') })
  it('has zapBalance() method', () => { expect(typeof client.zapBalance).toBe('function') })
  it('has zapDecode() method', () => { expect(typeof client.zapDecode).toBe('function') })

  // Event + util
  it('has event() method', () => { expect(typeof client.event).toBe('function') })
  it('has publishRaw() method', () => { expect(typeof client.publishRaw).toBe('function') })
  it('has decode() method', () => { expect(typeof client.decode).toBe('function') })
  it('has encodeNpub() method', () => { expect(typeof client.encodeNpub).toBe('function') })
  it('has verify() method', () => { expect(typeof client.verify).toBe('function') })
  it('has encrypt() method', () => { expect(typeof client.encrypt).toBe('function') })
  it('has decrypt() method', () => { expect(typeof client.decrypt).toBe('function') })
  it('has keyPublic() method', () => { expect(typeof client.keyPublic).toBe('function') })
  it('has keyEncrypt() method', () => { expect(typeof client.keyEncrypt).toBe('function') })
  it('has keyDecrypt() method', () => { expect(typeof client.keyDecrypt).toBe('function') })
  it('has nipList() method', () => { expect(typeof client.nipList).toBe('function') })
  it('has nipShow() method', () => { expect(typeof client.nipShow).toBe('function') })
  it('has filter() method', () => { expect(typeof client.filter).toBe('function') })

  // Safety + lifecycle
  it('has safetyConfigure() method', () => { expect(typeof client.safetyConfigure).toBe('function') })
  it('has safetyActivate() method', () => { expect(typeof client.safetyActivate).toBe('function') })
  it('has destroy() method', () => { expect(typeof client.destroy).toBe('function') })

  afterAll(() => { client?.destroy() })
})

// ─── Pure utility smoke (no relay needed) ─────────────────────────────────────

describe('pure util via BrayClient', () => {
  let client: BrayClient

  beforeAll(async () => {
    client = await createBray({ sec: FIXTURE_HEX_KEY, relays: [] })
  })

  afterAll(() => { client?.destroy() })

  it('keyPublic returns a pubkeyHex and npub for the fixture key', () => {
    const result = client.keyPublic(FIXTURE_HEX_KEY)
    expect(result).toHaveProperty('pubkeyHex')
    expect(result).toHaveProperty('npub')
    expect(result.npub).toMatch(/^npub1/)
  })

  it('encodeNpub round-trips through keyPublic', () => {
    const { pubkeyHex, npub } = client.keyPublic(FIXTURE_HEX_KEY)
    expect(client.encodeNpub(pubkeyHex)).toBe(npub)
  })

  it('decode round-trips the active npub', () => {
    const npub = client.npub
    const decoded = client.decode(npub) as { type: string; data: string }
    expect(decoded.type).toBe('npub')
    expect(decoded.data).toBe(client.hexPubkey)
  })

  it('create() returns an npub and mnemonic', () => {
    const fresh = client.create()
    expect(fresh.npub).toMatch(/^npub1/)
    expect(typeof fresh.mnemonic).toBe('string')
    expect(fresh.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
  })
})
