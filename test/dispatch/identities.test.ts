import { describe, it, expect } from 'vitest'
import { parseIdentities, loadIdentities } from '../../src/dispatch/identities.js'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const VALID_HEX = 'da19f1cd34beca44be74da4b306d9d1dd86b6343cef94ce22c49c6f59816e5bd'
const VALID_HEX_2 = 'a4b755e12fdffc7b3a639eba9bcece3d732f1d8d0496a0def355b8ca40e40ea8'

const FULL_TABLE = `
| Name | Hex Pubkey | npub (reference) | Role | Added |
|------|-----------|-------------------|------|-------|
| Darren | \`${VALID_HEX}\` | \`npub1mgvlr...\` | founder | 2026-03-31 |
| alice | \`${VALID_HEX_2}\` | \`npub15jm4t...\` | demo | 2026-03-31 |
`

describe('parseIdentities', () => {
  it('returns empty map for empty input', () => {
    const result = parseIdentities('')
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })

  it('returns empty map for whitespace-only input', () => {
    expect(parseIdentities('   \n\n  ').size).toBe(0)
  })

  it('parses a full markdown table', () => {
    const map = parseIdentities(FULL_TABLE)
    expect(map.size).toBe(2)
    expect(map.get('darren')).toBe(VALID_HEX)
    expect(map.get('alice')).toBe(VALID_HEX_2)
  })

  it('normalises names to lowercase', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
| BOB | \`${VALID_HEX}\` | \`npub1...\` | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.has('bob')).toBe(true)
    expect(map.has('BOB')).toBe(false)
  })

  it('skips header and separator rows', () => {
    const map = parseIdentities(FULL_TABLE)
    expect(map.has('name')).toBe(false)
    expect(map.has('---')).toBe(false)
  })

  it('rejects hex pubkeys shorter than 64 characters', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
| short | \`abcdef1234\` | \`npub1...\` | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.size).toBe(0)
  })

  it('rejects hex pubkeys longer than 64 characters', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
| long | \`${'a'.repeat(66)}\` | \`npub1...\` | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.size).toBe(0)
  })

  it('rejects non-hex characters in pubkey', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
| bad | \`${'g'.repeat(64)}\` | \`npub1...\` | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.size).toBe(0)
  })

  it('handles pubkeys without backtick wrapping', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
| plain | ${VALID_HEX} | npub1... | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.get('plain')).toBe(VALID_HEX)
  })

  it('skips rows with empty name', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
|  | \`${VALID_HEX}\` | \`npub1...\` | test | 2026-03-31 |
`
    const map = parseIdentities(table)
    expect(map.size).toBe(0)
  })

  it('handles table with only header and separator', () => {
    const table = `
| Name | Hex Pubkey | npub | Role | Added |
|------|-----------|------|------|-------|
`
    const map = parseIdentities(table)
    expect(map.size).toBe(0)
  })
})

describe('loadIdentities', () => {
  const tmpDir = join(tmpdir(), 'bray-identities-test')
  const tmpFile = join(tmpDir, 'identities.md')

  it('loads and parses a file from disk', () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(tmpFile, FULL_TABLE, 'utf-8')
    try {
      const map = loadIdentities(tmpFile)
      expect(map.size).toBe(2)
      expect(map.get('darren')).toBe(VALID_HEX)
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('throws on missing file', () => {
    expect(() => loadIdentities('/nonexistent/path/identities.md')).toThrow()
  })
})
