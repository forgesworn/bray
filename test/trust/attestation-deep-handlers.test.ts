import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleTrustAttestParse,
  handleTrustAttestFilter,
  handleTrustAttestTemporal,
  handleTrustAttestChain,
  handleTrustAttestCheckRevoked,
} from '../../src/trust/attestation-deep-handlers.js'
import { handleTrustAttest, handleTrustRevoke } from '../../src/trust/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.example.com'], rejected: [], errors: [] }),
  }
}

describe('attestation deep handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleTrustAttestParse', () => {
    it('parses a valid attestation event into typed object', async () => {
      const pool = mockPool()
      const { event } = await handleTrustAttest(ctx, pool as any, {
        type: 'endorsement',
        identifier: 'abc123'.padEnd(64, '0'),
        subject: 'abc123'.padEnd(64, '0'),
        summary: 'Good person',
      })
      const parsed = handleTrustAttestParse(event)
      expect(parsed).not.toBeNull()
      expect(parsed!.kind).toBe(31000)
      expect(parsed!.type).toBe('endorsement')
      expect(parsed!.subject).toBe('abc123'.padEnd(64, '0'))
      expect(parsed!.summary).toBe('Good person')
      expect(parsed!.pubkey).toBe(event.pubkey)
      expect(parsed!.createdAt).toBe(event.created_at)
    })

    it('returns null for non-attestation events', () => {
      const event = {
        kind: 1,
        pubkey: 'abc',
        created_at: 1000,
        tags: [],
        content: 'hello',
        id: 'evt1',
        sig: 'sig1',
      }
      expect(handleTrustAttestParse(event as any)).toBeNull()
    })

    it('returns null for kind 31000 without type or assertion', () => {
      const event = {
        kind: 31000,
        pubkey: 'abc',
        created_at: 1000,
        tags: [['d', 'something']],
        content: '',
        id: 'evt1',
        sig: 'sig1',
      }
      expect(handleTrustAttestParse(event as any)).toBeNull()
    })

    it('parses assertion-first attestation with e-tag', async () => {
      const pool = mockPool()
      const { event } = await handleTrustAttest(ctx, pool as any, {
        assertionId: 'evt999'.padEnd(64, '0'),
        assertionRelay: 'wss://relay.example.com',
        summary: 'Verified',
      })
      const parsed = handleTrustAttestParse(event)
      expect(parsed).not.toBeNull()
      expect(parsed!.assertionId).toBe('evt999'.padEnd(64, '0'))
      expect(parsed!.assertionRelay).toBe('wss://relay.example.com')
    })

    it('detects revoked attestation', () => {
      const event = {
        kind: 31000,
        pubkey: 'abc',
        created_at: 1000,
        tags: [['d', 'endorsement:test'], ['type', 'endorsement'], ['status', 'revoked']],
        content: '',
        id: 'evt1',
        sig: 'sig1',
      }
      const parsed = handleTrustAttestParse(event as any)
      expect(parsed).not.toBeNull()
      expect(parsed!.revoked).toBe(true)
    })

    it('extracts temporal fields', async () => {
      const pool = mockPool()
      const { event } = await handleTrustAttestTemporal(ctx, pool as any, {
        type: 'credential',
        identifier: 'test-id',
        occurredAt: 1700000000,
        validFrom: 1700000000,
        validTo: 1800000000,
      })
      const parsed = handleTrustAttestParse(event)
      expect(parsed).not.toBeNull()
      expect(parsed!.occurredAt).toBe(1700000000)
      expect(parsed!.validFrom).toBe(1700000000)
      expect(parsed!.validTo).toBe(1800000000)
    })
  })

  describe('handleTrustAttestFilter', () => {
    it('builds filter with type', () => {
      const filter = handleTrustAttestFilter({ type: 'endorsement' })
      expect(filter.kinds).toEqual([31000])
      expect((filter as any)['#type']).toEqual(['endorsement'])
    })

    it('builds filter with subject', () => {
      const filter = handleTrustAttestFilter({ subject: 'abc'.padEnd(64, '0') })
      expect((filter as any)['#p']).toEqual(['abc'.padEnd(64, '0')])
    })

    it('builds filter with attestor', () => {
      const filter = handleTrustAttestFilter({ attestor: 'def'.padEnd(64, '0') })
      expect(filter.authors).toEqual(['def'.padEnd(64, '0')])
    })

    it('builds filter with schema', () => {
      const filter = handleTrustAttestFilter({ schema: 'https://example.com/schema.json' })
      expect((filter as any)['#schema']).toEqual(['https://example.com/schema.json'])
    })

    it('adds time range when specified', () => {
      const filter = handleTrustAttestFilter({ since: 1000, until: 2000 })
      expect((filter as any).since).toBe(1000)
      expect((filter as any).until).toBe(2000)
    })

    it('builds filter with all params combined', () => {
      const filter = handleTrustAttestFilter({
        type: 'vouch',
        subject: 'aaa'.padEnd(64, '0'),
        attestor: 'bbb'.padEnd(64, '0'),
        since: 1000,
        until: 2000,
      })
      expect(filter.kinds).toEqual([31000])
      expect((filter as any)['#type']).toEqual(['vouch'])
      expect((filter as any)['#p']).toEqual(['aaa'.padEnd(64, '0')])
      expect(filter.authors).toEqual(['bbb'.padEnd(64, '0')])
      expect((filter as any).since).toBe(1000)
      expect((filter as any).until).toBe(2000)
    })
  })

  describe('handleTrustAttestTemporal', () => {
    it('creates attestation with occurredAt tag', async () => {
      const pool = mockPool()
      const result = await handleTrustAttestTemporal(ctx, pool as any, {
        type: 'credential',
        identifier: 'test-temporal',
        occurredAt: 1700000000,
      })
      expect(result.event.kind).toBe(31000)
      const occurredTag = result.event.tags.find(t => t[0] === 'occurred_at')
      expect(occurredTag).toBeDefined()
      expect(occurredTag![1]).toBe('1700000000')
    })

    it('creates attestation with validFrom and validTo', async () => {
      const pool = mockPool()
      const result = await handleTrustAttestTemporal(ctx, pool as any, {
        type: 'credential',
        identifier: 'test-window',
        occurredAt: 1700000000,
        validFrom: 1700000000,
        validTo: 1800000000,
      })
      const validFromTag = result.event.tags.find(t => t[0] === 'valid_from')
      const validToTag = result.event.tags.find(t => t[0] === 'valid_to')
      expect(validFromTag![1]).toBe('1700000000')
      expect(validToTag![1]).toBe('1800000000')
    })

    it('rejects when occurredAt is not finite', async () => {
      const pool = mockPool()
      await expect(handleTrustAttestTemporal(ctx, pool as any, {
        type: 'credential',
        identifier: 'test',
        occurredAt: Infinity,
      })).rejects.toThrow(/occurredAt/)
    })

    it('rejects when neither type nor assertionId provided', async () => {
      const pool = mockPool()
      await expect(handleTrustAttestTemporal(ctx, pool as any, {
        identifier: 'test',
        occurredAt: 1700000000,
      })).rejects.toThrow(/type or assertionId/)
    })

    it('publishes event to relay', async () => {
      const pool = mockPool()
      const result = await handleTrustAttestTemporal(ctx, pool as any, {
        type: 'credential',
        identifier: 'test-pub',
        occurredAt: 1700000000,
      })
      expect(result.publish.success).toBe(true)
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  describe('handleTrustAttestChain', () => {
    it('returns empty chain when no attestations found', async () => {
      const pool = mockPool([])
      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: 'abc'.padEnd(64, '0'),
      })
      expect(result.chain).toEqual([])
      expect(result.depth).toBe(0)
    })

    it('builds single-depth chain', async () => {
      const attestorPubkey = 'attestor1'.padEnd(64, '0')
      const subjectPubkey = 'subject1'.padEnd(64, '0')
      const events = [{
        kind: 31000,
        pubkey: attestorPubkey,
        created_at: 1000,
        tags: [
          ['d', `endorsement:${subjectPubkey}`],
          ['type', 'endorsement'],
          ['p', subjectPubkey],
        ],
        content: '',
        id: 'evt1'.padEnd(64, '0'),
        sig: 'sig1',
      }]
      // Return events only for first query (the start subject), empty for subsequent
      let callCount = 0
      const pool = {
        query: vi.fn().mockImplementation(() => {
          callCount++
          return Promise.resolve(callCount === 1 ? events : [])
        }),
        publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
      }
      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: subjectPubkey,
      })
      expect(result.chain.length).toBe(1)
      expect(result.chain[0].attestor).toBe(attestorPubkey)
      expect(result.chain[0].subject).toBe(subjectPubkey)
      expect(result.chain[0].depth).toBe(0)
    })

    it('follows chain to depth 2', async () => {
      const attestor1 = 'attestor1'.padEnd(64, '0')
      const attestor2 = 'attestor2'.padEnd(64, '0')
      const subject = 'subject1'.padEnd(64, '0')

      // First call returns attestations about subject, second about attestor1
      let callCount = 0
      const pool = {
        query: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve([{
              kind: 31000,
              pubkey: attestor1,
              created_at: 1000,
              tags: [['d', `vouch:${subject}`], ['type', 'vouch'], ['p', subject]],
              content: '',
              id: 'evt1'.padEnd(64, '0'),
              sig: 'sig1',
            }])
          }
          if (callCount === 2) {
            return Promise.resolve([{
              kind: 31000,
              pubkey: attestor2,
              created_at: 1100,
              tags: [['d', `vouch:${attestor1}`], ['type', 'vouch'], ['p', attestor1]],
              content: '',
              id: 'evt2'.padEnd(64, '0'),
              sig: 'sig2',
            }])
          }
          return Promise.resolve([])
        }),
        publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
      }

      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: subject,
        maxDepth: 3,
      })
      expect(result.chain.length).toBe(2)
      expect(result.chain[0].depth).toBe(0)
      expect(result.chain[1].depth).toBe(1)
    })

    it('respects maxDepth limit', async () => {
      const events = [{
        kind: 31000,
        pubkey: 'attestor'.padEnd(64, '0'),
        created_at: 1000,
        tags: [['d', 'vouch:sub'], ['type', 'vouch'], ['p', 'sub'.padEnd(64, '0')]],
        content: '',
        id: 'evt'.padEnd(64, '0'),
        sig: 'sig',
      }]
      const pool = mockPool(events)
      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: 'sub'.padEnd(64, '0'),
        maxDepth: 1,
      })
      // Only depth 0 should be explored
      expect(pool.query).toHaveBeenCalledTimes(1)
    })

    it('does not revisit already-visited subjects', async () => {
      // Circular attestation: A attests B, B attests A
      const pubA = 'aaaa'.padEnd(64, '0')
      const pubB = 'bbbb'.padEnd(64, '0')

      let callCount = 0
      const pool = {
        query: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve([{
              kind: 31000, pubkey: pubB, created_at: 1000,
              tags: [['d', `vouch:${pubA}`], ['type', 'vouch'], ['p', pubA]],
              content: '', id: 'e1'.padEnd(64, '0'), sig: 's1',
            }])
          }
          if (callCount === 2) {
            return Promise.resolve([{
              kind: 31000, pubkey: pubA, created_at: 1100,
              tags: [['d', `vouch:${pubB}`], ['type', 'vouch'], ['p', pubB]],
              content: '', id: 'e2'.padEnd(64, '0'), sig: 's2',
            }])
          }
          return Promise.resolve([])
        }),
        publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
      }

      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: pubA,
        maxDepth: 5,
      })
      // Should stop after visiting A and B, not loop forever
      expect(result.chain.length).toBe(2)
    })

    it('includes validity status in chain entries', async () => {
      const events = [{
        kind: 31000,
        pubkey: 'attestor'.padEnd(64, '0'),
        created_at: 1000,
        tags: [
          ['d', 'vouch:sub'],
          ['type', 'vouch'],
          ['p', 'sub'.padEnd(64, '0')],
          ['status', 'revoked'],
        ],
        content: '',
        id: 'evt'.padEnd(64, '0'),
        sig: 'sig',
      }]
      const pool = mockPool(events)
      const result = await handleTrustAttestChain(pool as any, 'somenpub', {
        startSubject: 'sub'.padEnd(64, '0'),
      })
      expect(result.chain[0].validity.valid).toBe(false)
      expect(result.chain[0].validity.reason).toBe('revoked')
    })
  })

  describe('handleTrustAttestCheckRevoked', () => {
    it('returns revoked: false when no events found', async () => {
      const pool = mockPool([])
      const result = await handleTrustAttestCheckRevoked(pool as any, 'somenpub', {
        type: 'endorsement',
        identifier: 'test',
      })
      expect(result.revoked).toBe(false)
    })

    it('detects revoked attestation', async () => {
      const events = [{
        kind: 31000,
        pubkey: 'abc',
        created_at: 2000,
        tags: [['d', 'endorsement:test'], ['type', 'endorsement'], ['status', 'revoked'], ['reason', 'No longer valid']],
        content: '',
        id: 'evt1',
        sig: 'sig1',
      }]
      const pool = mockPool(events)
      const result = await handleTrustAttestCheckRevoked(pool as any, 'somenpub', {
        type: 'endorsement',
        identifier: 'test',
      })
      expect(result.revoked).toBe(true)
      expect(result.reason).toBe('No longer valid')
    })

    it('returns revoked: false when latest event is not revoked', async () => {
      const events = [{
        kind: 31000,
        pubkey: 'abc',
        created_at: 2000,
        tags: [['d', 'endorsement:test'], ['type', 'endorsement']],
        content: '',
        id: 'evt1',
        sig: 'sig1',
      }]
      const pool = mockPool(events)
      const result = await handleTrustAttestCheckRevoked(pool as any, 'somenpub', {
        type: 'endorsement',
        identifier: 'test',
      })
      expect(result.revoked).toBe(false)
      expect(result.event).toBeDefined()
    })

    it('works with assertionId', async () => {
      const pool = mockPool([])
      const result = await handleTrustAttestCheckRevoked(pool as any, 'somenpub', {
        assertionId: 'evt999'.padEnd(64, '0'),
      })
      expect(result.revoked).toBe(false)
      expect(pool.query).toHaveBeenCalled()
    })

    it('throws when neither type+identifier nor assertionId provided', async () => {
      const pool = mockPool()
      await expect(handleTrustAttestCheckRevoked(pool as any, 'somenpub', {})).rejects.toThrow(/provide/)
    })

    it('picks most recent event when multiple returned', async () => {
      const events = [
        {
          kind: 31000, pubkey: 'abc', created_at: 1000,
          tags: [['d', 'endorsement:test'], ['type', 'endorsement']],
          content: '', id: 'old', sig: 's1',
        },
        {
          kind: 31000, pubkey: 'abc', created_at: 2000,
          tags: [['d', 'endorsement:test'], ['type', 'endorsement'], ['status', 'revoked']],
          content: '', id: 'new', sig: 's2',
        },
      ]
      const pool = mockPool(events)
      const result = await handleTrustAttestCheckRevoked(pool as any, 'somenpub', {
        type: 'endorsement',
        identifier: 'test',
      })
      expect(result.revoked).toBe(true)
      expect(result.event!.id).toBe('new')
    })
  })
})
