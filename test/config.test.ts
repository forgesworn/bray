import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleKeyEncrypt } from '../src/util/ncryptsec.js'

// Valid test key pair — generated for testing only
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const TEST_HEX = 'c189b82fc49ad3362eacb0976a5405df2d0d4fde6cfc025e41c33e65db1ab915'
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const ISOLATED_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'bray-config-isolated-'))
const SAVED_BUNKER_PATH = join(ISOLATED_CONFIG_HOME, 'bray', 'bunker-uri')
const SAVED_BUNKER_URI = `bunker://${'ab'.repeat(32)}?relay=wss%3A%2F%2Frelay.saved.example.com`
const EXPLICIT_BUNKER_URI = `bunker://${'cd'.repeat(32)}?relay=wss%3A%2F%2Frelay.explicit.example.com`

function saveBunkerUri(uri = SAVED_BUNKER_URI): void {
  mkdirSync(join(ISOLATED_CONFIG_HOME, 'bray'), { recursive: true })
  writeFileSync(SAVED_BUNKER_PATH, JSON.stringify({ uri }))
}

afterAll(() => {
  rmSync(ISOLATED_CONFIG_HOME, { recursive: true, force: true })
})

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
    delete process.env.BUNKER_URI
    delete process.env.BUNKER_URI_FILE
    delete process.env.NOSTR_NCRYPTSEC
    delete process.env.NOSTR_NCRYPTSEC_FILE
    delete process.env.NOSTR_NCRYPTSEC_PASSWORD
    delete process.env.NOSTR_NCRYPTSEC_PASSWORD_FILE
    delete process.env.BRAY_CONFIG
    delete process.env.TOR_PROXY
    delete process.env.ALLOW_CLEARNET_WITH_TOR
    delete process.env.NIP04_ENABLED
    delete process.env.TRANSPORT
    delete process.env.PORT
    delete process.env.BIND_ADDRESS
    process.env.HOME = ISOLATED_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = ISOLATED_CONFIG_HOME
    rmSync(SAVED_BUNKER_PATH, { force: true })
  })

  afterEach(() => {
    rmSync(SAVED_BUNKER_PATH, { force: true })
    process.env = savedEnv
  })

  it('parses NOSTR_SECRET_KEY as nsec bech32', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = await loadConfig()
    expect(config.secretKey).toBe(TEST_NSEC)
    expect(config.secretFormat).toBe('nsec')
  })

  it('parses NOSTR_SECRET_KEY as 64-char hex', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_HEX
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = await loadConfig()
    expect(config.secretKey).toBe(TEST_HEX)
    expect(config.secretFormat).toBe('hex')
  })

  it('parses NOSTR_SECRET_KEY as BIP-39 mnemonic', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_MNEMONIC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = await loadConfig()
    expect(config.secretKey).toBe(TEST_MNEMONIC)
    expect(config.secretFormat).toBe('mnemonic')
  })

  it('uses the saved bunker URI when no local key source is provided', async () => {
    const { loadConfig } = await import('../src/config.js')
    saveBunkerUri()
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    const config = await loadConfig()

    expect(config.bunkerUri).toBe(SAVED_BUNKER_URI)
    expect(config.secretKey).toBe('')
  })

  it('does not let the saved bunker URI override NOSTR_SECRET_KEY', async () => {
    const { loadConfig } = await import('../src/config.js')
    saveBunkerUri()
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    const config = await loadConfig()

    expect(config.bunkerUri).toBeUndefined()
    expect(config.secretKey).toBe(TEST_NSEC)
  })

  it('does not let the saved bunker URI override NOSTR_SECRET_KEY_FILE', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-key-precedence-'))
    const keyFile = join(dir, 'secret.key')
    writeFileSync(keyFile, `${TEST_NSEC}\n`)
    saveBunkerUri()
    process.env.NOSTR_SECRET_KEY_FILE = keyFile
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    try {
      const config = await loadConfig()
      expect(config.bunkerUri).toBeUndefined()
      expect(config.secretKey).toBe(TEST_NSEC)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let the saved bunker URI override a configured secretKeyFile', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-config-key-precedence-'))
    const keyFile = join(dir, 'secret.key')
    const configFile = join(dir, 'config.json')
    writeFileSync(keyFile, `${TEST_NSEC}\n`)
    writeFileSync(configFile, JSON.stringify({ secretKeyFile: keyFile }))
    saveBunkerUri()
    process.env.BRAY_CONFIG = configFile
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    try {
      const config = await loadConfig()
      expect(config.bunkerUri).toBeUndefined()
      expect(config.secretKey).toBe(TEST_NSEC)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let the saved bunker URI override NOSTR_NCRYPTSEC', async () => {
    const { loadConfig } = await import('../src/config.js')
    const password = 'saved-bunker-precedence-test'
    const { ncryptsec } = handleKeyEncrypt(TEST_HEX, password)
    saveBunkerUri()
    process.env.NOSTR_NCRYPTSEC = ncryptsec
    process.env.NOSTR_NCRYPTSEC_PASSWORD = password
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    const config = await loadConfig()

    expect(config.bunkerUri).toBeUndefined()
    expect(config.secretKey).toBe(TEST_NSEC)
  })

  it('does not let the saved bunker URI override NOSTR_NCRYPTSEC_FILE', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-ncryptsec-precedence-'))
    const password = 'saved-bunker-file-precedence-test'
    const { ncryptsec } = handleKeyEncrypt(TEST_HEX, password)
    const ncryptsecFile = join(dir, 'key.ncryptsec')
    writeFileSync(ncryptsecFile, `${ncryptsec}\n`)
    saveBunkerUri()
    process.env.NOSTR_NCRYPTSEC_FILE = ncryptsecFile
    process.env.NOSTR_NCRYPTSEC_PASSWORD = password
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    try {
      const config = await loadConfig()
      expect(config.bunkerUri).toBeUndefined()
      expect(config.secretKey).toBe(TEST_NSEC)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let the saved bunker URI override a configured ncryptsecFile', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-config-ncryptsec-precedence-'))
    const password = 'saved-bunker-config-precedence-test'
    const { ncryptsec } = handleKeyEncrypt(TEST_HEX, password)
    const ncryptsecFile = join(dir, 'key.ncryptsec')
    const configFile = join(dir, 'config.json')
    writeFileSync(ncryptsecFile, `${ncryptsec}\n`)
    writeFileSync(configFile, JSON.stringify({ ncryptsecFile }))
    saveBunkerUri()
    process.env.BRAY_CONFIG = configFile
    process.env.NOSTR_NCRYPTSEC_PASSWORD = password
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    try {
      const config = await loadConfig()
      expect(config.bunkerUri).toBeUndefined()
      expect(config.secretKey).toBe(TEST_NSEC)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps an explicit BUNKER_URI ahead of a local key', async () => {
    const { loadConfig } = await import('../src/config.js')
    saveBunkerUri()
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.BUNKER_URI = EXPLICIT_BUNKER_URI
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'

    const config = await loadConfig()

    expect(config.bunkerUri).toBe(EXPLICIT_BUNKER_URI)
    expect(config.secretKey).toBe(TEST_NSEC)
  })

  it('prefers NOSTR_SECRET_KEY_FILE over env var', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const keyFile = join(dir, 'secret.key')
    writeFileSync(keyFile, `${TEST_NSEC}\n`)

    process.env.NOSTR_SECRET_KEY = TEST_HEX
    process.env.NOSTR_SECRET_KEY_FILE = keyFile
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    const config = await loadConfig()
    expect(config.secretKey).toBe(TEST_NSEC)
    expect(config.secretFormat).toBe('nsec')

    unlinkSync(keyFile)
  })

  it('deletes secret env vars and refuses a raw NWC_URI', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.NWC_URI = 'nostr+walletconnect://test'
    await expect(loadConfig()).rejects.toThrow('NWC_URI is disabled')
    expect(process.env.NOSTR_SECRET_KEY).toBeUndefined()
    expect(process.env.NWC_URI).toBeUndefined()
  })

  it('errors if neither NOSTR_SECRET_KEY nor NOSTR_SECRET_KEY_FILE provided', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    await expect(loadConfig()).rejects.toThrow(/secret key/i)
  })

  it('errors on invalid key format', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = 'not-a-valid-key-format'
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    await expect(loadConfig()).rejects.toThrow(/invalid.*key/i)
  })

  it('parses NOSTR_RELAYS as comma-separated URLs', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay1.example.com, wss://relay2.example.com, wss://relay3.example.com'
    const config = await loadConfig()
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
    const config = await loadConfig()
    expect(config.transport).toBe('stdio')
    expect(config.port).toBe(3000)
    expect(config.bindAddress).toBe('127.0.0.1')
  })

  it('parses NWC_URI_FILE and deletes env var after reading', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const nwcFile = join(dir, 'nwc.uri')
    const nwcUri = `nostr+walletconnect://${'01'.padStart(64, '0')}?relay=wss%3A%2F%2Frelay.example.com&secret=${'02'.padStart(64, '0')}`
    writeFileSync(nwcFile, `${nwcUri}\n`, { mode: 0o600 })

    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.NWC_URI_FILE = nwcFile
    const config = await loadConfig()
    expect(config.nwcUri).toBe(nwcUri)
    expect(process.env.NWC_URI_FILE).toBeUndefined()

    unlinkSync(nwcFile)
  })

  it('refuses clearnet relays when TOR_PROXY set and ALLOW_CLEARNET_WITH_TOR unset', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    await expect(loadConfig()).rejects.toThrow(/clearnet.*tor/i)
  })

  it('allows .onion relays when TOR_PROXY is set', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'ws://abc123def456.onion'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    const config = await loadConfig()
    expect(config.relays).toEqual(['ws://abc123def456.onion'])
    expect(config.torProxy).toBe('socks5h://127.0.0.1:9050')
  })

  it('allows clearnet relays with Tor when ALLOW_CLEARNET_WITH_TOR is set', async () => {
    const { loadConfig } = await import('../src/config.js')
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://relay.example.com'
    process.env.TOR_PROXY = 'socks5h://127.0.0.1:9050'
    process.env.ALLOW_CLEARNET_WITH_TOR = '1'
    const config = await loadConfig()
    expect(config.allowClearnetWithTor).toBe(true)
  })
})

