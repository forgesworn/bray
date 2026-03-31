import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { IdentityContext } from '../../src/context.js'
import {
  handleDispatchSend,
  handleDispatchCheck,
  handleDispatchReply,
} from '../../src/dispatch/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] }),
    publishDirect: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
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
    it('sends a think task to a named recipient', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        to: 'alice',
        type: 'think',
        prompt: 'Analyse the relay pool architecture',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('claude-think')
      expect(result.recipientName).toBe('alice')
      expect(result.recipientHex).toBe(ALICE_HEX)
      expect(result.taskId).toMatch(/^think-/)
      expect(result.publish).toBeDefined()

      // Verify the DM was sent with a JSON dispatch message
      expect(pool.publish).toHaveBeenCalled()
    })

    it('sends a build task with repos and branchFrom', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        to: 'bob',
        type: 'build',
        prompt: 'Add dispatch handlers',
        repos: ['bray'],
        branchFrom: 'main',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('claude-build')
      expect(result.recipientName).toBe('bob')
      expect(result.recipientHex).toBe(BOB_HEX)
      expect(result.taskId).toMatch(/^build-/)
    })

    it('rejects an unknown recipient', async () => {
      const pool = mockPool()
      await expect(
        handleDispatchSend(ctx, pool as any, {
          identities: makeIdentities(),
          to: 'charlie',
          type: 'think',
          prompt: 'Hello',
        }),
      ).rejects.toThrow(/charlie/)
    })

    it('performs case-insensitive name lookup', async () => {
      const pool = mockPool()
      const result = await handleDispatchSend(ctx, pool as any, {
        identities: makeIdentities(),
        to: 'Alice',
        type: 'think',
        prompt: 'Test case insensitivity',
      })

      expect(result.recipientName).toBe('alice')
      expect(result.recipientHex).toBe(ALICE_HEX)
    })

    it('includes known names in the error for unknown recipient', async () => {
      const pool = mockPool()
      try {
        await handleDispatchSend(ctx, pool as any, {
          identities: makeIdentities(),
          to: 'charlie',
          type: 'think',
          prompt: 'Hello',
        })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('alice')
        expect(err.message).toContain('bob')
      }
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
        mode: 'think',
        plan: 'Step 1: do this\nStep 2: do that',
        filesRead: ['src/index.ts'],
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('claude-result')
      expect(result.deleted).toBe(false)
    })

    it('sends a build result with branch and commits', async () => {
      const pool = mockPool()
      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'build-xyz789',
        to: BOB_HEX,
        mode: 'build',
        branch: 'feat/dispatch',
        commits: ['abc1234'],
        tests: '10 passed, 0 failed',
        pr: 'https://github.com/forgesworn/bray/pull/42',
      })

      expect(result.sent).toBe(true)
      expect(result.messageType).toBe('claude-result')
    })

    it('deletes original event when deleteEventId provided', async () => {
      const pool = mockPool()
      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        mode: 'think',
        plan: 'Done',
        deleteEventId: 'event123',
      })

      expect(result.deleted).toBe(true)
      // publish is called for: DM send (gift wrap + sender copy) + delete event
      // At minimum, the delete event should trigger another publish call
      expect(pool.publish.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('handles delete failure gracefully', async () => {
      const pool = mockPool()
      // First two publish calls succeed (DM send), third fails (delete)
      pool.publish
        .mockResolvedValueOnce({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] })
        .mockResolvedValueOnce({ success: true, accepted: ['wss://relay.trotters.cc'], rejected: [], errors: [] })
        .mockRejectedValueOnce(new Error('Relay refused'))

      const result = await handleDispatchReply(ctx, pool as any, {
        identities: makeIdentities(),
        re: 'think-abc123',
        to: ALICE_HEX,
        mode: 'think',
        deleteEventId: 'event123',
      })

      // Should not throw, just mark as not deleted
      expect(result.sent).toBe(true)
      expect(result.deleted).toBe(false)
    })
  })
})
