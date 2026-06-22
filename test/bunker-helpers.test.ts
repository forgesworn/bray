import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNsecTreeProfileMnemonic, getOrCreateBunkerKey } from '../src/bunker-helpers.js'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('readNsecTreeProfileMnemonic', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bray-prof-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('reads the 12-word mnemonic from an nsec-tree-cli profile file', () => {
    writeFileSync(join(dir, 'master.json'), JSON.stringify({
      name: 'master', root: { type: 'mnemonic-backed', mnemonic: MNEMONIC },
    }))
    expect(readNsecTreeProfileMnemonic('master', dir)).toBe(MNEMONIC)
  })

  it('throws for an nsec-backed profile (no recoverable words)', () => {
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ name: 'x', root: { type: 'nsec-backed', nsec: 'nsec1x' } }))
    expect(() => readNsecTreeProfileMnemonic('x', dir)).toThrow(/mnemonic/i)
  })

  it('throws for a missing profile', () => {
    expect(() => readNsecTreeProfileMnemonic('nope', dir)).toThrow()
  })
})

describe('getOrCreateBunkerKey', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bray-key-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates a 64-char hex key for a label', () => {
    expect(getOrCreateBunkerKey('magazine', dir)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the SAME key on subsequent calls (stable bunker:// across restarts)', () => {
    const a = getOrCreateBunkerKey('magazine', dir)
    const b = getOrCreateBunkerKey('magazine', dir)
    expect(b).toBe(a)
  })

  it('returns different keys for different labels', () => {
    expect(getOrCreateBunkerKey('magazine', dir)).not.toBe(getOrCreateBunkerKey('meme', dir))
  })
})
