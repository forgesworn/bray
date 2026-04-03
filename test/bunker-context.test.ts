import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getPublicKey } from 'nostr-tools/pure'
import { readStateFile } from '../src/state.js'
import { resolveClientKey } from '../src/bunker-context.js'

describe('resolveClientKey', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'bray-client-key-test-'))
  })

  it('uses secret from config when provided', () => {
    const secret = 'a'.repeat(64)
    const sk = resolveClientKey({ pubkey: 'b'.repeat(64), relays: [], secret }, stateDir)
    expect(Buffer.from(sk).toString('hex')).toBe(secret)
  })

  it('generates and persists a new key when none cached', () => {
    const bunkerPk = 'c'.repeat(64)
    const sk = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    expect(sk).toHaveLength(32)

    const stored = readStateFile<Record<string, string>>('client-keys.json', stateDir)
    expect(stored[bunkerPk]).toBe(Buffer.from(sk).toString('hex'))
  })

  it('reuses cached key on second call', () => {
    const bunkerPk = 'd'.repeat(64)
    const sk1 = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    const sk2 = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    expect(Buffer.from(sk1).toString('hex')).toBe(Buffer.from(sk2).toString('hex'))
  })

  it('stores separate keys per bunker pubkey', () => {
    const pk1 = 'e'.repeat(64)
    const pk2 = 'f'.repeat(64)
    const sk1 = resolveClientKey({ pubkey: pk1, relays: [] }, stateDir)
    const sk2 = resolveClientKey({ pubkey: pk2, relays: [] }, stateDir)
    expect(Buffer.from(sk1).toString('hex')).not.toBe(Buffer.from(sk2).toString('hex'))

    const stored = readStateFile<Record<string, string>>('client-keys.json', stateDir)
    expect(Object.keys(stored)).toHaveLength(2)
  })
})
