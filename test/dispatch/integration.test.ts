/**
 * End-to-end integration test for the dispatch send -> check -> reply cycle.
 *
 * Uses real IdentityContext instances for both alice and bob, with a mocked
 * relay pool to avoid network calls.
 */

import { describe, it, expect, vi } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleDispatchSend,
  handleDispatchCheck,
  handleDispatchReply,
} from '../../src/dispatch/handlers.js'

// ---------------------------------------------------------------------------
// Test identities -- real nsecs, mocked relay
// ---------------------------------------------------------------------------

const ALICE_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const BOB_NSEC = 'nsec1km43lkqf87qfmj6f02g8d8zjy5f7jsdgekm77mdgx2df4shy06dqyftv33'

function mockPool() {
  return {
    query: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({
      success: true,
      accepted: ['wss://relay.trotters.cc'],
      rejected: [],
      errors: [],
    }),
    publishDirect: vi.fn().mockResolvedValue({
      success: true,
      accepted: [],
      rejected: [],
      errors: [],
    }),
    getRelays: vi.fn().mockReturnValue({
      read: [],
      write: ['wss://relay.trotters.cc'],
    }),
  }
}

function buildIdentities(aliceCtx: IdentityContext, bobCtx: IdentityContext) {
  const identities = new Map<string, string>()
  identities.set('alice', aliceCtx.activePublicKeyHex)
  identities.set('bob', bobCtx.activePublicKeyHex)
  return identities
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatch end-to-end', () => {
  const aliceCtx = new IdentityContext(ALICE_NSEC, 'nsec')
  const bobCtx = new IdentityContext(BOB_NSEC, 'nsec')
  const identities = buildIdentities(aliceCtx, bobCtx)

  // -------------------------------------------------------------------------
  // 1. Bob sends think task to alice
  // -------------------------------------------------------------------------
  it('sends a think task and gets correct result structure', async () => {
    const pool = mockPool()

    const result = await handleDispatchSend(bobCtx, pool as any, {
      identities,
      recipientHex: aliceCtx.activePublicKeyHex,
      recipientName: 'alice',
      type: 'think',
      prompt: 'Analyse the relay pool reconnection logic',
    })

    expect(result.sent).toBe(true)
    expect(result.messageType).toBe('dispatch-think')
    expect(result.recipientName).toBe('alice')
    expect(result.recipientHex).toBe(aliceCtx.activePublicKeyHex)
    expect(result.taskId).toMatch(/^think-/)
    expect(result.publish).toBeDefined()
    expect(result.publish.success).toBe(true)
    expect(pool.publish).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 2. Bob sends build task
  // -------------------------------------------------------------------------
  it('sends a build task with branch_from', async () => {
    const pool = mockPool()

    const result = await handleDispatchSend(bobCtx, pool as any, {
      identities,
      recipientHex: aliceCtx.activePublicKeyHex,
      recipientName: 'alice',
      type: 'build',
      prompt: 'Add NIP-65 relay list caching',
      repos: ['bray'],
      branchFrom: 'main',
    })

    expect(result.sent).toBe(true)
    expect(result.messageType).toBe('dispatch-build')
    expect(result.recipientName).toBe('alice')
    expect(result.taskId).toMatch(/^build-/)
    expect(pool.publish).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 3. Alice replies with think result + NIP-09 deletion
  // -------------------------------------------------------------------------
  it('sends a think result back with NIP-09 cleanup', async () => {
    const pool = mockPool()
    const deleteEventId = 'a'.repeat(64)

    const result = await handleDispatchReply(aliceCtx, pool as any, {
      identities,
      re: 'think-abc123',
      to: bobCtx.activePublicKeyHex,
      type: 'think',
      plan: 'Step 1: refactor pool.ts\nStep 2: add TTL cache',
      filesRead: ['src/relay-pool.ts'],
      deleteEventId,
    })

    expect(result.sent).toBe(true)
    expect(result.messageType).toBe('dispatch-result')
    expect(result.deleted).toBe(true)
    expect(pool.publish.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  // -------------------------------------------------------------------------
  // 4. Reply without deletion
  // -------------------------------------------------------------------------
  it('sends a result without deleting original', async () => {
    const pool = mockPool()

    const result = await handleDispatchReply(aliceCtx, pool as any, {
      identities,
      re: 'build-xyz789',
      to: bobCtx.activePublicKeyHex,
      type: 'build',
      branch: 'feat/nip65-cache',
      commits: ['deadbeef'],
      tests: '15 passed, 0 failed',
      pr: 'https://github.com/forgesworn/bray/pull/99',
    })

    expect(result.sent).toBe(true)
    expect(result.messageType).toBe('dispatch-result')
    expect(result.deleted).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 5. handleDispatchCheck returns empty for no messages
  // -------------------------------------------------------------------------
  it('returns empty array when no dispatch messages on relay', async () => {
    const pool = mockPool()

    const result = await handleDispatchCheck(aliceCtx, pool as any, {
      identities,
    })

    expect(result).toEqual([])
    expect(pool.query).toHaveBeenCalled()
  })
})
