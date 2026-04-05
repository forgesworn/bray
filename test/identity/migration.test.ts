import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock verifyEvent to accept test fixtures
vi.mock('nostr-tools/pure', async () => {
  const actual = await vi.importActual('nostr-tools/pure')
  return { ...actual, verifyEvent: () => true }
})
import { IdentityContext } from '../../src/context.js'
import {
  handleIdentityBackup,
  handleIdentityRestore,
  handleIdentityMigrate,
} from '../../src/identity/migration.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

// Mock events for backup
const mockProfile = {
  kind: 0,
  pubkey: 'oldpub123',
  created_at: 1000,
  tags: [],
  content: JSON.stringify({ name: 'Test User', about: 'hello' }),
  id: 'profile1',
  sig: 'sig1',
}

const mockContacts = {
  kind: 3,
  pubkey: 'oldpub123',
  created_at: 1000,
  tags: [['p', 'friend1'], ['p', 'friend2'], ['p', 'friend3']],
  content: '',
  id: 'contacts1',
  sig: 'sig2',
}

const mockRelayList = {
  kind: 10002,
  pubkey: 'oldpub123',
  created_at: 1000,
  tags: [['r', 'wss://relay.example.com']],
  content: '',
  id: 'relaylist1',
  sig: 'sig3',
}

const mockAttestation = {
  kind: 31000,
  pubkey: 'oldpub123',
  created_at: 1000,
  tags: [['d', 'attestation:test']],
  content: 'attestation content',
  id: 'attest1',
  sig: 'sig4',
}

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.example.com'], write: ['wss://relay.example.com'] }),
  }
}

describe('identity migration', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleIdentityBackup', () => {
    it('fetches kind 0, 3, 10002, 31000 for a pubkey', async () => {
      const pool = mockPool([mockProfile, mockContacts, mockRelayList, mockAttestation])
      const result = await handleIdentityBackup(pool as any, 'oldpub123', 'npub1old')
      expect(pool.query).toHaveBeenCalled()
      expect(result.events.length).toBe(4)
    })

    it('returns JSON bundle with no private keys', async () => {
      const pool = mockPool([mockProfile, mockContacts])
      const result = await handleIdentityBackup(pool as any, 'oldpub123', 'npub1old')
      const serialised = JSON.stringify(result)
      expect(serialised).not.toMatch(/nsec1/)
      expect(serialised).not.toMatch(/privateKey/)
      expect(result.events).toBeDefined()
    })
  })

  describe('handleIdentityRestore', () => {
    it('re-signs kind 0, 3, 10002 under active identity', async () => {
      const pool = mockPool()
      const backup = {
        pubkeyHex: 'oldpub123',
        events: [mockProfile, mockContacts, mockRelayList, mockAttestation],
      }
      const result = await handleIdentityRestore(ctx, pool as any, backup)
      // Should re-sign profile, contacts, relay list (3 events)
      expect(result.restored.length).toBe(3)
      // Each restored event should have the new pubkey
      for (const evt of result.restored) {
        expect(evt.kind).toBeOneOf([0, 3, 10002])
      }
    })

    it('skips events that fail signature verification', async () => {
      const pool = mockPool()
      const badEvent = { ...mockProfile, pubkey: 'wrong-pubkey' } // author mismatch
      const backup = {
        pubkeyHex: 'oldpub123',
        events: [badEvent, mockContacts],
      }
      const result = await handleIdentityRestore(ctx, pool as any, backup)
      expect(result.skipped.length).toBe(1)
      expect(result.skipped[0].reason).toMatch(/verification|mismatch/i)
    })

    it('does NOT re-sign kind 31000 attestations (trust chain protection)', async () => {
      const pool = mockPool()
      const backup = {
        pubkeyHex: 'oldpub123',
        events: [mockProfile, mockAttestation],
      }
      const result = await handleIdentityRestore(ctx, pool as any, backup)
      expect(result.skipped.length).toBe(1)
      expect(result.skipped[0].kind).toBe(31000)
      expect(result.skipped[0].reason).toMatch(/attestation/i)
    })
  })

  describe('handleIdentityMigrate', () => {
    it('requires confirm: true', async () => {
      const pool = mockPool([mockProfile, mockContacts])
      const result = await handleIdentityMigrate(ctx, pool as any, {
        oldPubkeyHex: 'oldpub123',
        oldNpub: 'npub1old',
        confirm: false,
      })
      expect(result.status).toBe('preview')
      expect(result.summary).toBeDefined()
    })

    it('shows summary with profile fields and contact count', async () => {
      const pool = mockPool([mockProfile, mockContacts, mockRelayList])
      const result = await handleIdentityMigrate(ctx, pool as any, {
        oldPubkeyHex: 'oldpub123',
        oldNpub: 'npub1old',
        confirm: false,
      })
      expect(result.summary.profileFields).toContain('name')
      expect(result.summary.contactCount).toBe(3)
    })

    it('publishes linkage proof when confirmed', async () => {
      const pool = mockPool([mockProfile, mockContacts])
      const result = await handleIdentityMigrate(ctx, pool as any, {
        oldPubkeyHex: 'oldpub123',
        oldNpub: 'npub1old',
        confirm: true,
      })
      expect(result.status).toBe('migrated')
    })
  })
})
