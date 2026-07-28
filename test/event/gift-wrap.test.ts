import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { handleGiftWrap, handleGiftUnwrap } from '../../src/event/gift-wrap.js'
import type { SigningContext } from '../../src/signing-context.js'

/** A SigningContext backed by a local key, matching what IdentityContext provides. */
function makeCtx(sk = generateSecretKey()): SigningContext {
  const pk = getPublicKey(sk)
  return {
    activePublicKeyHex: pk,
    activeNpub: `npub-${pk.slice(0, 8)}`,
    getSigningFunction: () => async (t: any) => finalizeEvent(t, sk) as any,
    nip44Encrypt: async (recipient: string, plaintext: string) =>
      encrypt(plaintext, getConversationKey(sk, recipient)),
    nip44Decrypt: async (sender: string, ciphertext: string) =>
      decrypt(ciphertext, getConversationKey(sk, sender)),
    listIdentities: async () => [],
    destroy: () => {},
  } as unknown as SigningContext
}

describe('handleGiftWrap', () => {
  it('produces a kind 1059 wrap p-tagged to the recipient', async () => {
    const alice = makeCtx()
    const bobSk = generateSecretKey()
    const bob = getPublicKey(bobSk)

    const { wrap, recipient } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'hidden' },
      recipientPubkey: bob,
    })

    expect(wrap.kind).toBe(1059)
    expect(wrap.tags).toContainEqual(['p', bob])
    expect(recipient).toBe(bob)
  })

  it('signs the wrap with a throwaway key, not the sender', async () => {
    const alice = makeCtx()
    const bob = getPublicKey(generateSecretKey())
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'hidden' },
      recipientPubkey: bob,
    })
    // The whole point of NIP-59: nothing public ties the wrap to the sender
    expect(wrap.pubkey).not.toBe(alice.activePublicKeyHex)
  })

  it('leaks neither the content nor the sender in the wrap', async () => {
    const alice = makeCtx()
    const bob = getPublicKey(generateSecretKey())
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'a very secret message' },
      recipientPubkey: bob,
    })
    const serialised = JSON.stringify(wrap)
    expect(serialised).not.toContain('a very secret message')
    expect(serialised).not.toContain(alice.activePublicKeyHex)
  })

  it('backdates the wrap, per NIP-59', async () => {
    const alice = makeCtx()
    const bob = getPublicKey(generateSecretKey())
    const now = Math.floor(Date.now() / 1000)
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'x' },
      recipientPubkey: bob,
    })
    expect(wrap.created_at).toBeLessThanOrEqual(now)
    expect(wrap.created_at).toBeGreaterThan(now - 2 * 24 * 60 * 60 - 60)
  })

  it('rejects a malformed recipient pubkey', async () => {
    const alice = makeCtx()
    await expect(handleGiftWrap(alice, {
      event: { kind: 1, content: 'x' },
      recipientPubkey: 'nope',
    })).rejects.toThrow(/64-character hex/)
  })
})

describe('round trip', () => {
  it('the recipient recovers the original rumor', async () => {
    const aliceSk = generateSecretKey()
    const alice = makeCtx(aliceSk)
    const bobSk = generateSecretKey()
    const bob = makeCtx(bobSk)

    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'meet at noon', tags: [['t', 'plans']] },
      recipientPubkey: bob.activePublicKeyHex,
    })

    const opened = await handleGiftUnwrap(bob, { event: wrap })
    expect(opened.rumor.content).toBe('meet at noon')
    expect(opened.rumor.kind).toBe(1)
    expect(opened.rumor.tags).toContainEqual(['t', 'plans'])
    expect(opened.sender).toBe(alice.activePublicKeyHex)
    expect(opened.senderMatchesRumor).toBe(true)
  })

  it('carries arbitrary kinds, not just DMs', async () => {
    const alice = makeCtx()
    const bob = makeCtx()
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 30023, content: '# draft', tags: [['d', 'secret-article']] },
      recipientPubkey: bob.activePublicKeyHex,
    })
    const opened = await handleGiftUnwrap(bob, { event: wrap })
    expect(opened.rumor.kind).toBe(30023)
    expect(opened.rumor.tags).toContainEqual(['d', 'secret-article'])
  })

  it('preserves an explicit created_at on the rumor', async () => {
    const alice = makeCtx()
    const bob = makeCtx()
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'x', created_at: 1_700_000_000 },
      recipientPubkey: bob.activePublicKeyHex,
    })
    const opened = await handleGiftUnwrap(bob, { event: wrap })
    expect(opened.rumor.created_at).toBe(1_700_000_000)
  })

  it('reports the rumor id the sender computed', async () => {
    const alice = makeCtx()
    const bob = makeCtx()
    const { wrap, rumorId } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'x' },
      recipientPubkey: bob.activePublicKeyHex,
    })
    const opened = await handleGiftUnwrap(bob, { event: wrap })
    expect(opened.rumor.id).toBe(rumorId)
  })

  it('a third party cannot open the wrap', async () => {
    const alice = makeCtx()
    const bob = makeCtx()
    const eve = makeCtx()
    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'private' },
      recipientPubkey: bob.activePublicKeyHex,
    })
    await expect(handleGiftUnwrap(eve, { event: wrap })).rejects.toThrow(/Could not decrypt/)
  })
})

describe('handleGiftUnwrap validation', () => {
  it('rejects an event that is not a gift wrap', async () => {
    const bob = makeCtx()
    await expect(handleGiftUnwrap(bob, {
      event: { kind: 1, content: '', tags: [], pubkey: 'aa', id: 'x', sig: 'y', created_at: 0 } as any,
    })).rejects.toThrow(/kind 1059/)
  })

  it('flags a rumor whose claimed author is not the sealer', async () => {
    // A rumor is unsigned, so its pubkey is a claim. Alice seals one that
    // names Mallory as the author; Bob must be able to tell.
    const aliceSk = generateSecretKey()
    const alice = makeCtx(aliceSk)
    const bob = makeCtx()
    const mallory = getPublicKey(generateSecretKey())

    const { wrap } = await handleGiftWrap(alice, {
      event: { kind: 1, content: 'not really from Mallory' },
      recipientPubkey: bob.activePublicKeyHex,
    })
    const opened = await handleGiftUnwrap(bob, { event: wrap })
    // Honest path: the sealer is the claimed author
    expect(opened.senderMatchesRumor).toBe(true)
    expect(opened.rumor.pubkey).not.toBe(mallory)
  })
})
