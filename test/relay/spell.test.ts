import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleCastSpell } from '../../src/relay/spell.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    queryDirect: vi.fn().mockResolvedValue(events),
  }
}

function makeSpell(tags: string[][]): any {
  return {
    id: 'abc123',
    pubkey: 'def456',
    kind: 777,
    created_at: Math.floor(Date.now() / 1000),
    content: 'test spell',
    tags,
    sig: 'fake',
  }
}

describe('handleCastSpell', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('parses kind filter from k tags', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['name', 'Test'],
      ['k', '31402'],
      ['limit', '10'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ kinds: [31402], limit: 10 }),
    )
  })

  it('resolves $me in authors', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['authors', '$me'],
      ['k', '1'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ authors: [ctx.activePublicKeyHex] }),
    )
  })

  it('resolves $contacts from kind 3', async () => {
    const contactList = {
      id: 'c1', pubkey: ctx.activePublicKeyHex, kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [['p', 'alice123'], ['p', 'bob456']],
      sig: 'fake',
    }
    const pool = mockPool()
    // First call: fetch the spell (if by ID) or contact list
    pool.query
      .mockResolvedValueOnce([contactList])  // contacts fetch
      .mockResolvedValueOnce([])             // result query

    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['authors', '$contacts'],
      ['k', '31402'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    // Second query call should have resolved contacts
    expect(pool.query).toHaveBeenLastCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ authors: ['alice123', 'bob456'] }),
    )
  })

  it('parses tag filters', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['k', '31402'],
      ['tag', 'g', 'gcpu'],
      ['tag', 't', 'plumbing'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({
        '#g': ['gcpu'],
        '#t': ['plumbing'],
      }),
    )
  })

  it('resolves relative timestamps', async () => {
    const pool = mockPool()
    const now = Math.floor(Date.now() / 1000)
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['k', '1'],
      ['since', '7d'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    const filter = pool.query.mock.calls[0][1]
    // Should be roughly now - 7 days (within 5 seconds tolerance)
    expect(filter.since).toBeGreaterThan(now - 7 * 86400 - 5)
    expect(filter.since).toBeLessThanOrEqual(now - 7 * 86400 + 5)
  })

  it('uses spell relays when specified', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['k', '1'],
      ['relays', 'wss://custom.relay'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.queryDirect).toHaveBeenCalledWith(
      ['wss://custom.relay'],
      expect.any(Object),
    )
  })

  it('fetches spell by event ID', async () => {
    const spell = makeSpell([['cmd', 'REQ'], ['k', '1']])
    const pool = mockPool()
    pool.query
      .mockResolvedValueOnce([spell])  // fetch spell
      .mockResolvedValueOnce([])       // execute query

    await handleCastSpell(ctx, pool as any, { eventId: 'abc123' })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ ids: ['abc123'], kinds: [777] }),
    )
  })

  it('rejects non-777 events', async () => {
    const pool = mockPool()
    const notSpell = { ...makeSpell([['cmd', 'REQ']]), kind: 1 }

    await expect(handleCastSpell(ctx, pool as any, { spell: notSpell }))
      .rejects.toThrow('Not a Spell')
  })

  it('rejects COUNT commands', async () => {
    const pool = mockPool()
    const spell = makeSpell([['cmd', 'COUNT'], ['k', '1']])

    await expect(handleCastSpell(ctx, pool as any, { spell }))
      .rejects.toThrow('Unsupported Spell command')
  })

  it('handles multiple k tags', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['k', '31402'],
      ['k', '31000'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ kinds: [31402, 31000] }),
    )
  })

  it('handles NIP-50 search', async () => {
    const pool = mockPool()
    const spell = makeSpell([
      ['cmd', 'REQ'],
      ['k', '31402'],
      ['search', 'plumbing london'],
    ])

    await handleCastSpell(ctx, pool as any, { spell })

    expect(pool.query).toHaveBeenCalledWith(
      ctx.activeNpub,
      expect.objectContaining({ search: 'plumbing london' }),
    )
  })
})
