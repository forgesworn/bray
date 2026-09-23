import { describe, expect, it } from 'vitest'
import { registerWalletServiceTools } from '../../src/wallet-service/tools.js'
import { PROMOTED_TOOLS } from '../../src/catalog.js'

// Spending authority is opt-in. A model should not find a tool that mints
// a spending connection, or pays an invoice, in its default tool list.

const registered = (options?: { issuing?: boolean }) => {
  const names: string[] = []
  const capture = { registerTool: (name: string) => { names.push(name) } } as any
  registerWalletServiceTools(capture, { ctx: {}, pool: {}, nip65: {}, walletsFile: '' } as any, options)
  return names.sort()
}

describe('wallet tool exposure', () => {
  it('registers only listing and revocation unless the wallet service is enabled', () => {
    expect(registered()).toEqual(['wallet-grants', 'wallet-revoke'])
  })

  it('registers the tools that mint spending authority when BRAY_WALLET_SERVICE is set', () => {
    expect(registered({ issuing: true })).toEqual([
      'wallet-grant',
      'wallet-grants',
      'wallet-refill',
      'wallet-revoke',
      'wallet-serve',
    ])
  })

  it('does not promote any tool that spends', () => {
    for (const spender of ['zap-send', 'marketplace-pay', 'wallet-grant', 'wallet-refill', 'wallet-serve']) {
      expect(PROMOTED_TOOLS.has(spender)).toBe(false)
    }
  })
})
