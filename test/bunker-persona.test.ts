import { describe, it, expect } from 'vitest'
import { applyBunkerPersona } from '../src/cli/commands/bunker.js'
import { IdentityContext } from '../src/context.js'

// Same throwaway mnemonic used across the identity tests.
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('applyBunkerPersona (bunker --persona <name>)', () => {
  it('switches the bunker to the named sub-identity', async () => {
    const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    const master = ctx.activeNpub
    const expected = (await ctx.derive('magazine', 0)).npub
    await applyBunkerPersona(ctx, ['bunker', '--persona', 'magazine'])
    expect(ctx.activeNpub).toBe(expected)
    expect(ctx.activeNpub).not.toBe(master)
    ctx.destroy()
  })

  it('leaves the master active when no --persona is given', async () => {
    const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    const master = ctx.activeNpub
    await applyBunkerPersona(ctx, ['bunker', '--quiet'])
    expect(ctx.activeNpub).toBe(master)
    ctx.destroy()
  })

  it('ignores --persona with no value', async () => {
    const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    const master = ctx.activeNpub
    await applyBunkerPersona(ctx, ['bunker', '--persona'])
    expect(ctx.activeNpub).toBe(master)
    ctx.destroy()
  })

  it('returns the persona name it applied (for keying the stable bunker key)', async () => {
    const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    expect(await applyBunkerPersona(ctx, ['bunker', '--persona', 'magazine'])).toBe('magazine')
    ctx.destroy()
  })

  it('returns undefined when no --persona is given', async () => {
    const ctx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    expect(await applyBunkerPersona(ctx, ['bunker'])).toBeUndefined()
    ctx.destroy()
  })
})
