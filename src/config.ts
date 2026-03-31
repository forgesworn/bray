import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { BrayConfig } from './types.js'

const NSEC_RE = /^nsec1[a-z0-9]{58}$/
const HEX_RE = /^[0-9a-f]{64}$/
const NCRYPTSEC_RE = /^ncryptsec1[a-z0-9]+$/

/** Auto-detect key format from string content */
export function detectKeyFormat(key: string): 'nsec' | 'hex' | 'mnemonic' {
  if (NSEC_RE.test(key)) return 'nsec'
  if (HEX_RE.test(key)) return 'hex'
  // BIP-39 mnemonic: 12 or 24 space-separated lowercase words
  const words = key.split(/\s+/)
  if (words.length >= 12 && words.every(w => /^[a-z]+$/.test(w))) return 'mnemonic'
  throw new Error(`Invalid key format: expected nsec1..., 64-char hex, or BIP-39 mnemonic`)
}

/** Read and trim a secret from a file */
function readSecretFile(path: string): string {
  return readFileSync(path, 'utf-8').trim()
}

/** Parse comma-separated relay URLs */
function parseRelays(csv: string): string[] {
  return csv.split(',').map(r => r.trim()).filter(Boolean)
}

/** Check that all relays are Tor-safe when a SOCKS proxy is configured */
function validateTorRelays(relays: string[], torProxy: string | undefined, allowClearnet: boolean): void {
  if (!torProxy || allowClearnet) return
  const clearnet = relays.filter(r => !r.includes('.onion'))
  if (clearnet.length > 0) {
    throw new Error(
      `Clearnet relays not allowed with Tor proxy (set ALLOW_CLEARNET_WITH_TOR=1 to override): ${clearnet.join(', ')}`
    )
  }
}

/** Supported config file fields (subset of BrayConfig + secret paths) */
interface ConfigFile {
  secretKeyFile?: string
  bunkerUriFile?: string
  nwcUriFile?: string
  ncryptsecFile?: string
  ncryptsecPassword?: string
  relays?: string[]
  walletsFile?: string
  torProxy?: string
  allowClearnetWithTor?: boolean
  nip04Enabled?: boolean
  transport?: 'stdio' | 'http'
  port?: number
  bindAddress?: string
  trustMode?: 'strict' | 'annotate' | 'off'
  vaultEpochLength?: 'daily' | 'weekly' | 'monthly'
  veilCacheTtl?: number
  veilCacheMax?: number
  trustCacheTtl?: number
  trustCacheMax?: number
  dispatchIdentities?: string
}

/**
 * Load config from a JSON file. Searches in order:
 * 1. BRAY_CONFIG env var (explicit path)
 * 2. ~/.config/bray/config.json (XDG standard)
 * 3. ~/.nostr/bray.json (Nostr convention)
 *
 * Returns empty object if no config file found.
 * Secrets are referenced by file path (secretKeyFile, bunkerUriFile) —
 * they never appear as values in the config file itself.
 */
export function loadConfigFile(): ConfigFile {
  const candidates = [
    process.env.BRAY_CONFIG,
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'bray', 'config.json'),
    join(homedir(), '.nostr', 'bray.json'),
  ].filter(Boolean) as string[]

  for (const path of candidates) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8').trim()
      try {
        return JSON.parse(raw) as ConfigFile
      } catch {
        throw new Error(`Invalid JSON in config file: ${path}`)
      }
    }
  }
  return {}
}

/** Load configuration from config file, environment variables, and secret files.
 *  Priority: env vars > config file > defaults */
