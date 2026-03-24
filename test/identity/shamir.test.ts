import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleBackupShamir, handleRestoreShamir } from '../../src/identity/shamir.js'

// 32-byte test secret (hex of the test nsec's decoded bytes)
const TEST_SECRET = Buffer.from('c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915', 'hex')

describe('Shamir backup/restore', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bray-shamir-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('handleBackupShamir', () => {
    it('writes N shard files to specified directory', () => {
      const result = handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 3,
        shares: 5,
        outputDir: tempDir,
      })
      expect(result.files.length).toBe(5)
      const files = readdirSync(tempDir)
      expect(files.length).toBe(5)
    })

    it('response contains ONLY file paths, NOT shard content', () => {
      const result = handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 2,
        shares: 3,
        outputDir: tempDir,
      })
      const serialised = JSON.stringify(result)
      // Should contain file paths
      expect(result.files.every(f => f.endsWith('.bray'))).toBe(true)
      // Should NOT contain any word lists or raw data
      expect(serialised).not.toMatch(/abandon|zoo|ability/i) // BIP-39 words
    })

    it('shard files contain BIP-39 word lists', () => {
      handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 2,
        shares: 3,
        outputDir: tempDir,
      })
      const files = readdirSync(tempDir)
      for (const file of files) {
        const content = readFileSync(join(tempDir, file), 'utf-8').trim()
        const words = content.split(' ')
        // Each word should be lowercase alpha
        expect(words.length).toBeGreaterThan(0)
        expect(words.every(w => /^[a-z]+$/.test(w))).toBe(true)
      }
    })

    it('errors if output directory does not exist', () => {
      expect(() => handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 2,
        shares: 3,
        outputDir: '/nonexistent/path/that/does/not/exist',
      })).toThrow()
    })
  })

  describe('handleRestoreShamir', () => {
    it('reads shard files and reconstructs the key', () => {
      handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 2,
        shares: 3,
        outputDir: tempDir,
      })
      const files = readdirSync(tempDir).map(f => join(tempDir, f)).slice(0, 2)
      const restored = handleRestoreShamir({ files, threshold: 2 })
      expect(Buffer.from(restored).toString('hex')).toBe(TEST_SECRET.toString('hex'))
    })

    it('round-trip: backup → restore produces same key', () => {
      handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 3,
        shares: 5,
        outputDir: tempDir,
      })
      // Use exactly threshold (3) shards
      const files = readdirSync(tempDir).map(f => join(tempDir, f)).slice(0, 3)
      const restored = handleRestoreShamir({ files, threshold: 3 })
      expect(Buffer.from(restored).toString('hex')).toBe(TEST_SECRET.toString('hex'))
    })

    it('errors if insufficient shards for threshold', () => {
      handleBackupShamir({
        secret: TEST_SECRET,
        threshold: 3,
        shares: 5,
        outputDir: tempDir,
      })
      const files = readdirSync(tempDir).map(f => join(tempDir, f)).slice(0, 2) // only 2, need 3
      expect(() => handleRestoreShamir({ files, threshold: 3 })).toThrow(/insufficient/i)
    })
  })
})
