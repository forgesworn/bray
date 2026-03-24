import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Valid test key pair — generated for testing only
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const TEST_HEX = 'c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('loadConfig', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    // Clean any existing config env vars
    delete process.env.NOSTR_SECRET_KEY
    delete process.env.NOSTR_SECRET_KEY_FILE
    delete process.env.NOSTR_RELAYS
    delete process.env.NWC_URI
    delete process.env.NWC_URI_FILE
    delete process.env.TOR_PROXY
    delete process.env.ALLOW_CLEARNET_WITH_TOR
    delete process.env.NIP04_ENABLED
    delete process.env.TRANSPORT
    delete process.env.PORT
    delete process.env.BIND_ADDRESS
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('parses NOSTR_SECRET_KEY as nsec bech32', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = loadConfig()
    expect(config.secretKey).toBe(TEST_NSEC)
    expect(config.secretFormat).toBe('nsec')
  })

  it('parses NOSTR_SECRET_KEY as 64-char hex', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_HEX
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = loadConfig()
    expect(config.secretKey).toBe(TEST_HEX)
    expect(config.secretFormat).toBe('hex')
  })

  it('parses NOSTR_SECRET_KEY as BIP-39 mnemonic', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_MNEMONIC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = loadConfig()
    expect(config.secretKey).toBe(TEST_MNEMONIC)
    expect(config.secretFormat).toBe('mnemonic')
  })

  it('prefers NOSTR_SECRET_KEY_FILE over env var', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const keyFile = join(dir, 'secret.key')
    writeFileSync(keyFile, `${TEST_NSEC}\n`)

    process.env.NOSTR_SECRET_KEY = TEST_HEX
    process.env.NOSTR_SECRET_KEY_FILE = keyFile
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = loadConfig()
    expect(config.secretKey).toBe(TEST_NSEC)
    expect(config.secretFormat).toBe('nsec')

    unlinkSync(keyFile)
  })

  it('deletes secret env vars from process.env after parsing', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.NWC_URI = 'nostr+walletconnect://test'
    loadConfig()
    expect(process.env.NOSTR_SECRET_KEY).toBeUndefined()
    expect(process.env.NWC_URI).toBeUndefined()
  })

  it('errors if neither NOSTR_SECRET_KEY nor NOSTR_SECRET_KEY_FILE provided', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    expect(() => loadConfig()).toThrow(/secret key/i)
  })

  it('errors on invalid key format', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = 'not-a-valid-key-format'
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    expect(() => loadConfig()).toThrow(/invalid.*key/i)
  })

  it('parses NOSTR_RELAYS as comma-separated URLs', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay1.example.com, wss://relay2.example.com, wss://relay3.example.com'
    const config = loadConfig()
    expect(config.relays).toEqual([
      'wss://relay1.example.com',
      'wss://relay2.example.com',
      'wss://relay3.example.com',
    ])
  })

  it('defaults transport to stdio, port to 3000, bind to 127.0.0.1', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = loadConfig()
    expect(config.transport).toBe('stdio')
    expect(config.port).toBe(3000)
    expect(config.bindAddress).toBe('127.0.0.1')
  })

  it('parses NWC_URI_FILE and deletes env var after reading', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const nwcFile = join(dir, 'nwc.uri')
    const nwcUri = 'nostr+walletconnect://abc123'
    writeFileSync(nwcFile, `${nwcUri}\n`)

    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.NWC_URI_FILE = nwcFile
    const config = loadConfig()
    expect(config.nwcUri).toBe(nwcUri)
    expect(process.env.NWC_URI_FILE).toBeUndefined()

    unlinkSync(nwcFile)
  })

  it('refuses clearnet relays when TOR_PROXY set and ALLOW_CLEARNET_WITH_TOR unset', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    expect(() => loadConfig()).toThrow(/clearnet.*tor/i)
  })

  it('allows .onion relays when TOR_PROXY is set', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'ws://abc123def456.onion'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    const config = loadConfig()
    expect(config.relays).toEqual(['ws://abc123def456.onion'])
    expect(config.torProxy).toBe('socks5h://127.0.0.1:9050')
  })

  it('allows clearnet relays with Tor when ALLOW_CLEARNET_WITH_TOR is set', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    process.env.ALLOW_CLEARNET_WITH_TOR = '1'
    const config = loadConfig()
    expect(config.allowClearnetWithTor).toBe(true)
  })
})

describe('detectKeyFormat', () => {
  it('detects nsec bech32 format', async () => {
    const { detectKeyFormat } = await import('../src/config.js')
    expect(detectKeyFormat(TEST_NSEC)).toBe('nsec')
  })

  it('detects 64-char hex format', async () => {
    const { detectKeyFormat } = await import('../src/config.js')
    expect(detectKeyFormat(TEST_HEX)).toBe('hex')
  })

  it('detects mnemonic format', async () => {
    const { detectKeyFormat } = await import('../src/config.js')
    expect(detectKeyFormat(TEST_MNEMONIC)).toBe('mnemonic')
  })

  it('throws on invalid format', async () => {
    const { detectKeyFormat } = await import('../src/config.js')
    expect(() => detectKeyFormat('xyz-bad-key')).toThrow(/invalid.*key/i)
  })
})
