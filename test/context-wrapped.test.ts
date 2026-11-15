import { describe, expect, it } from 'vitest'
import { getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { fromNsec, derive } from 'nsec-tree'
import { wrapNsec } from 'nsec-tree/wrapped'
import { IdentityContext } from '../src/context.js'

const master = '11'.repeat(32)
const raw = new Uint8Array(32).fill(0x22)
const npub = npubEncode(getPublicKey(raw))
async function record() {
  const root = fromNsec(Buffer.from(master, 'hex'))
  try { return await wrapNsec(root, raw) } finally { root.destroy() }
}

describe('local wrapped identity recovery', () => {
  it('keeps imported provenance and secret ownership when its key also matches a derivation slot', async () => {
    const root = fromNsec(Buffer.from(master, 'hex'))
    const child = derive(root, 'test', 0)
    const ctx = new IdentityContext(master, 'hex')
    try {
      const wrapped = await wrapNsec(root, child.privateKey)
      await ctx.importWrappedIdentity(wrapped, child.npub)
      await ctx.switch(child.npub)
      const retained = ctx._getPrivateKeyRefForTesting(child.npub)!
      await expect(ctx.derive('', 0)).rejects.toThrow()
      await expect(ctx.derive('test', 0)).rejects.toThrow(/provenance/)
      expect(ctx._getPrivateKeyRefForTesting(child.npub)).toBe(retained)
      expect(retained).toEqual(child.privateKey)
      await expect(ctx.prove()).rejects.toThrow(/imported/)
      ctx.destroy()
      expect(retained.every(b => b === 0)).toBe(true)
    } finally { ctx.destroy(); child.privateKey.fill(0); root.destroy() }
  })

  it('imports without activation, signs as the exact key after explicit selection, and refuses derivation proofs', async () => {
    const ctx = new IdentityContext(master, 'hex')
    const initial = ctx.activeNpub
    try {
      expect(await ctx.importWrappedIdentity(await record(), npub)).toEqual({npub, origin: 'imported', recovery: 'master-and-record'})
      expect(ctx.activeNpub).toBe(initial)
      expect((await ctx.listIdentities()).find(i => i.npub === npub)).not.toHaveProperty('purpose')
      await ctx.switch(npub)
      const event = await ctx.getSigningFunction()({kind: 1, content: 'test', tags: [], created_at: 1})
      expect(verifyEvent(event)).toBe(true)
      expect(event.pubkey).toBe(getPublicKey(raw))
      await expect(ctx.prove('blind')).rejects.toThrow(/imported/)
      await expect(ctx.prove('full')).rejects.toThrow(/imported/)
      expect(await ctx.wrapImportedIdentity(npub)).toMatch(/^nstw1:/)
    } finally { ctx.destroy() }
  })

  it('rejects forbidden imports before caching or changing the active identity', async () => {
    const ctx = new IdentityContext(master, 'hex', {forbidPubkeys: [npub]})
    const initial = ctx.activeNpub
    try {
      await expect(ctx.importWrappedIdentity(await record(), npub)).rejects.toThrow(/forbidden list/)
      expect(ctx.activeNpub).toBe(initial)
      expect((await ctx.listIdentities()).some(i => i.npub === npub)).toBe(false)
    } finally { ctx.destroy() }
  })

  it('rejects a wrong root/expected npub, keeps derived provenance and wipes imported bytes on eviction and destroy', async () => {
    const ctx = new IdentityContext(master, 'hex', {maxCache: 1})
    const wrong = new IdentityContext('33'.repeat(32), 'hex')
    try {
      const wrapped = await record()
      await expect(wrong.importWrappedIdentity(wrapped, npub)).rejects.toThrow()
      await expect(ctx.importWrappedIdentity(wrapped, ctx.activeNpub)).rejects.toThrow(/identity/)
      await ctx.importWrappedIdentity(wrapped, npub)
      const bytes = ctx._getPrivateKeyRefForTesting(npub)!
      await ctx.derive('test', 0)
      expect(bytes.every(b => b === 0)).toBe(true)
      await expect(ctx.switch(npub)).rejects.toThrow(/not loaded/)
      await ctx.importWrappedIdentity(wrapped, npub)
      const again = ctx._getPrivateKeyRefForTesting(npub)!
      ctx.destroy()
      expect(again.every(b => b === 0)).toBe(true)
      await expect(ctx.importWrappedIdentity(wrapped, npub)).rejects.toThrow(/destroyed/)
    } finally { ctx.destroy(); wrong.destroy() }
  })
})
