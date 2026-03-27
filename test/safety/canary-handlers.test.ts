import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import {
  handleCanarySessionCreate,
  handleCanarySessionCurrent,
  handleCanarySessionVerify,
  handleCanaryGroupCreate,
  handleCanaryGroupJoin,
  handleCanaryGroupCurrent,
  handleCanaryGroupVerify,
  handleCanaryGroupMembers,
  handleCanaryBeaconCreate,
  handleCanaryBeaconCheck,
  handleCanaryDuressSignal,
  handleCanaryDuressDetect,
  _resetStores,
} from '../../src/safety/canary-handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('canary handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    _resetStores()
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  afterEach(() => {
    _resetStores()
    ctx.destroy()
  })

  // -------------------------------------------------------------------------
  // Session handlers
  // -------------------------------------------------------------------------

  describe('handleCanarySessionCreate', () => {
    it('creates a session and returns a word', () => {
      const result = handleCanarySessionCreate(ctx, {
        namespace: 'dispatch',
        roles: ['caller', 'agent'],
        myRole: 'agent',
      })
      expect(result.sessionId).toMatch(/^session-/)
      expect(result.namespace).toBe('dispatch')
      expect(result.myRole).toBe('agent')
      expect(typeof result.myToken).toBe('string')
      expect(result.myToken.length).toBeGreaterThan(0)
    })

    it('accepts a call preset', () => {
      const result = handleCanarySessionCreate(ctx, {
        namespace: 'aviva',
        roles: ['caller', 'agent'],
        myRole: 'caller',
        preset: 'call',
      })
      expect(result.preset).toBe('call')
      expect(result.sessionId).toBeDefined()
    })

    it('accepts a handoff preset with fixed counter', () => {
      const result = handleCanarySessionCreate(ctx, {
        namespace: 'rideshare',
        roles: ['rider', 'driver'],
        myRole: 'rider',
        preset: 'handoff',
        counter: 42,
      })
      expect(result.preset).toBe('handoff')
      expect(result.myToken.length).toBeGreaterThan(0)
    })

    it('generates unique session IDs', () => {
      const r1 = handleCanarySessionCreate(ctx, {
        namespace: 'a',
        roles: ['x', 'y'],
        myRole: 'x',
      })
      const r2 = handleCanarySessionCreate(ctx, {
        namespace: 'b',
        roles: ['x', 'y'],
        myRole: 'x',
      })
      expect(r1.sessionId).not.toBe(r2.sessionId)
    })

    it('produces deterministic tokens from the same identity', () => {
      const r1 = handleCanarySessionCreate(ctx, {
        namespace: 'det',
        roles: ['a', 'b'],
        myRole: 'a',
        preset: 'handoff',
        counter: 1,
      })
      // Create a fresh context with the same nsec
      const ctx2 = new IdentityContext(TEST_NSEC, 'nsec')
      const r2 = handleCanarySessionCreate(ctx2, {
        namespace: 'det',
        roles: ['a', 'b'],
        myRole: 'a',
        preset: 'handoff',
        counter: 1,
      })
      expect(r1.myToken).toBe(r2.myToken)
      ctx2.destroy()
    })
  })

  describe('handleCanarySessionCurrent', () => {
    it('returns current tokens for an existing session', () => {
      const created = handleCanarySessionCreate(ctx, {
        namespace: 'test',
        roles: ['alice', 'bob'],
        myRole: 'alice',
        preset: 'handoff',
        counter: 5,
      })
      const current = handleCanarySessionCurrent({ sessionId: created.sessionId })
      expect(current.sessionId).toBe(created.sessionId)
      expect(current.myToken).toBe(created.myToken)
      expect(typeof current.theirToken).toBe('string')
      expect(current.theirToken.length).toBeGreaterThan(0)
      expect(typeof current.counter).toBe('number')
    })

    it('myToken and theirToken are different', () => {
      const created = handleCanarySessionCreate(ctx, {
        namespace: 'diff',
        roles: ['alice', 'bob'],
        myRole: 'alice',
        preset: 'handoff',
        counter: 1,
      })
      const current = handleCanarySessionCurrent({ sessionId: created.sessionId })
      expect(current.myToken).not.toBe(current.theirToken)
    })

    it('throws for unknown session ID', () => {
      expect(() => handleCanarySessionCurrent({ sessionId: 'session-nonexistent' }))
        .toThrow(/Session not found/)
    })
  })

  describe('handleCanarySessionVerify', () => {
    it('verifies correct spoken word as valid', () => {
      const created = handleCanarySessionCreate(ctx, {
        namespace: 'verify',
        roles: ['alice', 'bob'],
        myRole: 'alice',
        preset: 'handoff',
        counter: 10,
      })
      // Get the other party's token — that is what they would speak
      const current = handleCanarySessionCurrent({ sessionId: created.sessionId })
      const result = handleCanarySessionVerify({
        sessionId: created.sessionId,
        spokenWord: current.theirToken,
      })
      expect(result.sessionId).toBe(created.sessionId)
      expect(result.status).toBe('valid')
    })

    it('rejects wrong spoken word', () => {
      const created = handleCanarySessionCreate(ctx, {
        namespace: 'reject',
        roles: ['a', 'b'],
        myRole: 'a',
        preset: 'handoff',
        counter: 1,
      })
      const result = handleCanarySessionVerify({
        sessionId: created.sessionId,
        spokenWord: 'totally-wrong-word-xyz',
      })
      expect(result.status).toBe('invalid')
    })

    it('throws for unknown session ID', () => {
      expect(() => handleCanarySessionVerify({ sessionId: 'session-gone', spokenWord: 'test' }))
        .toThrow(/Session not found/)
    })
  })

  // -------------------------------------------------------------------------
  // Group handlers
  // -------------------------------------------------------------------------

  describe('handleCanaryGroupCreate', () => {
    it('creates a group with a verification word', () => {
      const otherPubkey = 'a'.repeat(64)
      const result = handleCanaryGroupCreate(ctx, {
        name: 'Test Group',
        members: [otherPubkey],
      })
      expect(result.groupId).toMatch(/^group-/)
      expect(result.name).toBe('Test Group')
      expect(result.memberCount).toBeGreaterThanOrEqual(2) // creator auto-added
      expect(typeof result.currentWord).toBe('string')
      expect(result.currentWord.length).toBeGreaterThan(0)
    })

    it('auto-adds the creator to members', () => {
      const otherPubkey = 'b'.repeat(64)
      const result = handleCanaryGroupCreate(ctx, {
        name: 'Auto-add Test',
        members: [otherPubkey],
      })
      // Creator should be in the members list
      const members = handleCanaryGroupMembers({ groupId: result.groupId })
      expect(members.members).toContain(ctx.activePublicKeyHex)
    })

    it('does not duplicate creator if already in members', () => {
      const result = handleCanaryGroupCreate(ctx, {
        name: 'No Dup',
        members: [ctx.activePublicKeyHex, 'c'.repeat(64)],
      })
      const members = handleCanaryGroupMembers({ groupId: result.groupId })
      const creatorOccurrences = members.members.filter((m: string) => m === ctx.activePublicKeyHex)
      expect(creatorOccurrences.length).toBe(1)
    })

    it('accepts a preset', () => {
      const result = handleCanaryGroupCreate(ctx, {
        name: 'Family',
        members: ['d'.repeat(64)],
        preset: 'family',
      })
      expect(result.preset).toBe('family')
      expect(result.groupId).toBeDefined()
    })

    it('generates unique group IDs', () => {
      const r1 = handleCanaryGroupCreate(ctx, { name: 'A', members: ['a'.repeat(64)] })
      const r2 = handleCanaryGroupCreate(ctx, { name: 'B', members: ['b'.repeat(64)] })
      expect(r1.groupId).not.toBe(r2.groupId)
    })
  })

  describe('handleCanaryGroupJoin', () => {
    it('joins a group with a shared seed', () => {
      // First create a group to get a valid seed structure
      const created = handleCanaryGroupCreate(ctx, {
        name: 'Joinable',
        members: [ctx.activePublicKeyHex, 'e'.repeat(64)],
      })

      // Get the seed from the group's current state via internal access
      // For testing, we use a known valid hex seed
      const validSeed = 'f'.repeat(64)
      const result = handleCanaryGroupJoin(ctx, {
        groupId: 'joined-1',
        seed: validSeed,
        name: 'Joinable',
        members: [ctx.activePublicKeyHex, 'e'.repeat(64)],
      })
      expect(result.groupId).toBe('joined-1')
      expect(result.name).toBe('Joinable')
      expect(result.memberCount).toBeGreaterThanOrEqual(2)
      expect(typeof result.currentWord).toBe('string')
    })

    it('auto-generates groupId if empty', () => {
      const result = handleCanaryGroupJoin(ctx, {
        groupId: '',
        seed: 'a'.repeat(64),
        name: 'Auto ID',
        members: [ctx.activePublicKeyHex],
      })
      expect(result.groupId).toMatch(/^group-/)
    })

    it('rejects invalid seed format', () => {
      expect(() => handleCanaryGroupJoin(ctx, {
        groupId: '',
        seed: 'not-valid-hex',
        name: 'Bad Seed',
        members: [ctx.activePublicKeyHex],
      })).toThrow(/Invalid seed/)
    })

    it('auto-adds joiner to members if missing', () => {
      const otherPubkey = 'a'.repeat(64)
      const result = handleCanaryGroupJoin(ctx, {
        groupId: '',
        seed: 'b'.repeat(64),
        name: 'Join Test',
        members: [otherPubkey],
      })
      const members = handleCanaryGroupMembers({ groupId: result.groupId })
      expect(members.members).toContain(ctx.activePublicKeyHex)
    })
  })

  describe('handleCanaryGroupCurrent', () => {
    it('returns current word and counter', () => {
      const created = handleCanaryGroupCreate(ctx, {
        name: 'Current Test',
        members: ['a'.repeat(64)],
      })
      const current = handleCanaryGroupCurrent({ groupId: created.groupId })
      expect(current.groupId).toBe(created.groupId)
      expect(current.name).toBe('Current Test')
      expect(typeof current.currentWord).toBe('string')
      expect(typeof current.counter).toBe('number')
    })

    it('throws for unknown group ID', () => {
      expect(() => handleCanaryGroupCurrent({ groupId: 'group-nonexistent' }))
        .toThrow(/Group not found/)
    })
  })

  describe('handleCanaryGroupVerify', () => {
    it('verifies correct word as verified', () => {
      const created = handleCanaryGroupCreate(ctx, {
        name: 'Verify Group',
        members: ['a'.repeat(64)],
      })
      const current = handleCanaryGroupCurrent({ groupId: created.groupId })
      const result = handleCanaryGroupVerify({
        groupId: created.groupId,
        spokenWord: current.currentWord,
      })
      expect(result.groupId).toBe(created.groupId)
      expect(result.status).toBe('verified')
    })

    it('rejects wrong word as failed', () => {
      const created = handleCanaryGroupCreate(ctx, {
        name: 'Reject Test',
        members: ['a'.repeat(64)],
      })
      const result = handleCanaryGroupVerify({
        groupId: created.groupId,
        spokenWord: 'completely-wrong-word-xyz',
      })
      expect(result.status).toBe('failed')
    })

    it('throws for unknown group ID', () => {
      expect(() => handleCanaryGroupVerify({ groupId: 'group-gone', spokenWord: 'test' }))
        .toThrow(/Group not found/)
    })
  })

  describe('handleCanaryGroupMembers', () => {
    it('lists members and admins', () => {
      const created = handleCanaryGroupCreate(ctx, {
        name: 'Members Test',
        members: ['a'.repeat(64), 'b'.repeat(64)],
      })
      const result = handleCanaryGroupMembers({ groupId: created.groupId })
      expect(result.groupId).toBe(created.groupId)
      expect(result.name).toBe('Members Test')
      expect(Array.isArray(result.members)).toBe(true)
      expect(result.memberCount).toBeGreaterThanOrEqual(3) // creator + 2 members
      expect(Array.isArray(result.admins)).toBe(true)
    })

    it('throws for unknown group ID', () => {
      expect(() => handleCanaryGroupMembers({ groupId: 'group-missing' }))
        .toThrow(/Group not found/)
    })
  })

  // -------------------------------------------------------------------------
  // Beacon handlers
  // -------------------------------------------------------------------------

  describe('handleCanaryBeaconCreate', () => {
    it('creates an encrypted beacon', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Beacon Group',
        members: ['a'.repeat(64)],
      })
      const result = await handleCanaryBeaconCreate({
        groupId: group.groupId,
        geohash: 'gcpuuz',
        precision: 6,
      })
      expect(result.beaconId).toMatch(/^beacon-/)
      expect(result.groupId).toBe(group.groupId)
      expect(typeof result.encrypted).toBe('string')
      expect(result.encrypted.length).toBeGreaterThan(0)
    })

    it('throws for unknown group ID', async () => {
      await expect(handleCanaryBeaconCreate({
        groupId: 'group-nonexistent',
        geohash: 'gcpuuz',
        precision: 6,
      })).rejects.toThrow(/Group not found/)
    })

    it('generates unique beacon IDs', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Multi Beacon',
        members: ['a'.repeat(64)],
      })
      const r1 = await handleCanaryBeaconCreate({ groupId: group.groupId, geohash: 'gcpuuz', precision: 6 })
      const r2 = await handleCanaryBeaconCreate({ groupId: group.groupId, geohash: 'u33dc0', precision: 6 })
      expect(r1.beaconId).not.toBe(r2.beaconId)
    })
  })

  describe('handleCanaryBeaconCheck', () => {
    it('checks a beacon by beaconId and reports alive', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Check Group',
        members: ['a'.repeat(64)],
      })
      const beacon = await handleCanaryBeaconCreate({
        groupId: group.groupId,
        geohash: 'gcpuuz',
        precision: 6,
      })
      const result = await handleCanaryBeaconCheck({ beaconId: beacon.beaconId })
      expect(result.status).toBe('alive')
      expect(result.beaconId).toBe(beacon.beaconId)
      expect(result.groupId).toBe(group.groupId)
      expect(result.payload).toBeDefined()
      expect(result.payload!.geohash).toBe('gcpuuz')
      expect(result.payload!.precision).toBe(6)
      expect(typeof result.age).toBe('number')
    })

    it('decrypts a beacon by groupId + encrypted content', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Decrypt Group',
        members: ['a'.repeat(64)],
      })
      const beacon = await handleCanaryBeaconCreate({
        groupId: group.groupId,
        geohash: 'u33dc0',
        precision: 6,
      })
      const result = await handleCanaryBeaconCheck({
        groupId: group.groupId,
        encrypted: beacon.encrypted,
      })
      expect(result.status).toBe('alive')
      expect(result.payload).toBeDefined()
      expect(result.payload!.geohash).toBe('u33dc0')
    })

    it('throws for unknown beacon ID', async () => {
      await expect(handleCanaryBeaconCheck({ beaconId: 'beacon-nonexistent' }))
        .rejects.toThrow(/Beacon not found/)
    })

    it('throws when neither beaconId nor groupId+encrypted provided', async () => {
      await expect(handleCanaryBeaconCheck({}))
        .rejects.toThrow(/Provide either/)
    })
  })

  // -------------------------------------------------------------------------
  // Duress handlers
  // -------------------------------------------------------------------------

  describe('handleCanaryDuressSignal', () => {
    it('generates a duress word and encrypted alert', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Duress Group',
        members: [ctx.activePublicKeyHex, 'a'.repeat(64)],
      })
      const result = await handleCanaryDuressSignal(ctx, {
        groupId: group.groupId,
      })
      expect(result.groupId).toBe(group.groupId)
      expect(typeof result.duressWord).toBe('string')
      expect(result.duressWord.length).toBeGreaterThan(0)
      expect(typeof result.encrypted).toBe('string')
      expect(result.encrypted.length).toBeGreaterThan(0)
    })

    it('duress word differs from normal verification word', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Duress Diff',
        members: [ctx.activePublicKeyHex, 'b'.repeat(64)],
      })
      const current = handleCanaryGroupCurrent({ groupId: group.groupId })
      const duress = await handleCanaryDuressSignal(ctx, {
        groupId: group.groupId,
      })
      expect(duress.duressWord).not.toBe(current.currentWord)
    })

    it('includes location in duress alert when provided', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Location Duress',
        members: [ctx.activePublicKeyHex, 'c'.repeat(64)],
      })
      const result = await handleCanaryDuressSignal(ctx, {
        groupId: group.groupId,
        geohash: 'gcpuuz',
        precision: 6,
        locationSource: 'beacon',
      })
      // The encrypted payload contains location info — we just verify it produced output
      expect(result.encrypted.length).toBeGreaterThan(0)
    })

    it('throws for unknown group ID', async () => {
      await expect(handleCanaryDuressSignal(ctx, { groupId: 'group-nonexistent' }))
        .rejects.toThrow(/Group not found/)
    })
  })

  describe('handleCanaryDuressDetect', () => {
    it('detects a duress word as isDuress=true', async () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Detect Group',
        members: [ctx.activePublicKeyHex, 'a'.repeat(64)],
      })
      // Get the duress word for the active identity
      const duress = await handleCanaryDuressSignal(ctx, {
        groupId: group.groupId,
      })
      const result = handleCanaryDuressDetect({
        groupId: group.groupId,
        spokenWord: duress.duressWord,
      })
      expect(result.groupId).toBe(group.groupId)
      expect(result.isDuress).toBe(true)
      expect(result.members).toBeDefined()
      expect(result.members!.length).toBeGreaterThan(0)
    })

    it('does not flag normal verification word as duress', () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Normal Word',
        members: [ctx.activePublicKeyHex, 'b'.repeat(64)],
      })
      const current = handleCanaryGroupCurrent({ groupId: group.groupId })
      const result = handleCanaryDuressDetect({
        groupId: group.groupId,
        spokenWord: current.currentWord,
      })
      expect(result.isDuress).toBe(false)
    })

    it('does not flag random word as duress', () => {
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Random Word',
        members: [ctx.activePublicKeyHex, 'c'.repeat(64)],
      })
      const result = handleCanaryDuressDetect({
        groupId: group.groupId,
        spokenWord: 'totally-random-xyz',
      })
      expect(result.isDuress).toBe(false)
    })

    it('throws for unknown group ID', () => {
      expect(() => handleCanaryDuressDetect({ groupId: 'group-gone', spokenWord: 'test' }))
        .toThrow(/Group not found/)
    })
  })

  // -------------------------------------------------------------------------
  // Store reset
  // -------------------------------------------------------------------------

  describe('_resetStores', () => {
    it('clears all sessions, groups, and beacons', async () => {
      // Create one of each
      handleCanarySessionCreate(ctx, {
        namespace: 'reset',
        roles: ['a', 'b'],
        myRole: 'a',
      })
      const group = handleCanaryGroupCreate(ctx, {
        name: 'Reset Group',
        members: ['a'.repeat(64)],
      })
      await handleCanaryBeaconCreate({
        groupId: group.groupId,
        geohash: 'gcpuuz',
        precision: 6,
      })

      // Reset
      _resetStores()

      // All lookups should now fail
      expect(() => handleCanarySessionCurrent({ sessionId: 'session-1' }))
        .toThrow(/Session not found/)
      expect(() => handleCanaryGroupCurrent({ groupId: 'group-2' }))
        .toThrow(/Group not found/)
      await expect(handleCanaryBeaconCheck({ beaconId: 'beacon-3' }))
        .rejects.toThrow(/Beacon not found/)
    })

    it('resets ID counter so IDs restart', () => {
      handleCanaryGroupCreate(ctx, { name: 'A', members: ['a'.repeat(64)] })
      _resetStores()
      const result = handleCanaryGroupCreate(ctx, { name: 'B', members: ['b'.repeat(64)] })
      // After reset, the counter restarts so IDs begin from 1 again
      expect(result.groupId).toBe('group-1')
    })
  })
})
