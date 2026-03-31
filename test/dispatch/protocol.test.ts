import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildThinkMessage,
  buildBuildMessage,
  buildResultMessage,
  buildAckMessage,
  isDispatchMessage,
  parseDispatchMessage,
  validateRepos,
  checkFreshness,
  type DispatchThink,
  type DispatchBuild,
  type DispatchResult,
  type DispatchAck,
  type DispatchCancel,
  type DispatchStatus,
  type DispatchMessage,
} from '../../src/dispatch/protocol.js'

describe('dispatch protocol', () => {
  describe('buildThinkMessage', () => {
    it('creates a valid claude-think message', () => {
      const msg = buildThinkMessage({
        prompt: 'Analyse the architecture of trott-sdk',
        repos: ['trott-sdk'],
        respond_to: 'npub1abc',
      })
      expect(msg.v).toBe(1)
      expect(msg.type).toBe('claude-think')
      expect(msg.prompt).toBe('Analyse the architecture of trott-sdk')
      expect(msg.repos).toEqual(['trott-sdk'])
      expect(msg.respond_to).toBe('npub1abc')
      expect(msg.id).toMatch(/^think-/)
      expect(msg.ts).toBeDefined()
    })

    it('generates unique IDs across calls', () => {
      const a = buildThinkMessage({ prompt: 'a', repos: ['r'], respond_to: 'x' })
      const b = buildThinkMessage({ prompt: 'b', repos: ['r'], respond_to: 'x' })
      expect(a.id).not.toBe(b.id)
    })

    it('generates an ISO 8601 timestamp', () => {
      const msg = buildThinkMessage({ prompt: 'p', repos: ['r'], respond_to: 'x' })
      expect(() => new Date(msg.ts).toISOString()).not.toThrow()
    })
  })

  describe('buildBuildMessage', () => {
    it('creates a valid claude-build message', () => {
      const msg = buildBuildMessage({
        prompt: 'Add dispatch protocol types',
        repos: ['bray'],
        branch_from: 'main',
        respond_to: 'npub1def',
      })
      expect(msg.v).toBe(1)
      expect(msg.type).toBe('claude-build')
      expect(msg.prompt).toBe('Add dispatch protocol types')
      expect(msg.repos).toEqual(['bray'])
      expect(msg.branch_from).toBe('main')
      expect(msg.respond_to).toBe('npub1def')
      expect(msg.id).toMatch(/^build-/)
      expect(msg.ts).toBeDefined()
    })

    it('generates unique IDs across calls', () => {
      const a = buildBuildMessage({ prompt: 'a', repos: ['r'], branch_from: 'main', respond_to: 'x' })
      const b = buildBuildMessage({ prompt: 'b', repos: ['r'], branch_from: 'main', respond_to: 'x' })
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('buildResultMessage', () => {
    it('creates a think-mode result', () => {
      const msg = buildResultMessage({
        re: 'think-abc123',
        mode: 'think',
        plan: 'Step 1: do this\nStep 2: do that',
        files_read: ['src/index.ts', 'src/config.ts'],
      })
      expect(msg.v).toBe(1)
      expect(msg.type).toBe('claude-result')
      expect(msg.re).toBe('think-abc123')
      expect(msg.mode).toBe('think')
      expect(msg.plan).toBe('Step 1: do this\nStep 2: do that')
      expect(msg.files_read).toEqual(['src/index.ts', 'src/config.ts'])
      expect(msg.ts).toBeDefined()
    })

    it('creates a build-mode result', () => {
      const msg = buildResultMessage({
        re: 'build-xyz789',
        mode: 'build',
        branch: 'feat/dispatch-protocol',
        commits: ['abc1234'],
        tests: { passed: 10, failed: 0 },
        pr: 'https://github.com/forgesworn/bray/pull/42',
      })
      expect(msg.v).toBe(1)
      expect(msg.type).toBe('claude-result')
      expect(msg.mode).toBe('build')
      expect(msg.branch).toBe('feat/dispatch-protocol')
      expect(msg.commits).toEqual(['abc1234'])
      expect(msg.tests).toEqual({ passed: 10, failed: 0 })
      expect(msg.pr).toBe('https://github.com/forgesworn/bray/pull/42')
    })

    it('omits optional fields when not provided', () => {
      const msg = buildResultMessage({ re: 'think-abc', mode: 'think' })
      expect(msg.plan).toBeUndefined()
      expect(msg.files_read).toBeUndefined()
      expect(msg.branch).toBeUndefined()
      expect(msg.commits).toBeUndefined()
      expect(msg.tests).toBeUndefined()
      expect(msg.pr).toBeUndefined()
    })
  })

  describe('buildAckMessage', () => {
    it('creates a valid claude-ack message', () => {
      const msg = buildAckMessage({ re: 'think-abc123' })
      expect(msg.v).toBe(1)
      expect(msg.type).toBe('claude-ack')
      expect(msg.re).toBe('think-abc123')
      expect(msg.ts).toBeDefined()
      expect(msg.note).toBeUndefined()
    })

    it('includes optional note', () => {
      const msg = buildAckMessage({ re: 'build-xyz', note: 'Starting now' })
      expect(msg.note).toBe('Starting now')
    })
  })

  describe('isDispatchMessage', () => {
    it('returns true for valid dispatch messages', () => {
      expect(isDispatchMessage({ v: 1, type: 'claude-think' })).toBe(true)
      expect(isDispatchMessage({ v: 1, type: 'claude-build' })).toBe(true)
      expect(isDispatchMessage({ v: 1, type: 'claude-result' })).toBe(true)
      expect(isDispatchMessage({ v: 1, type: 'claude-ack' })).toBe(true)
      expect(isDispatchMessage({ v: 1, type: 'claude-cancel' })).toBe(true)
      expect(isDispatchMessage({ v: 1, type: 'claude-status' })).toBe(true)
    })

    it('returns false for wrong version', () => {
      expect(isDispatchMessage({ v: 2, type: 'claude-think' })).toBe(false)
    })

    it('returns false for wrong type prefix', () => {
      expect(isDispatchMessage({ v: 1, type: 'nostr-think' })).toBe(false)
    })

    it('returns false for non-objects', () => {
      expect(isDispatchMessage(null)).toBe(false)
      expect(isDispatchMessage(undefined)).toBe(false)
      expect(isDispatchMessage('string')).toBe(false)
      expect(isDispatchMessage(42)).toBe(false)
    })

    it('returns false for missing fields', () => {
      expect(isDispatchMessage({ v: 1 })).toBe(false)
      expect(isDispatchMessage({ type: 'claude-think' })).toBe(false)
      expect(isDispatchMessage({})).toBe(false)
    })
  })

  describe('parseDispatchMessage', () => {
    it('parses a valid JSON dispatch message', () => {
      const think = buildThinkMessage({ prompt: 'test', repos: ['r'], respond_to: 'x' })
      const json = JSON.stringify(think)
      const parsed = parseDispatchMessage(json)
      expect(parsed).toEqual(think)
    })

    it('returns null for invalid JSON', () => {
      expect(parseDispatchMessage('not json')).toBeNull()
    })

    it('returns null for valid JSON that is not a dispatch message', () => {
      expect(parseDispatchMessage('{"hello":"world"}')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseDispatchMessage('')).toBeNull()
    })

    it('returns null for JSON array', () => {
      expect(parseDispatchMessage('[1,2,3]')).toBeNull()
    })
  })

  describe('validateRepos', () => {
    it('accepts valid simple directory names', () => {
      expect(() => validateRepos(['bray', 'trott-sdk', 'trott_devtools'])).not.toThrow()
    })

    it('accepts names with numbers', () => {
      expect(() => validateRepos(['repo123', 'my-repo-2'])).not.toThrow()
    })

    it('rejects paths with slashes', () => {
      expect(() => validateRepos(['foo/bar'])).toThrow()
    })

    it('rejects parent directory traversal', () => {
      expect(() => validateRepos(['..'])).toThrow()
      expect(() => validateRepos(['../secret'])).toThrow()
    })

    it('rejects absolute paths', () => {
      expect(() => validateRepos(['/etc/passwd'])).toThrow()
    })

    it('rejects paths with dots that look like traversal', () => {
      expect(() => validateRepos(['foo..bar'])).toThrow()
    })

    it('rejects empty strings', () => {
      expect(() => validateRepos([''])).toThrow()
    })

    it('rejects empty array', () => {
      expect(() => validateRepos([])).toThrow()
    })

    it('rejects names with spaces', () => {
      expect(() => validateRepos(['my repo'])).toThrow()
    })
  })

  describe('checkFreshness', () => {
    it('accepts a recent timestamp', () => {
      const recent = new Date().toISOString()
      expect(() => checkFreshness(recent)).not.toThrow()
    })

    it('accepts a timestamp just under 4 hours old', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      expect(() => checkFreshness(threeHoursAgo)).not.toThrow()
    })

    it('rejects a timestamp older than 4 hours', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      expect(() => checkFreshness(fiveHoursAgo)).toThrow(/stale/)
    })

    it('rejects exactly 4 hours old', () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      expect(() => checkFreshness(fourHoursAgo)).toThrow(/stale/)
    })

    it('rejects invalid timestamp strings', () => {
      expect(() => checkFreshness('not-a-date')).toThrow()
    })

    it('rejects future timestamps beyond a small tolerance', () => {
      const tenMinutesFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      expect(() => checkFreshness(tenMinutesFuture)).toThrow(/future/)
    })

    it('accepts timestamps slightly in the future (clock skew)', () => {
      const oneMinuteFuture = new Date(Date.now() + 60 * 1000).toISOString()
      expect(() => checkFreshness(oneMinuteFuture)).not.toThrow()
    })
  })

  describe('task ID format', () => {
    it('think IDs use think- prefix with base-36 components', () => {
      const msg = buildThinkMessage({ prompt: 'p', repos: ['r'], respond_to: 'x' })
      expect(msg.id).toMatch(/^think-[a-z0-9]+-[a-z0-9]+$/)
    })

    it('build IDs use build- prefix with base-36 components', () => {
      const msg = buildBuildMessage({ prompt: 'p', repos: ['r'], branch_from: 'main', respond_to: 'x' })
      expect(msg.id).toMatch(/^build-[a-z0-9]+-[a-z0-9]+$/)
    })
  })
})
