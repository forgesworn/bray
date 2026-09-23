import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('wallet-grant', () => {
  let directory: string
  const saved = process.env.BRAY_HOME
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bray-grant-tool-'))
    process.env.BRAY_HOME = directory
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.BRAY_HOME
    else process.env.BRAY_HOME = saved
    rmSync(directory, { recursive: true, force: true })
  })

  it('writes the spend URI to a 0600 file and never returns it', async () => {
    const handlers = new Map<string, (args: any) => Promise<any>>()
    const capture = {
      registerTool: (name: string, _definition: unknown, handler: (args: any) => Promise<any>) => {
        handlers.set(name, handler)
      },
    } as any
    registerWalletServiceTools(capture, {
      ctx: { activePublicKeyHex: 'ab'.repeat(32), activeNpub: 'npub1test' },
      pool: { getRelays: () => ({ read: [], write: ['wss://relay.test'] }) },
      nip65: {},
      walletsFile: '',
    } as any, { issuing: true })

    const result = await handlers.get('wallet-grant')!({
      name: 'Coffee agent',
      methods: ['get_info', 'pay_invoice'],
      budgetMsat: 21_000,
    })
    const text = result.content[0].text as string
    expect(text).not.toContain('nostr+walletconnect')
    expect(text).not.toMatch(/secret=/)

    const { uriFile } = JSON.parse(text)
    expect(uriFile.startsWith(directory)).toBe(true)
    expect(statSync(uriFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(uriFile, 'utf8')).toMatch(/^nostr\+walletconnect:\/\/[0-9a-f]{64}\?relay=.*&secret=[0-9a-f]{64}\n$/)
  })
})
