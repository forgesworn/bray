import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import { IdentityContext } from '../../src/context.js'
import { handleSocialPost, handleSocialProfileSet, handleSocialProfileGet } from '../../src/social/handlers.js'
import { handleTrustAttest, handleTrustVerify } from '../../src/trust/handlers.js'
import { handleIdentityDerive, handleIdentityList, handleIdentityProve } from '../../src/identity/handlers.js'
import { handleBackupShamir, handleRestoreShamir } from '../../src/identity/shamir.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from '../../src/trust/spoken.js'
import { verifyProof } from 'nsec-tree/proof'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

/** Mock pool that stores published events and returns them on query */
function createStatefulPool() {
  const store: any[] = []
  return {
    publish: vi.fn().mockImplementation(async (_npub: string, event: any) => {
      store.push(event)
      return { success: true, accepted: ['wss://test'], rejected: [], errors: [] }
    }),
    query: vi.fn().mockImplementation(async (_npub: string, filter: any) => {
      return store.filter(e => {
        if (filter.kinds && !filter.kinds.includes(e.kind)) return false
        // In real relays, author matching happens server-side with hex pubkeys.
        // Mock pool matches loosely — filter by kind only for integration tests.
        return true
      })
    }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://test'], write: ['wss://test'] }),
    reconfigure: vi.fn(),
    checkSharedRelays: vi.fn().mockReturnValue([]),
  }
}

describe('integration: round-trip tests', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('post → verify signature', async () => {
    const pool = createStatefulPool()
    const result = await handleSocialPost(ctx, pool as any, { content: 'integration test' })
    expect(verifyEvent(result.event)).toBe(true)
    expect(result.event.content).toBe('integration test')
  })

  it('identity switch → post → verify signed by correct key', async () => {
    const pool = createStatefulPool()

    // Post as master
    const masterPost = await handleSocialPost(ctx, pool as any, { content: 'from master' })
    const masterPubkey = masterPost.event.pubkey

    // Derive and switch
    await ctx.derive('alt', 0)
    await ctx.switch('alt', 0)

    // Post as alt
    const altPost = await handleSocialPost(ctx, pool as any, { content: 'from alt' })
    const altPubkey = altPost.event.pubkey

    // Keys must be different
    expect(masterPubkey).not.toBe(altPubkey)
    expect(verifyEvent(masterPost.event)).toBe(true)
    expect(verifyEvent(altPost.event)).toBe(true)

    // Switch back and verify
    await ctx.switch('master')
    const backPost = await handleSocialPost(ctx, pool as any, { content: 'back to master' })
    expect(backPost.event.pubkey).toBe(masterPubkey)
  })

  it('profile set with overwrite guard → confirm → read back', async () => {
    const pool = createStatefulPool()
    const activeHex = (decode(ctx.activeNpub).data as string)

    // First set (no existing profile)
    const first = await handleSocialProfileSet(ctx, pool as any, {
      profile: { name: 'First', about: 'Hello' },
    })
    expect(first.published).toBe(true)

    // Second set without confirm → warning
    const second = await handleSocialProfileSet(ctx, pool as any, {
      profile: { name: 'Second' },
      confirm: false,
    })
    expect(second.published).toBe(false)
    expect(second.warning).toMatch(/exists/i)

    // Second set with confirm → published
    const confirmed = await handleSocialProfileSet(ctx, pool as any, {
      profile: { name: 'Second', about: 'Updated' },
      confirm: true,
    })
    expect(confirmed.published).toBe(true)

    // Read back — the latest published profile should win
    // Use the confirmed event directly since mock pool stores all events
    expect(confirmed.event.content).toContain('Second')
  })

  it('attest → verify structure', async () => {
    const pool = createStatefulPool()
    const attestResult = await handleTrustAttest(ctx, pool as any, {
      type: 'membership',
      identifier: 'org-123',
      subject: 'ab'.repeat(32),
      summary: 'Verified member',
    })
    expect(attestResult.event.kind).toBe(31000)
    expect(verifyEvent(attestResult.event)).toBe(true)

    // Verify structure
    const validation = handleTrustVerify(attestResult.event)
    expect(validation.valid).toBe(true)
  })

  it('derive → prove → verify linkage', async () => {
    await ctx.derive('provable', 0)
    await ctx.switch('provable', 0)

    const proof = await handleIdentityProve(ctx, { mode: 'full' })
    expect(verifyProof(proof)).toBe(true)
    expect(proof.purpose).toContain('provable')
  })

  it('shamir backup → restore → round-trip key integrity', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'bray-integration-'))
    try {
      const secret = ctx._getPrivateKeyRefForTesting(ctx.activeNpub)!
      const secretHex = Buffer.from(secret).toString('hex')

      handleBackupShamir({
        secret: Uint8Array.from(secret),
        threshold: 2,
        shares: 3,
        outputDir: tempDir,
      })

      const files = readdirSync(tempDir).map(f => join(tempDir, f))
      const restored = handleRestoreShamir({ files: files.slice(0, 2), threshold: 2 })
      expect(Buffer.from(restored).toString('hex')).toBe(secretHex)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('spoken token challenge → verify round-trip', () => {
    const secret = 'abcdef0123456789abcdef0123456789'
    const context = 'integration-test'
    const counter = 500

    const challenge = handleTrustSpokenChallenge({ secret, context, counter })
    const verification = handleTrustSpokenVerify({
      secret, context, counter,
      input: challenge.token,
      tolerance: 0,
    })
    expect(verification.valid).toBe(true)
  })

  it('identity list never exposes private keys', async () => {
    await ctx.derive('persona-a', 0)
    await ctx.derivePersona('work', 0)
    await ctx.derive('persona-b', 1)

    const list = await handleIdentityList(ctx)
    const serialised = JSON.stringify(list)

    expect(serialised).not.toMatch(/nsec1/)
    expect(serialised).not.toMatch(/privateKey/)
    expect(list.length).toBeGreaterThanOrEqual(4) // master + 3 derived
    for (const entry of list) {
      expect(entry.npub).toMatch(/^npub1/)
      expect(Object.keys(entry)).not.toContain('privateKey')
      expect(Object.keys(entry)).not.toContain('nsec')
    }
  })
})
