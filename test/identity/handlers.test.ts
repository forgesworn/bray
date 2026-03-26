import { describe, it, expect, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { verifyProof } from 'nsec-tree/proof'
import {
  handleIdentityDerive,
  handleIdentityDerivePersona,
  handleIdentitySwitch,
  handleIdentityList,
  handleIdentityCreate,
  handleIdentityProve,
} from '../../src/identity/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

describe('identity handlers', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  describe('handleIdentityCreate', () => {
    it('generates mnemonic and returns npub (no private key in response)', () => {
      const result = handleIdentityCreate()
      expect(result.npub).toMatch(/^npub1/)
      expect(result.mnemonic).toBeDefined()
      expect(result.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
      // Must NOT contain nsec or hex private key
      expect(JSON.stringify(result)).not.toMatch(/nsec1/)
      expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{64}/)
    })
  })

  describe('handleIdentityDerive', () => {
    it('returns npub + purpose + index', () => {
      const result = handleIdentityDerive(ctx, { purpose: 'messaging', index: 0 })
      expect(result.npub).toMatch(/^npub1/)
      expect(result.purpose).toBe('messaging')
      expect(result.index).toBe(0)
    })

    it('includes setup hint when only master identity exists', () => {
      // Fresh ctx has only master — first derive should trigger hint
      const result = handleIdentityDerive(ctx, { purpose: 'social', index: 0 })
      expect(result.hint).toBeDefined()
      expect(result.hint).toMatch(/identity-setup/)
    })

    it('does not include hint when other derived identities already exist', () => {
      // Derive one first so cache has master + 1 child
      ctx.derive('existing', 0)
      // Now derive another — cache already has entries beyond just master
      const result = handleIdentityDerive(ctx, { purpose: 'messaging', index: 0 })
      expect(result.hint).toBeUndefined()
    })
  })

  describe('handleIdentityDerivePersona', () => {
    it('returns npub + persona name', () => {
      const result = handleIdentityDerivePersona(ctx, { name: 'work', index: 0 })
      expect(result.npub).toMatch(/^npub1/)
      expect(result.personaName).toBe('work')
    })
  })

  describe('handleIdentitySwitch', () => {
    it('switches by persona name and changes active', () => {
      const masterNpub = ctx.activeNpub
      ctx.derivePersona('work', 0)
      const result = handleIdentitySwitch(ctx, { target: 'work' })
      expect(result.npub).not.toBe(masterNpub)
    })

    it('switches by purpose+index', () => {
      const masterNpub = ctx.activeNpub
      ctx.derive('messaging', 0)
      const result = handleIdentitySwitch(ctx, { target: 'messaging', index: 0 })
      expect(result.npub).not.toBe(masterNpub)
    })

    it('switch("master") returns to root', () => {
      const masterNpub = ctx.activeNpub
      ctx.derive('alt', 0)
      handleIdentitySwitch(ctx, { target: 'alt', index: 0 })
      const result = handleIdentitySwitch(ctx, { target: 'master' })
      expect(result.npub).toBe(masterNpub)
    })
  })

  describe('handleIdentityList', () => {
    it('returns array of { npub, purpose, personaName } — NO nsec', () => {
      ctx.derive('messaging', 0)
      ctx.derivePersona('work', 0)
      const result = handleIdentityList(ctx)
      expect(result.length).toBeGreaterThanOrEqual(3)
      for (const entry of result) {
        expect(entry.npub).toMatch(/^npub1/)
        expect(entry).not.toHaveProperty('privateKey')
        expect(entry).not.toHaveProperty('nsec')
      }
      expect(result.some(e => e.purpose === 'master')).toBe(true)
      expect(result.some(e => e.purpose === 'messaging')).toBe(true)
      expect(result.some(e => e.personaName === 'work')).toBe(true)
    })
  })

  describe('handleIdentityProve', () => {
    it('defaults to blind proof', () => {
      ctx.derive('messaging', 0)
      ctx.switch('messaging', 0)
      const proof = handleIdentityProve(ctx, {})
      expect(proof.masterPubkey).toBeDefined()
      expect(proof.childPubkey).toBeDefined()
      expect(proof.signature).toBeDefined()
      // Blind proof: no purpose or index
      expect(proof.purpose).toBeUndefined()
      expect(proof.index).toBeUndefined()
    })

    it('full proof includes purpose and index', () => {
      ctx.derive('messaging', 0)
      ctx.switch('messaging', 0)
      const proof = handleIdentityProve(ctx, { mode: 'full' })
      expect(proof.masterPubkey).toBeDefined()
      expect(proof.childPubkey).toBeDefined()
      expect(proof.purpose).toBeDefined()
      expect(proof.index).toBeDefined()
    })

    it('proof verifies via nsec-tree verifyProof', () => {
      ctx.derive('messaging', 0)
      ctx.switch('messaging', 0)
      const proof = handleIdentityProve(ctx, { mode: 'full' })
      expect(verifyProof(proof)).toBe(true)
    })

    it('response does NOT include any private key material', () => {
      ctx.derive('messaging', 0)
      ctx.switch('messaging', 0)
      const proof = handleIdentityProve(ctx, {})
      const serialised = JSON.stringify(proof)
      expect(serialised).not.toMatch(/nsec1/)
      expect(serialised).not.toMatch(/privateKey/)
    })
  })
})
