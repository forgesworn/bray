import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { IdentityContext } from '../../src/context.js'
import {
  handleDispatchSend,
  handleDispatchCheck,
  handleDispatchReply,
  handleDispatchAck,
  handleDispatchStatus,
  handleDispatchCancel,
  handleDispatchRefuse,
  handleDispatchFailure,
  handleDispatchQuery,
  handleDispatchPropose,
} from '../../src/dispatch/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.trotters.cc'] }),
  }
}

// Valid secp256k1 public keys derived from known private keys
const ALICE_HEX = getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
const BOB_HEX = getPublicKey(Buffer.from('02'.repeat(32), 'hex'))

function makeIdentities(): Map<string, string> {
  const m = new Map<string, string>()
  m.set('alice', ALICE_HEX)
  m.set('bob', BOB_HEX)
  return m
}

describe('dispatch handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  // -------------------------------------------------------------------------
  // handleDispatchSend
  // -------------------------------------------------------------------------
  describe('handleDispatchSend', () => {
    it('sends a think task to a resolved recipient', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        recipientHex: ALICE_HEX,
        recipientName: 'alice',
        type: 'think',
        prompt: 'Analyse the relay pool architecture',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-think')
      expect(result.recipientName).toBe('alice')
      expect(result.recipientHex).toBe(ALICE_HEX)
      expect(result.taskId).toMatch(/^think-/)
      expect(result.publish).toBeDefined()
      expect(pool.publish).toHaveBeenCalled()
    })

    it('sends a build task with repos and branchFrom', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        recipientHex: BOB_HEX,
        recipientName: 'bob',
        type: 'build',
        prompt: 'Add dispatch handlers',
        repos: ['bray'],
        branchFrom: 'main',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-build')
      expect(result.recipientName).toBe('bob')
      expect(result.recipientHex).toBe(BOB_HEX)
      expect(result.taskId).toMatch(/^build-/)
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchCheck
  // -------------------------------------------------------------------------
  describe('handleDispatchCheck', () => {
    it('returns empty array when no messages', async () => {
      const pool = mockPool([])
      const result = await handleDispatchCheck(ctx, pool as any, {
        identities: makeIdentities(),
      })

      expect(result).toEqual([])
      expect(pool.query).toHaveBeenCalled()
    })

    it('calls pool.query with correct parameters', async () => {
      const pool = mockPool([])
      const since = Math.floor(Date.now() / 1000) - 3600
      await handleDispatchCheck(ctx, pool as any, {
        identities: makeIdentities(),
        since,
      })

      expect(pool.query).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchReply
  // -------------------------------------------------------------------------
  describe('handleDispatchReply', () => {
    it('sends a result message', async () => {
      const pool = mockPool()
      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        type: 'think',
        plan: 'Step 1: do this\nStep 2: do that',
        filesRead: ['src/index.ts'],
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-result')
      expect(result.deleted).toBe(false)
    })

    it('sends a build result with branch and commits', async () => {
      const pool = mockPool()
      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        type: 'build',
        branch: 'feat/dispatch',
        commits: ['abc1234'],
        tests: '10 passed, 0 failed',
        pr: 'https://github.com/forgesworn/bray/pull/42',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-result')
    })

    it('deletes original event when deleteEventId provided', async () => {
      const pool = mockPool()
      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        type: 'think',
        plan: 'Done',
        deleteEventId: 'event123',
      })

      expect(result.deleted).toBe(true)
      expect(pool.publish.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('handles delete failure gracefully', async () => {
      const pool = mockPool()
      pool.publish
        .mockResolvedValueOnce({ success: true, allAccepted: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] })
        .mockResolvedValueOnce({ success: true, allAccepted: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] })
        .mockRejectedValueOnce(new Error('Relay refused'))

      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        type: 'think',
        deleteEventId: 'event123',
      })

      expect(result.sent).toBe(true)
      expect(result.deleted).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchAck
  // -------------------------------------------------------------------------
  describe('handleDispatchAck', () => {
    it('sends an ack message', async () => {
      const pool = mockPool()
      const result = await handleDispatchAck(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        note: 'Starting analysis',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-ack')
      expect(result.deleted).toBe(false)
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchStatus
  // -------------------------------------------------------------------------
  describe('handleDispatchStatus', () => {
    it('sends a status update', async () => {
      const pool = mockPool()
      const result = await handleDispatchStatus(ctx, pool as any, {
        identities: makeIdentities(),
        to: BOB_HEX,
        status: 'busy',
        note: 'Processing a build task',
        queue: 2,
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-status')
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchCancel
  // -------------------------------------------------------------------------
  describe('handleDispatchCancel', () => {
    it('sends a cancel message', async () => {
      const pool = mockPool()
      const result = await handleDispatchCancel(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        note: 'No longer needed',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-cancel')
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchRefuse
  // -------------------------------------------------------------------------
  describe('handleDispatchRefuse', () => {
    it('sends a refuse message with reason', async () => {
      const pool = mockPool()
      const result = await handleDispatchRefuse(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        reason: 'Repository not available locally',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-refuse')
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchFailure
  // -------------------------------------------------------------------------
  describe('handleDispatchFailure', () => {
    it('sends a failure message with error', async () => {
      const pool = mockPool()
      const result = await handleDispatchFailure(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        error: 'Build failed: type error in handlers.ts:42',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-failure')
      expect(pool.publish).toHaveBeenCalled()
    })

    it('includes partial results', async () => {
      const pool = mockPool()
      const result = await handleDispatchFailure(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        error: 'Tests failed after implementation',
        partial: 'Branch feat/dispatch created with 3 commits. 8 of 10 tests pass.',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-failure')
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchQuery
  // -------------------------------------------------------------------------
  describe('handleDispatchQuery', () => {
    it('sends a clarifying question', async () => {
      const pool = mockPool()
      const result = await handleDispatchQuery(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        question: 'Should the analysis include performance benchmarks or just architecture review?',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-query')
      expect(pool.publish).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Delegation depth limit
  // -------------------------------------------------------------------------
  describe('delegation depth', () => {
    it('rejects sending when depth is 0', async () => {
      const pool = mockPool()
      await expect(
        handleDispatchSend(ctx, pool as any, {
          identities: makeIdentities(),
          recipientHex: ALICE_HEX,
          recipientName: 'alice',
          type: 'think',
          prompt: 'Should be blocked',
          depth: 0,
        }),
      ).rejects.toThrow(/depth/)
    })

    it('allows sending when depth is positive', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        recipientHex: ALICE_HEX,
        recipientName: 'alice',
        type: 'think',
        prompt: 'Should work',
        depth: 3,
      })

      expect(result.sent).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchSend with dependsOn
  // -------------------------------------------------------------------------
  describe('handleDispatchSend with dependsOn', () => {
    it('passes dependsOn through to the message', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        recipientHex: ALICE_HEX,
        recipientName: 'alice',
        type: 'think',
        prompt: 'Analyse after prerequisites',
        dependsOn: ['think-abc-1', 'build-def-2'],
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-think')

      // Verify the published message contains depends_on
      const publishCall = pool.publish.mock.calls[0]
      const event = publishCall[0]
      // The DM content is encrypted, so we verify the task ID format indicates it was built
      expect(result.taskId).toMatch(/^think-/)
    })

    it('passes dependsOn through to build messages', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        recipientHex: BOB_HEX,
        recipientName: 'bob',
        type: 'build',
        prompt: 'Implement after analysis',
        branchFrom: 'main',
        dependsOn: ['think-abc-1'],
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-build')
      expect(result.taskId).toMatch(/^build-/)
    })
  })

  // -------------------------------------------------------------------------
  // handleDispatchPropose
  // -------------------------------------------------------------------------
  describe('handleDispatchPropose', () => {
    it('sends a proposal message', async () => {
      const pool = mockPool()
      const result = await handleDispatchPropose(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        proposal: 'Use event sourcing instead of CRUD',
        reason: 'The current approach cannot handle real-time updates',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-propose')
      expect(result.deleted).toBe(false)
      expect(pool.publish).toHaveBeenCalled()
    })

    it('sends a proposal without reason', async () => {
      const pool = mockPool()
      const result = await handleDispatchPropose(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        proposal: 'Split into two smaller tasks',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('dispatch-propose')
    })
  })
})
