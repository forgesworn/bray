import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleSignetBadge,
  handleSignetVouch,
  handleSignetCredentials,
  handleSignetPolicyCheck,
  handleSignetPolicySet,
  handleSignetVerifiers,
  handleSignetChallenge,
} from '../../src/signet/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

// Stable hex pubkeys for testing
const ALICE = 'a'.padEnd(64, 'a')
const BOB = 'b'.padEnd(64, 'b')

function mockPool(overrides: Record<string, any> = {}) {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryDirect: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
    reconfigure: vi.fn(),
    checkSharedRelays: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function mockTrust(overrides: Record<string, any> = {}) {
  return {
    assess: vi.fn().mockResolvedValue({
      pubkey: BOB,
      npub: 'npub1test',
      verification: { tier: null, score: 0, credentials: 0, expired: false },
      proximity: { distance: -1, wotScore: 0, endorsements: 0, ringEndorsements: 0, mutualFollows: false },
      access: { vaultTiers: [], theirVaultTiers: [], canDecrypt: false, currentEpoch: '2026-W13', revoked: false },
      composite: { level: 'unknown', summary: 'no trust signals', flags: [] },
    }),
    mode: 'annotate',
    ...overrides,
  }
}

function makeCredentialEvent(subject: string, tier: number, attestor: string): any {
  const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 365
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: attestor,
    created_at: Math.floor(Date.now() / 1000),
    kind: 31000,
    tags: [
      ['d', `credential:${subject}`],
      ['p', subject],
      ['type', 'credential'],
      ['tier', String(tier)],
      ['verification-type', tier >= 3 ? 'professional' : 'peer'],
      ['verification-scope', 'adult'],
      ['method', 'in-person'],
      ['expiration', String(futureExpiry)],
      ['L', 'signet'],
    ],
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

function makeVerifierEvent(verifierPubkey: string, profession: string, jurisdiction: string): any {
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: verifierPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 31000,
    tags: [
      ['d', `verifier:${verifierPubkey}`],
      ['type', 'verifier'],
      ['profession', profession],
      ['jurisdiction', jurisdiction],
      ['licence', 'abc123def456'],
      ['body', 'Law Society'],
      ['L', 'signet'],
    ],
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

function makePolicyEvent(operatorPubkey: string, communityId: string): any {
  return {
    id: Math.random().toString(36).padEnd(64, '0'),
    pubkey: operatorPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags: [
      ['d', `signet:policy:${communityId}`],
      ['adult-min-tier', '2'],
      ['child-min-tier', '3'],
      ['enforcement', 'client'],
      ['L', 'signet'],
    ],
    content: '',
    sig: 'f'.padEnd(128, 'f'),
  }
}

describe('signet handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  afterEach(() => {
    ctx.destroy()
  })

  // ─── handleSignetBadge ──────────────────────────────────────────────────────

  describe('handleSignetBadge', () => {
    it('returns tier, score, summary and composite from trust assessment', async () => {
      const trust = mockTrust({
        assess: vi.fn().mockResolvedValue({
          pubkey: BOB,
          npub: 'npub1test',
          verification: { tier: 3, score: 120, credentials: 1, expired: false },
          proximity: { distance: 1, wotScore: 50, endorsements: 2, ringEndorsements: 0, mutualFollows: true },
          access: { vaultTiers: ['bronze'], theirVaultTiers: [], canDecrypt: true, currentEpoch: '2026-W13', revoked: false },
          composite: { level: 'trusted', summary: 'Verified (tier 3) direct contact in vault (bronze)', flags: [] },
        }),
      })

      const result = await handleSignetBadge(trust, { pubkey: BOB })

      expect(result.pubkey).toBe(BOB)
      expect(result.npub).toMatch(/^npub1/)
      expect(result.tier).toBe(3)
      expect(result.score).toBe(120)
      expect(result.summary).toBe('Verified (tier 3) direct contact in vault (bronze)')
      expect(result.composite.level).toBe('trusted')
      expect(result.composite.flags).toEqual([])
    })

    it('returns null tier and zero score for unknown pubkey', async () => {
      const trust = mockTrust()

      const result = await handleSignetBadge(trust, { pubkey: BOB })

      expect(result.pubkey).toBe(BOB)
      expect(result.tier).toBeNull()
      expect(result.score).toBe(0)
      expect(result.composite.level).toBe('unknown')
    })
  })

  // ─── handleSignetVouch ──────────────────────────────────────────────────────

  describe('handleSignetVouch', () => {
    it('creates and publishes a vouch event', async () => {
      const pool = mockPool()

      const event = await handleSignetVouch(ctx, pool as any, { pubkey: BOB })

      expect(event).toBeDefined()
      expect(event.kind).toBe(31000)
      expect(pool.publish).toHaveBeenCalledOnce()
      // The event should reference the subject
      const pTag = event.tags.find((t: string[]) => t[0] === 'p' && t[1] === BOB)
      expect(pTag).toBeDefined()
    })

    it('defaults to in-person method when method is omitted', async () => {
      const pool = mockPool()

      const event = await handleSignetVouch(ctx, pool as any, { pubkey: BOB })

      const methodTag = event.tags.find((t: string[]) => t[0] === 'method')
      // method defaults to 'in-person'
      expect(methodTag?.[1]).toBe('in-person')
    })

    it('accepts online method and comment', async () => {
      const pool = mockPool()

      const event = await handleSignetVouch(ctx, pool as any, {
        pubkey: BOB,
        method: 'online',
        comment: 'Met via video call',
      })

      expect(event.kind).toBe(31000)
      expect(pool.publish).toHaveBeenCalledOnce()
    })
  })

  // ─── handleSignetCredentials ────────────────────────────────────────────────

  describe('handleSignetCredentials', () => {
    it('returns empty array when no credentials found', async () => {
      const pool = mockPool()

      const result = await handleSignetCredentials(pool as any, ctx.activeNpub, { pubkey: ALICE })

      expect(result).toEqual([])
    })

    it('returns parsed credentials with tier, method, expiry', async () => {
      const credential = makeCredentialEvent(ALICE, 2, BOB)
      const pool = mockPool({
        query: vi.fn().mockResolvedValue([credential]),
      })

      const result = await handleSignetCredentials(pool as any, ctx.activeNpub, { pubkey: ALICE })

      expect(result.length).toBe(1)
      expect(result[0].tier).toBe(2)
      expect(result[0].attestorPubkey).toBe(BOB)
      expect(result[0].expired).toBe(false)
    })

    it('marks expired credentials', async () => {
      const credential = makeCredentialEvent(ALICE, 2, BOB)
      // Override expiry to past
      const expiryTagIndex = credential.tags.findIndex((t: string[]) => t[0] === 'expiration')
      credential.tags[expiryTagIndex] = ['expiration', String(Math.floor(Date.now() / 1000) - 3600)]

      const pool = mockPool({
        query: vi.fn().mockResolvedValue([credential]),
      })

      const result = await handleSignetCredentials(pool as any, ctx.activeNpub, { pubkey: ALICE })

      expect(result.length).toBe(1)
      expect(result[0].expired).toBe(true)
    })
  })

  // ─── handleSignetPolicyCheck ────────────────────────────────────────────────

  describe('handleSignetPolicyCheck', () => {
    it('returns not-allowed when no policy exists for the community', async () => {
      const pool = mockPool()
      const trust = mockTrust()

      const result = await handleSignetPolicyCheck(pool as any, trust, ctx.activeNpub, {
        pubkey: ALICE,
        communityId: 'my-community',
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/No policy found/)
      expect(result.communityId).toBe('my-community')
    })

    it('returns compliance result against an existing policy', async () => {
      const policyEvent = makePolicyEvent(BOB, 'test-community')
      const pool = mockPool({
        query: vi.fn().mockResolvedValue([policyEvent]),
      })
      const trust = mockTrust({
        assess: vi.fn().mockResolvedValue({
          pubkey: ALICE,
          npub: 'npub1test',
          verification: { tier: 3, score: 100, credentials: 1, expired: false },
          proximity: { distance: 1, wotScore: 50, endorsements: 0, ringEndorsements: 0, mutualFollows: false },
          access: { vaultTiers: [], theirVaultTiers: [], canDecrypt: false, currentEpoch: '2026-W13', revoked: false },
          composite: { level: 'verified-stranger', summary: 'Signet-verified (tier 3)', flags: [] },
        }),
      })

      const result = await handleSignetPolicyCheck(pool as any, trust, ctx.activeNpub, {
        pubkey: ALICE,
        communityId: 'test-community',
      })

      expect(result.communityId).toBe('test-community')
      expect(result.pubkey).toBe(ALICE)
      expect(result.npub).toMatch(/^npub1/)
      expect(typeof result.allowed).toBe('boolean')
    })
  })

  // ─── handleSignetPolicySet ──────────────────────────────────────────────────

  describe('handleSignetPolicySet', () => {
    it('creates and publishes a policy event', async () => {
      const pool = mockPool()

      const event = await handleSignetPolicySet(ctx, pool as any, {
        communityId: 'my-forum',
        adultMinTier: 2,
        childMinTier: 3,
        enforcement: 'client',
        description: 'Adults must be vouched, children must be professionally verified',
      })

      expect(event).toBeDefined()
      expect(event.kind).toBe(30078)
      expect(pool.publish).toHaveBeenCalledOnce()
      // d-tag should encode the communityId
      const dTag = event.tags.find((t: string[]) => t[0] === 'd')
      expect(dTag?.[1]).toContain('my-forum')
    })

    it('applies sensible defaults when optional params omitted', async () => {
      const pool = mockPool()

      const event = await handleSignetPolicySet(ctx, pool as any, {
        communityId: 'minimal-community',
      })

      expect(event.kind).toBe(30078)
      expect(pool.publish).toHaveBeenCalledOnce()
    })
  })

  // ─── handleSignetVerifiers ──────────────────────────────────────────────────

  describe('handleSignetVerifiers', () => {
    it('returns empty array when no verifiers found', async () => {
      const pool = mockPool()

      const result = await handleSignetVerifiers(pool as any, ctx.activeNpub, {})

      expect(result).toEqual([])
    })

    it('returns parsed verifier list', async () => {
      const verifierEvent = makeVerifierEvent(BOB, 'solicitor', 'GB')
      const pool = mockPool({
        query: vi.fn().mockResolvedValue([verifierEvent]),
      })

      const result = await handleSignetVerifiers(pool as any, ctx.activeNpub, {})

      expect(result.length).toBe(1)
      expect(result[0].pubkey).toBe(BOB)
      expect(result[0].npub).toMatch(/^npub1/)
      expect(result[0].profession).toBe('solicitor')
      expect(result[0].jurisdiction).toBe('GB')
      expect(result[0].professionalBody).toBe('Law Society')
    })

    it('filters by jurisdiction', async () => {
      const gbVerifier = makeVerifierEvent(BOB, 'solicitor', 'GB')
      const deVerifier = makeVerifierEvent(ALICE, 'notary', 'DE')
      const pool = mockPool({
        query: vi.fn().mockResolvedValue([gbVerifier, deVerifier]),
      })

      const result = await handleSignetVerifiers(pool as any, ctx.activeNpub, { jurisdiction: 'GB' })

      expect(result.length).toBe(1)
      expect(result[0].jurisdiction).toBe('GB')
    })

    it('filters by profession', async () => {
      const solicitor = makeVerifierEvent(BOB, 'solicitor', 'GB')
      const doctor = makeVerifierEvent(ALICE, 'doctor', 'GB')
      const pool = mockPool({
        query: vi.fn().mockResolvedValue([solicitor, doctor]),
      })

      const result = await handleSignetVerifiers(pool as any, ctx.activeNpub, { profession: 'doctor' })

      expect(result.length).toBe(1)
      expect(result[0].profession).toBe('doctor')
    })
  })

  // ─── handleSignetChallenge ──────────────────────────────────────────────────

  describe('handleSignetChallenge', () => {
    it('creates and publishes a challenge event', async () => {
      const pool = mockPool()

      const event = await handleSignetChallenge(ctx, pool as any, {
        verifierPubkey: BOB,
        reason: 'registry-mismatch',
        evidence: 'The Law Society register shows no matching entry for this practitioner.',
      })

      expect(event).toBeDefined()
      expect(event.kind).toBe(31000)
      expect(pool.publish).toHaveBeenCalledOnce()
      // Should reference the verifier
      const pTag = event.tags.find((t: string[]) => t[0] === 'p' && t[1] === BOB)
      expect(pTag).toBeDefined()
    })

    it('publishes with empty evidence string when evidence is omitted', async () => {
      const pool = mockPool()

      const event = await handleSignetChallenge(ctx, pool as any, {
        verifierPubkey: BOB,
        reason: 'other',
      })

      expect(event.kind).toBe(31000)
      expect(pool.publish).toHaveBeenCalledOnce()
    })
  })
})
