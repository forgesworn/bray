import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { getCurrentEpochId } from 'dominion-protocol'
import {
  handleVaultCreate,
  handleVaultEncrypt,
  handleVaultShare,
  handleVaultRead,
  handleVaultRevoke,
  handleVaultMembers,
  handleVaultConfig,
  handleVaultRotate,
} from '../../src/vault/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const BOB = '68680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5' // valid secp256k1 pubkey

function mockPool(queryEvents: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(queryEvents),
    publish: vi.fn().mockResolvedValue({
      success: true,
      allAccepted: true,
      accepted: ['wss://relay.test'],
      rejected: [],
      errors: [],
    }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

function mockTrust() {
  return {
    mode: 'annotate' as const,
    assess: vi.fn().mockResolvedValue({
      pubkey: BOB,
      npub: 'npub1' + 'b'.repeat(58),
      verification: { tier: null, score: 0, credentials: 0, expired: false },
      proximity: { distance: -1, wotScore: 0, endorsements: 0, ringEndorsements: 0, mutualFollows: false },
      access: { vaultTiers: [], theirVaultTiers: [], canDecrypt: false, currentEpoch: '2026-W01', revoked: false },
      composite: { level: 'unknown', summary: 'No trust signals found', flags: [] },
    }),
    invalidate: vi.fn(),
  }
}

describe('vault handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // ─── handleVaultCreate ───────────────────────────────────────────────────────

  describe('handleVaultCreate', () => {
    it('creates kind 30078 event with d-tag dominion:vault-config', async () => {
      const pool = mockPool()
      const result = await handleVaultCreate(ctx, pool as any, { tiers: ['friends', 'family'] })
      expect(result.event.kind).toBe(30078)
      expect(result.event.sig).toBeDefined()
      const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag?.[1]).toBe('dominion:vault-config')
    })

    it('includes the requested tier names in the result', async () => {
      const pool = mockPool()
      const result = await handleVaultCreate(ctx, pool as any, { tiers: ['gold', 'silver'] })
      expect(result.tiers).toContain('gold')
      expect(result.tiers).toContain('silver')
    })

    it('publishes to pool and returns publish result', async () => {
      const pool = mockPool()
      const result = await handleVaultCreate(ctx, pool as any, { tiers: ['vip'] })
      expect(pool.publish).toHaveBeenCalledOnce()
      expect(result.publish.accepted).toContain('wss://relay.test')
    })

    it('works with zero custom tiers (uses defaultConfig tiers)', async () => {
      const pool = mockPool()
      const result = await handleVaultCreate(ctx, pool as any, { tiers: [] })
      expect(result.tiers.length).toBeGreaterThan(0) // defaultConfig provides family + connections
    })
  })

  // ─── handleVaultEncrypt ──────────────────────────────────────────────────────

  describe('handleVaultEncrypt', () => {
    it('returns ciphertext, tier, and epoch', async () => {
      const result = await handleVaultEncrypt(ctx, { content: 'hello', tier: 'friends' })
      expect(result.ciphertext).toBeDefined()
      expect(result.tier).toBe('friends')
      expect(result.epoch).toMatch(/^\d{4}-W\d{2}$/)
    })

    it('uses provided epoch when given', async () => {
      const result = await handleVaultEncrypt(ctx, { content: 'secret', tier: 'family', epoch: '2026-W01' })
      expect(result.epoch).toBe('2026-W01')
    })

    it('ciphertext is not the original plaintext', async () => {
      const result = await handleVaultEncrypt(ctx, { content: 'my secret', tier: 'gold' })
      expect(result.ciphertext).not.toBe('my secret')
    })
  })

  // ─── handleVaultRead ─────────────────────────────────────────────────────────

  describe('handleVaultRead', () => {
    it('decrypts content encrypted by handleVaultEncrypt (roundtrip)', async () => {
      const plaintext = 'sensitive vault data'
      const epoch = getCurrentEpochId()
      const tier = 'friends'

      const encrypted = await handleVaultEncrypt(ctx, { content: plaintext, tier, epoch })
      const decrypted = await handleVaultRead(ctx, { ciphertext: encrypted.ciphertext, tier, epoch })

      expect(decrypted.plaintext).toBe(plaintext)
      expect(decrypted.tier).toBe(tier)
      expect(decrypted.epoch).toBe(epoch)
    })

    it('roundtrip works with a specific past epoch', async () => {
      const plaintext = 'archive entry'
      const epoch = '2025-W01'
      const tier = 'family'

      const encrypted = await handleVaultEncrypt(ctx, { content: plaintext, tier, epoch })
      const decrypted = await handleVaultRead(ctx, { ciphertext: encrypted.ciphertext, tier, epoch })

      expect(decrypted.plaintext).toBe(plaintext)
    })

    it('throws when decrypting with wrong tier', async () => {
      const epoch = '2026-W01'
      const encrypted = await handleVaultEncrypt(ctx, { content: 'data', tier: 'friends', epoch })
      await expect(handleVaultRead(ctx, { ciphertext: encrypted.ciphertext, tier: 'family', epoch })).rejects.toThrow()
    })

    it('throws when decrypting with wrong epoch', async () => {
      const encrypted = await handleVaultEncrypt(ctx, { content: 'data', tier: 'friends', epoch: '2026-W01' })
      await expect(handleVaultRead(ctx, { ciphertext: encrypted.ciphertext, tier: 'friends', epoch: '2026-W02' })).rejects.toThrow()
    })
  })

  // ─── handleVaultShare ────────────────────────────────────────────────────────

  describe('handleVaultShare', () => {
    it('publishes one event per recipient', async () => {
      const pool = mockPool()
      const result = await handleVaultShare(ctx, pool as any, {
        tier: 'friends',
        recipients: [BOB],
      })
      expect(pool.publish).toHaveBeenCalledOnce()
      expect(result.published).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('handles multiple recipients', async () => {
      const pool = mockPool()
      const charlie = 'b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53fc599'
      const result = await handleVaultShare(ctx, pool as any, {
        tier: 'family',
        recipients: [BOB, charlie],
        epoch: '2026-W10',
      })
      expect(result.published).toBe(2)
    })

    it('returns npub-encoded recipients in result', async () => {
      const pool = mockPool()
      const result = await handleVaultShare(ctx, pool as any, {
        tier: 'vip',
        recipients: [BOB],
        epoch: '2026-W05',
      })
      expect(result.recipients.length).toBe(1)
      expect(result.recipients[0]).toMatch(/^npub1/)
    })

    it('counts failed publishes when pool rejects', async () => {
      const pool = mockPool()
      pool.publish.mockResolvedValue({ success: false, allAccepted: false, accepted: [], rejected: ['wss://relay.test'], errors: ['rejected'] })
      const result = await handleVaultShare(ctx, pool as any, {
        tier: 'friends',
        recipients: [BOB],
        epoch: '2026-W01',
      })
      expect(result.failed).toBe(1)
      expect(result.published).toBe(0)
    })
  })

  // ─── handleVaultRevoke ───────────────────────────────────────────────────────

  describe('handleVaultRevoke', () => {
    it('publishes updated config with pubkey revoked', async () => {
      const existingConfig = {
        tiers: { friends: [BOB], family: [] },
        individualGrants: [],
        revokedPubkeys: [],
      }
      const pool = mockPool([
        {
          id: '1'.padEnd(64, '1'),
          pubkey: ctx.activePublicKeyHex,
          created_at: Math.floor(Date.now() / 1000),
          kind: 30078,
          tags: [['d', 'dominion:vault-config']],
          content: JSON.stringify(existingConfig),
          sig: 'f'.padEnd(128, 'f'),
        },
      ])

      const result = await handleVaultRevoke(ctx, pool as any, { pubkey: BOB })
      expect(result.publish.accepted.length).toBeGreaterThan(0)

      // Inspect published event content — Bob should be in revokedPubkeys
      const publishedEvent = pool.publish.mock.calls[0]?.[1]
      const updatedConfig = JSON.parse(publishedEvent.content)
      expect(updatedConfig.revokedPubkeys).toContain(BOB)
    })

    it('works even when no existing config found (creates from default)', async () => {
      const pool = mockPool() // returns no events
      const result = await handleVaultRevoke(ctx, pool as any, { pubkey: BOB })
      expect(result.event.kind).toBe(30078)
      expect(result.revokedPubkey).toMatch(/^npub1/)
    })
  })

  // ─── handleVaultMembers ──────────────────────────────────────────────────────

  describe('handleVaultMembers', () => {
    it('returns empty members when no config found', async () => {
      const pool = mockPool()
      const trust = mockTrust()
      const result = await handleVaultMembers(pool as any, trust as any, ctx.activeNpub, {})
      expect(result.members).toEqual([])
      expect(result.total).toBe(0)
    })

    it('lists members from all tiers in the vault config', async () => {
      const charlie = 'b95c249d84f417e3e395a127425428b540671cc15881eb828c17b722a53fc599'
      const config = {
        tiers: { friends: [BOB], family: [charlie] },
        individualGrants: [],
        revokedPubkeys: [],
      }
      const pool = mockPool([
        {
          id: '2'.padEnd(64, '2'),
          pubkey: ctx.activePublicKeyHex,
          created_at: Math.floor(Date.now() / 1000),
          kind: 30078,
          tags: [['d', 'dominion:vault-config']],
          content: JSON.stringify(config),
          sig: 'f'.padEnd(128, 'f'),
        },
      ])
      const trust = mockTrust()
      const result = await handleVaultMembers(pool as any, trust as any, ctx.activeNpub, {})
      expect(result.total).toBe(2)
      const pubkeys = result.members.map(m => m.pubkey)
      expect(pubkeys).toContain(BOB)
      expect(pubkeys).toContain(charlie)
    })

    it('annotates members with tier name', async () => {
      const config = {
        tiers: { vip: [BOB] },
        individualGrants: [],
        revokedPubkeys: [],
      }
      const pool = mockPool([
        {
          id: '3'.padEnd(64, '3'),
          pubkey: ctx.activePublicKeyHex,
          created_at: Math.floor(Date.now() / 1000),
          kind: 30078,
          tags: [['d', 'dominion:vault-config']],
          content: JSON.stringify(config),
          sig: 'f'.padEnd(128, 'f'),
        },
      ])
      const trust = mockTrust()
      const result = await handleVaultMembers(pool as any, trust as any, ctx.activeNpub, {})
      expect(result.members[0]?.tier).toBe('vip')
    })
  })

  // ─── handleVaultConfig ───────────────────────────────────────────────────────

  describe('handleVaultConfig', () => {
    it('returns empty summary when no config found', async () => {
      const pool = mockPool()
      const result = await handleVaultConfig(pool as any, ctx.activeNpub, {})
      expect(result.tierNames).toEqual([])
      expect(result.revokedCount).toBe(0)
      expect(result.grantCount).toBe(0)
    })

    it('returns summary with tier counts', async () => {
      const config = {
        tiers: { gold: [BOB], silver: [] },
        individualGrants: [{ pubkey: BOB, label: 'test', grantedAt: 0 }],
        revokedPubkeys: ['d'.padEnd(64, 'd')],
      }
      const pool = mockPool([
        {
          id: '4'.padEnd(64, '4'),
          pubkey: ctx.activePublicKeyHex,
          created_at: Math.floor(Date.now() / 1000),
          kind: 30078,
          tags: [['d', 'dominion:vault-config']],
          content: JSON.stringify(config),
          sig: 'f'.padEnd(128, 'f'),
        },
      ])
      const result = await handleVaultConfig(pool as any, ctx.activeNpub, {})
      expect(result.tierNames).toContain('gold')
      expect(result.tierNames).toContain('silver')
      expect(result.tierCounts['gold']).toBe(1)
      expect(result.tierCounts['silver']).toBe(0)
      expect(result.revokedCount).toBe(1)
      expect(result.grantCount).toBe(1)
      expect(result.currentEpoch).toMatch(/^\d{4}-W\d{2}$/)
    })

    it('includes author npub in result', async () => {
      const pool = mockPool()
      const result = await handleVaultConfig(pool as any, ctx.activeNpub, {})
      expect(result.authorNpub).toMatch(/^npub1/)
    })
  })

  // ─── handleVaultRotate ───────────────────────────────────────────────────────

  describe('handleVaultRotate', () => {
    it('returns current epoch ID in ISO week format', () => {
      const result = handleVaultRotate()
      expect(result.currentEpoch).toMatch(/^\d{4}-W\d{2}$/)
    })

    it('includes an informational message', () => {
      const result = handleVaultRotate()
      expect(result.message).toBeDefined()
      expect(result.message.length).toBeGreaterThan(0)
    })

    it('epoch in message matches currentEpoch field', () => {
      const result = handleVaultRotate()
      expect(result.message).toContain(result.currentEpoch)
    })
  })
})
