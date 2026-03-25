import { readFileSync } from 'node:fs'
import type { BrayConfig } from './types.js'

const NSEC_RE = /^nsec1[a-z0-9]{58}$/
const HEX_RE = /^[0-9a-f]{64}$/

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

/** Load configuration from environment variables and optional secret files */
export function loadConfig(): BrayConfig {
  // --- Secret key ---
  const keyFilePath = process.env.NOSTR_SECRET_KEY_FILE
  const keyEnvVar = process.env.NOSTR_SECRET_KEY
  let secretKey: string

  let bunkerUri: string | undefined
  if (process.env.BUNKER_URI_FILE) {
    bunkerUri = readSecretFile(process.env.BUNKER_URI_FILE)
  } else if (process.env.BUNKER_URI) {
    bunkerUri = process.env.BUNKER_URI
  }

  if (keyFilePath) {
    secretKey = readSecretFile(keyFilePath)
  } else if (keyEnvVar) {
    secretKey = keyEnvVar
  } else if (bunkerUri) {
    // Bunker mode — no local secret needed
    secretKey = ''
  } else {
    throw new Error('No secret key provided: set NOSTR_SECRET_KEY, NOSTR_SECRET_KEY_FILE, or BUNKER_URI')
  }

  const secretFormat = secretKey ? detectKeyFormat(secretKey) : 'nsec' as const

  // --- NWC URI ---
  const nwcFilePath = process.env.NWC_URI_FILE
  let nwcUri: string | undefined
  if (nwcFilePath) {
    nwcUri = readSecretFile(nwcFilePath)
  } else if (process.env.NWC_URI) {
    nwcUri = process.env.NWC_URI
  }

  // --- Relays ---
  const relays = parseRelays(process.env.NOSTR_RELAYS ?? '')

  // --- Tor ---
  const torProxy = process.env.TOR_PROXY || undefined
  const allowClearnetWithTor = process.env.ALLOW_CLEARNET_WITH_TOR === '1'
  validateTorRelays(relays, torProxy, allowClearnetWithTor)

  // --- Transport ---
  const transport = (process.env.TRANSPORT === 'http' ? 'http' : 'stdio') as 'stdio' | 'http'
  const port = parseInt(process.env.PORT ?? '3000', 10)
  const bindAddress = process.env.BIND_ADDRESS ?? '127.0.0.1'

  // --- NIP-04 ---
  const nip04Enabled = process.env.NIP04_ENABLED === '1'

  // --- Clean up secrets from process.env ---
  delete process.env.NOSTR_SECRET_KEY
  delete process.env.NOSTR_SECRET_KEY_FILE
  delete process.env.NWC_URI
  delete process.env.NWC_URI_FILE
  delete process.env.BUNKER_URI
  delete process.env.BUNKER_URI_FILE

  return {
    secretKey,
    secretFormat,
    relays,
    bunkerUri: bunkerUri ?? undefined,
    nwcUri,
    torProxy,
    allowClearnetWithTor,
    nip04Enabled,
    transport,
    port,
    bindAddress,
  }
}