export async function loadConfig(): Promise<BrayConfig> {
  const file = loadConfigFile()

  // --- Secret key ---
  const keyFilePath = process.env.NOSTR_SECRET_KEY_FILE ?? file.secretKeyFile
  const keyEnvVar = process.env.NOSTR_SECRET_KEY
  let secretKey: string

  let bunkerUri: string | undefined
  if (process.env.BUNKER_URI_FILE) {
    bunkerUri = readSecretFile(process.env.BUNKER_URI_FILE)
  } else if (process.env.BUNKER_URI) {
    bunkerUri = process.env.BUNKER_URI
  } else if (file.bunkerUriFile) {
    bunkerUri = readSecretFile(file.bunkerUriFile)
  }

  // --- NIP-49 ncryptsec (password-encrypted key) ---
  const ncryptsec = process.env.NOSTR_NCRYPTSEC_FILE
    ? readSecretFile(process.env.NOSTR_NCRYPTSEC_FILE)
    : process.env.NOSTR_NCRYPTSEC
      ? process.env.NOSTR_NCRYPTSEC
      : file.ncryptsecFile
        ? readSecretFile(file.ncryptsecFile)
        : undefined
  const ncryptsecPassword = process.env.NOSTR_NCRYPTSEC_PASSWORD ?? file.ncryptsecPassword

  if (ncryptsec) {
    if (!ncryptsecPassword) {
      throw new Error('NOSTR_NCRYPTSEC provided but NOSTR_NCRYPTSEC_PASSWORD is missing')
    }
    if (!NCRYPTSEC_RE.test(ncryptsec)) {
      throw new Error('Invalid ncryptsec format: expected ncryptsec1...')
    }
    // Lazy import to avoid loading nip49 when not needed
    const { decrypt } = await import('nostr-tools/nip49')
    const { nsecEncode } = await import('nostr-tools/nip19')
    const bytes = decrypt(ncryptsec, ncryptsecPassword)
    try {
      secretKey = nsecEncode(bytes)
    } finally {
      bytes.fill(0)
    }
  } else if (keyFilePath) {
    secretKey = readSecretFile(keyFilePath)
  } else if (keyEnvVar) {
    secretKey = keyEnvVar
  } else if (bunkerUri) {
    // Bunker mode — no local secret needed
    secretKey = ''
  } else {
    throw new Error('No secret key provided: set NOSTR_SECRET_KEY, NOSTR_SECRET_KEY_FILE, NOSTR_NCRYPTSEC, BUNKER_URI, or use a config file (~/.config/bray/config.json)')
  }

  const secretFormat = secretKey ? detectKeyFormat(secretKey) : 'nsec' as const

  // --- NWC URI ---
  const nwcFilePath = process.env.NWC_URI_FILE ?? file.nwcUriFile
  let nwcUri: string | undefined
  if (nwcFilePath) {
    nwcUri = readSecretFile(nwcFilePath)
  } else if (process.env.NWC_URI) {
    nwcUri = process.env.NWC_URI
  }

  // --- Relays ---
  const relays = process.env.NOSTR_RELAYS
    ? parseRelays(process.env.NOSTR_RELAYS)
    : file.relays ?? []

  // --- Tor ---
  const torProxy = process.env.TOR_PROXY ?? file.torProxy ?? undefined
  const allowClearnetWithTor = process.env.ALLOW_CLEARNET_WITH_TOR === '1' || file.allowClearnetWithTor === true
  validateTorRelays(relays, torProxy, allowClearnetWithTor)

  // --- Transport ---
  const transportRaw = process.env.TRANSPORT ?? file.transport
  const transport = (transportRaw === 'http' ? 'http' : 'stdio') as 'stdio' | 'http'
  const port = parseInt(process.env.PORT ?? String(file.port ?? 3000), 10)
  const bindAddress = process.env.BIND_ADDRESS ?? file.bindAddress ?? '127.0.0.1'

  // --- NIP-04 ---
  const nip04Enabled = process.env.NIP04_ENABLED === '1' || file.nip04Enabled === true

  // Veil trust cache
  const veilCacheTtl = process.env.VEIL_CACHE_TTL
    ? parseInt(process.env.VEIL_CACHE_TTL, 10) * 1000
    : (file.veilCacheTtl ?? 300) * 1000
  const veilCacheMax = process.env.VEIL_CACHE_MAX
    ? parseInt(process.env.VEIL_CACHE_MAX, 10)
    : file.veilCacheMax ?? 500

  // Trust context cache
  const trustCacheTtl = process.env.TRUST_CACHE_TTL
    ? parseInt(process.env.TRUST_CACHE_TTL, 10) * 1000
    : (file.trustCacheTtl ?? 300) * 1000
  const trustCacheMax = process.env.TRUST_CACHE_MAX
    ? parseInt(process.env.TRUST_CACHE_MAX, 10)
    : file.trustCacheMax ?? 500

  // Trust mode
  const trustModeRaw = process.env.TRUST_MODE ?? file.trustMode ?? 'annotate'
  const trustMode = ['strict', 'annotate', 'off'].includes(trustModeRaw)
    ? trustModeRaw as 'strict' | 'annotate' | 'off'
    : 'annotate'

  // Vault epoch length
  const vaultEpochRaw = process.env.VAULT_EPOCH_LENGTH ?? file.vaultEpochLength ?? 'weekly'
  const vaultEpochLength = ['daily', 'weekly', 'monthly'].includes(vaultEpochRaw)
    ? vaultEpochRaw as 'daily' | 'weekly' | 'monthly'
    : 'weekly'

  // --- Dispatch identities file ---
  const dispatchIdentities = process.env.DISPATCH_IDENTITIES ?? file.dispatchIdentities ?? undefined

  // --- Wallets file ---
  const walletsFile = process.env.BRAY_WALLETS_FILE
    ?? file.walletsFile
    ?? (process.env.HOME ? `${process.env.HOME}/.nostr/bray-wallets.json` : '')

  // --- Clean up secrets from process.env ---
  delete process.env.NOSTR_SECRET_KEY
  delete process.env.NOSTR_SECRET_KEY_FILE
  delete process.env.NWC_URI
  delete process.env.NWC_URI_FILE
  delete process.env.BUNKER_URI
  delete process.env.BUNKER_URI_FILE
  delete process.env.NOSTR_NCRYPTSEC
  delete process.env.NOSTR_NCRYPTSEC_FILE
  delete process.env.NOSTR_NCRYPTSEC_PASSWORD

  return {
    secretKey,
    secretFormat,
    relays,
    bunkerUri: bunkerUri ?? undefined,
    nwcUri,
    walletsFile,
    torProxy,
    allowClearnetWithTor,
    nip04Enabled,
    veilCacheTtl,
    veilCacheMax,
    trustCacheTtl,
    trustCacheMax,
    trustMode,
    vaultEpochLength,
    transport,
    port,
    bindAddress,
    dispatchIdentities,
  }
}
