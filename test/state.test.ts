import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readStateFile, writeStateFile } from '../src/state.js'

describe('state files', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'bray-state-test-'))
  })

  it('writeStateFile creates file with correct content', () => {
    const data = { abc123: 'def456' }
    writeStateFile('test.json', data, stateDir)
    const raw = readFileSync(join(stateDir, 'test.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual(data)
  })

  it('writeStateFile sets 0600 permissions', () => {
    writeStateFile('perms.json', {}, stateDir)
    const stat = statSync(join(stateDir, 'perms.json'))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('readStateFile returns parsed JSON', () => {
    const data = { key1: ['val1', 'val2'] }
    writeStateFile('read.json', data, stateDir)
    expect(readStateFile('read.json', stateDir)).toEqual(data)
  })

  it('readStateFile returns empty object for missing file', () => {
    expect(readStateFile('missing.json', stateDir)).toEqual({})
  })

  it('readStateFile returns empty object for corrupt JSON', () => {
    writeFileSync(join(stateDir, 'bad.json'), 'not json{{{')
    expect(readStateFile('bad.json', stateDir)).toEqual({})
  })

  it('writeStateFile creates directory if missing', () => {
    const nested = join(stateDir, 'sub', 'dir')
    writeStateFile('nested.json', { ok: true }, nested)
    expect(existsSync(join(nested, 'nested.json'))).toBe(true)
  })

  it('writeStateFile is atomic — no tmp file remains after success', () => {
    writeStateFile('atomic.json', { ok: true }, stateDir)
    const tmpLeftovers = readdirSync(stateDir).filter(f => f.endsWith('.tmp'))
    expect(tmpLeftovers).toEqual([])
    expect(existsSync(join(stateDir, 'atomic.json'))).toBe(true)
  })

  it('writeStateFile preserves prior contents when overwritten', () => {
    writeStateFile('overwrite.json', { v: 1 }, stateDir)
    writeStateFile('overwrite.json', { v: 2 }, stateDir)
    expect(readStateFile('overwrite.json', stateDir)).toEqual({ v: 2 })
    // Permissions retained on the renamed file.
    const stat = statSync(join(stateDir, 'overwrite.json'))
    expect(stat.mode & 0o777).toBe(0o600)
  })
})
