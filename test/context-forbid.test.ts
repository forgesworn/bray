import { describe, it, expect } from 'vitest'
import { npubEncode } from 'nostr-tools/nip19'
import { getPublicKey } from 'nostr-tools/pure'
import { IdentityContext, resolvePubkeyRef } from '../src/context.js'

// Valid test key pair — generated for testing only
const TEST_HEX = 'c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
const TEST_PUBKEY = getPublicKey(Buffer.from(TEST_HEX, 'hex'))
const TEST_NPUB = npubEncode(TEST_PUBKEY)

const OTHER = 'da19f1cd34beca44be74da4b306d9d1dd86b6343cef94ce22c49c6f59816e5bd'

describe('resolvePubkeyRef', () => {
  it('accepts hex and lowercases it', () => {
    expect(resolvePubkeyRef(TEST_PUBKEY.toUpperCase())).toBe(TEST_PUBKEY)
  })

  it('accepts an npub', () => {
    expect(resolvePubkeyRef(TEST_NPUB)).toBe(TEST_PUBKEY)
  })

  it('trims whitespace, which a comma-separated env var will have', () => {
    expect(resolvePubkeyRef(`  ${TEST_NPUB} `)).toBe(TEST_PUBKEY)
  })

  it('refuses an nsec, and says to treat it as exposed', () => {
    expect(() => resolvePubkeyRef('nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8')).toThrow(
      /PUBLIC key.*exposed/s,
    )
  })

  it('refuses anything it cannot parse rather than ignoring it', () => {
    // A forbidden entry nobody can read must not silently permit everything.
    expect(() => resolvePubkeyRef('not-a-key')).toThrow(/neither an npub nor 64 hex/)
    expect(() => resolvePubkeyRef('')).toThrow(/is empty/)
  })
})

describe('IdentityContext forbidden keys', () => {
  it('constructs normally when the key is on no list', () => {
    const ctx = new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [OTHER] })
    expect(ctx.activeNpub).toBe(TEST_NPUB)
    ctx.destroy()
  })

  it('refuses to construct as a forbidden key, given as hex', () => {
    expect(() => new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [TEST_PUBKEY] })).toThrow(
      /forbidden list/,
    )
  })

  it('refuses to construct as a forbidden key, given as npub', () => {
    expect(() => new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [TEST_NPUB] })).toThrow(
      /forbidden list/,
    )
  })

  it('explains why a principal key on an agent is not merely untidy', () => {
    // The reason the rule exists: same key means the agent IS the principal
    // those checks look for, so it can attest to itself and approve itself.
    expect(() => new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [TEST_NPUB] })).toThrow(
      /approve its own requests/,
    )
  })

  it('names the npub it refused, and nothing secret', () => {
    let message = ''
    try {
      new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [TEST_NPUB] })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain(TEST_NPUB)
    expect(message).not.toContain(TEST_HEX)
  })

  it('checks every entry, not just the first', () => {
    expect(() => new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [OTHER, TEST_NPUB] })).toThrow(
      /forbidden list/,
    )
  })

  it('rejects an unparseable entry at construction', () => {
    expect(() => new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: ['nonsense'] })).toThrow(
      /neither an npub nor 64 hex/,
    )
  })

  it('an empty list changes nothing', () => {
    const ctx = new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [] })
    expect(ctx.activeNpub).toBe(TEST_NPUB)
    ctx.destroy()
  })

  it('guards a derived identity too, not only the master', async () => {
    // The guard sits at activation, so switching is covered by the same code
    // path as startup. A derived key is not the forbidden one, so this
    // proves the switch path still works rather than being blocked outright.
    const ctx = new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [OTHER] })
    const before = ctx.activeNpub
    await ctx.switch('social', 0)
    expect(ctx.activeNpub).not.toBe(before)
    ctx.destroy()
  })

  it('refuses a SWITCH to a forbidden key, not only construction', async () => {
    // The one that matters: a startup-only check is bypassed by
    // identity-switch, which is a tool any driving model can call. Find out
    // what 'social'/0 derives to, forbid exactly that, and try to switch.
    const probe = new IdentityContext(TEST_HEX, 'hex')
    await probe.switch('social', 0)
    const derivedNpub = probe.activeNpub
    probe.destroy()
    expect(derivedNpub).not.toBe(TEST_NPUB)

    const guarded = new IdentityContext(TEST_HEX, 'hex', { forbidPubkeys: [derivedNpub] })
    expect(guarded.activeNpub).toBe(TEST_NPUB)
    await expect(guarded.switch('social', 0)).rejects.toThrow(/forbidden list/)
    // And it is still the master afterwards, not half-switched.
    expect(guarded.activeNpub).toBe(TEST_NPUB)
    guarded.destroy()
  })
})
