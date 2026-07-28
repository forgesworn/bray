import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../../src/cli/commands/relay.js'
import { makeHelpers } from '../../src/cli/dispatch.js'

/**
 * These cover the wiring only: that --ids-only and --only-missing route to
 * reconcileDirect with the right arguments and render the right output.
 *
 * They deliberately stop short of the protocol itself. NIP-77 reconciliation
 * cannot be exercised against the bundled relay, because nostr-tools'
 * Negentropy is initiator-only — on receiving an IdList it fires callbacks and
 * emits nothing, so it cannot answer as a relay. End-to-end coverage needs a
 * real NIP-77 relay.
 */

const NPUB = 'npub1abc111111111111111111111111111111111111111111111111abcdef01'
const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)

function makePool(reconcile: any, query: any = vi.fn().mockResolvedValue([])) {
  return {
    reconcileDirect: reconcile,
    getRelays: vi.fn().mockReturnValue({ read: ['wss://default.example.com'], write: [] }),
    query,
    queryDirect: query,
  }
}

const ctx = { activeNpub: NPUB } as any

function run(args: string[], pool: any) {
  return dispatch(args[0], args, makeHelpers(args, 'json'), ctx, pool)
}

describe('req --ids-only', () => {
  let logged: string[]
  beforeEach(() => {
    logged = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logged.push(String(a[0])) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reconciles against an empty local set and prints the ids', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [ID_A, ID_B], localOnlyCount: 0, remoteOnlyCount: 2, truncated: false,
    })
    await run(['req', '--ids-only', '--relay', 'wss://r.example.com', '--kinds', '1'], makePool(reconcile))

    const [relay, local, filter] = reconcile.mock.calls[0]
    expect(relay).toBe('wss://r.example.com')
    expect(local).toEqual([])                 // nothing held locally
    expect(filter).toEqual({ kinds: [1] })
    expect(logged).toEqual([ID_A, ID_B])
  })

  it('falls back to the identity read relay when none is given', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [], localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
    })
    await run(['req', '--ids-only', '--kinds', '1'], makePool(reconcile))
    expect(reconcile.mock.calls[0][0]).toBe('wss://default.example.com')
  })

  it('passes since and until through to the filter', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [], localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
    })
    await run(['req', '--ids-only', '--relay', 'wss://r.example.com', '--since', '100', '--until', '200'], makePool(reconcile))
    expect(reconcile.mock.calls[0][2]).toEqual({ since: 100, until: 200 })
  })

  it('warns on stderr when the result was truncated', async () => {
    const errors: string[] = []
    ;(console.error as any).mockImplementation((...a: unknown[]) => { errors.push(String(a[0])) })
    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [ID_A], localOnlyCount: 0, remoteOnlyCount: 1, truncated: true,
    })
    await run(['req', '--ids-only', '--relay', 'wss://r.example.com'], makePool(reconcile))
    expect(errors.some(e => /truncated/.test(e))).toBe(true)
  })

  it('errors when no relay can be determined', async () => {
    const pool = makePool(vi.fn())
    pool.getRelays = vi.fn().mockReturnValue({ read: [], write: [] })
    await expect(run(['req', '--ids-only'], pool)).rejects.toThrow(/needs? a relay/i)
  })
})

describe('req --only-missing', () => {
  let logged: string[]
  beforeEach(() => {
    logged = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logged.push(String(a[0])) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('sends the local jsonl as the set it already holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-nip77-'))
    const file = join(dir, 'local.jsonl')
    writeFileSync(file, [
      JSON.stringify({ id: ID_A, created_at: 111 }),
      JSON.stringify({ id: ID_B, created_at: 222 }),
    ].join('\n') + '\n')

    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [], localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
    })
    await run(['req', '--only-missing', file, '--relay', 'wss://r.example.com'], makePool(reconcile))

    expect(reconcile.mock.calls[0][1]).toEqual([
      { id: ID_A, createdAt: 111 },
      { id: ID_B, createdAt: 222 },
    ])
  })

  it('fetches and prints only the events it lacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-nip77-'))
    const file = join(dir, 'local.jsonl')
    writeFileSync(file, JSON.stringify({ id: ID_A, created_at: 111 }) + '\n')

    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [ID_B], localOnlyCount: 0, remoteOnlyCount: 1, truncated: false,
    })
    const query = vi.fn().mockResolvedValue([{ id: ID_B, kind: 1, content: 'missing one' }])
    await run(['req', '--only-missing', file, '--relay', 'wss://r.example.com'], makePool(reconcile, query))

    expect(logged).toHaveLength(1)
    expect(JSON.parse(logged[0]).id).toBe(ID_B)
  })

  it('skips the follow-up query when nothing is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-nip77-'))
    const file = join(dir, 'local.jsonl')
    writeFileSync(file, JSON.stringify({ id: ID_A, created_at: 111 }) + '\n')

    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [], localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
    })
    const query = vi.fn().mockResolvedValue([])
    await run(['req', '--only-missing', file, '--relay', 'wss://r.example.com'], makePool(reconcile, query))

    expect(query).not.toHaveBeenCalled()
    expect(logged).toEqual([])
  })

  it('tolerates blank lines in the jsonl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-nip77-'))
    const file = join(dir, 'local.jsonl')
    writeFileSync(file, `${JSON.stringify({ id: ID_A, created_at: 111 })}\n\n\n`)

    const reconcile = vi.fn().mockResolvedValue({
      localOnlyIds: [], remoteOnlyIds: [], localOnlyCount: 0, remoteOnlyCount: 0, truncated: false,
    })
    await run(['req', '--only-missing', file, '--relay', 'wss://r.example.com'], makePool(reconcile))
    expect(reconcile.mock.calls[0][1]).toHaveLength(1)
  })
})