describe('loadConfigFile', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    delete process.env.BRAY_CONFIG
    process.env.HOME = ISOLATED_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = ISOLATED_CONFIG_HOME
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('loads config from BRAY_CONFIG path', async () => {
    const { loadConfigFile } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      bunkerUriFile: '/tmp/test-bunker-uri',
      relays: ['wss://relay.test.com'],
      trustMode: 'strict',
    }))

    process.env.BRAY_CONFIG = configPath
    const config = loadConfigFile()
    expect(config.bunkerUriFile).toBe('/tmp/test-bunker-uri')
    expect(config.relays).toEqual(['wss://relay.test.com'])
    expect(config.trustMode).toBe('strict')

    unlinkSync(configPath)
  })

  it('loads config from XDG_CONFIG_HOME', async () => {
    const { loadConfigFile } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const configDir = join(dir, 'bray')
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ transport: 'http', port: 8080 }))

    process.env.XDG_CONFIG_HOME = dir
    const config = loadConfigFile()
    expect(config.transport).toBe('http')
    expect(config.port).toBe(8080)

    unlinkSync(configPath)
  })

  it('returns empty object when no config file exists', async () => {
    const { loadConfigFile } = await import('../src/config.js')
    process.env.XDG_CONFIG_HOME = '/tmp/nonexistent-bray-config-dir'
    const config = loadConfigFile()
    expect(config).toEqual({})
  })

  it('throws on invalid JSON', async () => {
    const { loadConfigFile } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, 'not valid json {{{')

    process.env.BRAY_CONFIG = configPath
    expect(() => loadConfigFile()).toThrow(/invalid json/i)

    unlinkSync(configPath)
  })

  it('config file bunkerUriFile used when no env vars set', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))

    // Create a bunker URI file
    const bunkerFile = join(dir, 'bunker-uri')
    writeFileSync(bunkerFile, 'bunker://abc123?relay=wss://relay.test.com')

    // Create a config file pointing to it
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      bunkerUriFile: bunkerFile,
      relays: ['wss://relay.test.com'],
    }))

    process.env.BRAY_CONFIG = configPath
    delete process.env.NOSTR_SECRET_KEY
    delete process.env.NOSTR_SECRET_KEY_FILE
    delete process.env.BUNKER_URI
    delete process.env.BUNKER_URI_FILE
    delete process.env.NOSTR_RELAYS

    const config = await loadConfig()
    expect(config.bunkerUri).toBe('bunker://abc123?relay=wss://relay.test.com')
    expect(config.relays).toEqual(['wss://relay.test.com'])

    unlinkSync(bunkerFile)
    unlinkSync(configPath)
  })

  it('env vars override config file values', async () => {
    const { loadConfig } = await import('../src/config.js')
    const dir = mkdtempSync(join(tmpdir(), 'bray-test-'))
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      relays: ['wss://config-relay.test.com'],
      trustMode: 'off',
    }))

    process.env.BRAY_CONFIG = configPath
    process.env.NOSTR_SECRET_KEY = TEST_NSEC
    process.env.NOSTR_RELAYS = 'wss://env-relay.test.com'
    process.env.TRUST_MODE = 'strict'

    const config = await loadConfig()
    expect(config.relays).toEqual(['wss://env-relay.test.com'])
    expect(config.trustMode).toBe('strict')

    unlinkSync(configPath)
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
