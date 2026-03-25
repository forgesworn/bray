/**
 * Filter validation tests — catches the npub-in-filter bug.
 *
 * Every handler that queries relays with the active identity's pubkey
 * must use hex (activePublicKeyHex), NOT bech32 npub (activeNpub).
 * These tests use a validating mock pool that rejects bech32 in filters.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { IdentityContext } from '../src/context.js'
import { createValidatingMockPool } from './helpers/mock-pool.js'

import { handleSocialPost, handleSocialProfileSet, handleContactsFollow, handleContactsUnfollow } from '../src/social/handlers.js'
import { handleDmRead } from '../src/social/dm.js'
import { handleNotifications, handleFeed } from '../src/social/notifications.js'
import { handleZapReceipts } from '../src/zap/handlers.js'
import { handleRelaySet } from '../src/relay/handlers.js'
import { handleIdentityBackup } from '../src/identity/migration.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('filter validation — no bech32 in relay queries', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('notifications uses hex in #p filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleNotifications(ctx, pool as any)).resolves.toBeDefined()
  })

  it('feed uses valid filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleFeed(ctx, pool as any, {})).resolves.toBeDefined()
  })

  it('dm-read uses hex in #p filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleDmRead(ctx, pool as any)).resolves.toBeDefined()
  })

  it('zap-receipts uses hex in #p filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleZapReceipts(ctx, pool as any)).resolves.toBeDefined()
  })

  it('profile-set uses hex in authors filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleSocialProfileSet(ctx, pool as any, {
      profile: { name: 'Test' },
    })).resolves.toBeDefined()
  })

  it('contacts-follow uses hex in authors filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleContactsFollow(ctx, pool as any, {
      pubkeyHex: 'a'.repeat(64),
    })).resolves.toBeDefined()
  })

  it('contacts-unfollow uses hex in authors filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleContactsUnfollow(ctx, pool as any, {
      pubkeyHex: 'a'.repeat(64),
    })).resolves.toBeDefined()
  })

  it('relay-set uses hex in authors filter', async () => {
    const pool = createValidatingMockPool()
    await expect(handleRelaySet(ctx, pool as any, {
      relays: [{ url: 'wss://test.com' }],
      confirm: true,
    })).resolves.toBeDefined()
  })

  it('identity-backup uses hex in authors filter', async () => {
    const pool = createValidatingMockPool()
    // This takes a hex pubkey directly, should be fine
    await expect(handleIdentityBackup(pool as any, 'a'.repeat(64), ctx.activeNpub)).resolves.toBeDefined()
  })

  it('post publishes successfully (no filter issue)', async () => {
    const pool = createValidatingMockPool()
    const result = await handleSocialPost(ctx, pool as any, { content: 'test' })
    expect(result.event.kind).toBe(1)
  })
})
