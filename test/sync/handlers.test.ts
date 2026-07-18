import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent } from 'nostr-tools'
import { Nip77UnavailableError } from '../../src/relay-pool.js'
import {
  handleSyncPlan,
  handleSyncPull,
  handleSyncPush,
  parseEventJsonl,
} from '../../src/sync/handlers.js'

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0)

function signed(content: string, created_at: number) {
  return finalizeEvent({ kind: 1, content, tags: [], created_at }, KEY)
}

describe('NIP-77 sync handlers', () => {
  it('returns a read-only NIP-77 ID plan without transferring events', async () => {
    const local = signed('local', 1)
    const remote = signed('remote', 2)
    const pool = {
      reconcileDirect: vi.fn().mockResolvedValue({
        localOnlyIds: [local.id], remoteOnlyIds: [remote.id],
        localOnlyCount: 1, remoteOnlyCount: 1, truncated: false,
      }),
      queryDirect: vi.fn(),
      publishDirect: vi.fn(),
    }

    const result = await handleSyncPlan(pool as any, {
      relay: 'wss://relay.example.com',
      events: [local],
    })

    expect(result).toMatchObject({ protocol: 'nip77', complete: true, localOnlyCount: 1, remoteOnlyCount: 1 })
    expect(pool.queryDirect).not.toHaveBeenCalled()
    expect(pool.publishDirect).not.toHaveBeenCalled()
  })

  it('falls back truthfully to a bounded REQ comparison', async () => {
    const common = signed('common', 1)
    const local = signed('local', 2)
    const remote = signed('remote', 3)
    const pool = {
      reconcileDirect: vi.fn().mockRejectedValue(new Nip77UnavailableError('unsupported')),
      queryDirect: vi.fn().mockResolvedValue([common, remote]),
    }

    const result = await handleSyncPlan(pool as any, {
      relay: 'wss://relay.example.com',
      events: [common, local],
      maxRemoteEvents: 100,
    })

    expect(result.protocol).toBe('req-fallback')
    expect(result.localOnlyIds).toEqual([local.id])
    expect(result.remoteOnlyIds).toEqual([remote.id])
    expect(result.complete).toBe(true)
    expect(result.warnings[0]).toContain('NIP-77 unavailable')
  })

  it('marks a fallback comparison incomplete when its scan bound is reached', async () => {
    const remote = signed('remote', 3)
    const pool = { queryDirect: vi.fn().mockResolvedValue([remote]) }
    const result = await handleSyncPlan(pool as any, {
      relay: 'wss://relay.example.com',
      protocol: 'req-fallback',
      maxRemoteEvents: 1,
    })
    expect(result).toMatchObject({ protocol: 'req-fallback', complete: false })
    expect(result.warnings.at(-1)).toContain('scan bound')
  })

  it('pulls remote-only events only after reconciliation', async () => {
    const remote = signed('remote', 3)
    const pool = {
      reconcileDirect: vi.fn().mockResolvedValue({
        localOnlyIds: [], remoteOnlyIds: [remote.id],
        localOnlyCount: 0, remoteOnlyCount: 1, truncated: false,
      }),
      queryDirect: vi.fn().mockResolvedValue([remote]),
    }

    const result = await handleSyncPull(pool as any, 'npub-test', {
      relay: 'wss://relay.example.com',
    })
    expect(result.events).toEqual([remote])
    expect(result.transferComplete).toBe(true)
    expect(pool.queryDirect).toHaveBeenCalledWith(
      ['wss://relay.example.com'],
      expect.objectContaining({ ids: [remote.id] }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it('pushes only local-only events after reconciliation', async () => {
    const common = signed('common', 1)
    const local = signed('local', 2)
    const pool = {
      reconcileDirect: vi.fn().mockResolvedValue({
        localOnlyIds: [local.id], remoteOnlyIds: [],
        localOnlyCount: 1, remoteOnlyCount: 0, truncated: false,
      }),
      publishDirect: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    }

    const result = await handleSyncPush(pool as any, {
      relay: 'wss://relay.example.com',
      events: [common, local],
    })
    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, transferComplete: true })
    expect(pool.publishDirect).toHaveBeenCalledWith(
      ['wss://relay.example.com'],
      local,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it('supports cancellation before reconciliation starts', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(handleSyncPlan({} as any, {
      relay: 'wss://relay.example.com',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects malformed or cryptographically invalid JSONL input', () => {
    expect(() => parseEventJsonl('{bad json}', 'events.jsonl')).toThrow(/line 1/)
    const event = signed('tampered', 4)
    expect(() => parseEventJsonl(JSON.stringify({ ...event, content: 'changed' }), 'events.jsonl')).toThrow(/signature or ID/)
  })
})
