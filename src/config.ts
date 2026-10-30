import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { BrayConfig } from './types.js'
import type { AuthMode } from './relay-pool.js'
import { readNwcUriFile } from './zap/nwc-file.js'
import { paymentLimitsFromEnv } from './zap/payment-guard.js'
import { decode as decodeNip19 } from 'nostr-tools/nip19'

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

/**
 * Parse the NIP-42 AUTH policy from `NOSTR_AUTH` or the config file.
 *
 * Accepts `1`/`true`/`on`/`on-demand` for on-demand, `eager`/`force`/`2` for
 * eager, and anything unset/`0`/`off`/`false` for off. An unrecognised value is
 * a configuration error rather than a silent fallback, because the quiet
 * failure mode (typo disables auth) would look identical to a relay problem.
 */
export function parseAuthMode(raw: string | undefined): AuthMode {
  if (raw == null || raw === '') return 'off'
  const v = raw.trim().toLowerCase()
  if (['0', 'off', 'false', 'no'].includes(v)) return 'off'
  if (['1', 'on', 'true', 'yes', 'on-demand', 'ondemand'].includes(v)) return 'on-demand'
  if (['2', 'eager', 'force', 'force-pre-auth'].includes(v)) return 'eager'
  throw new Error(`Invalid NOSTR_AUTH value: "${raw}". Expected off, on-demand, or eager.`)
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

/**
 * Merge a comma-separated environment list with a config file list. An entry
 * that fails validation is a startup error: a misconfigured trust allowlist
 * must not quietly fail open or closed.
 */
function mergeList(envValue: string | undefined, fileValue: string[] | undefined): string[] {
  return [...(envValue ?? '').split(','), ...(fileValue ?? [])]
    .map(s => String(s).trim())
    .filter(Boolean)
}

/** Circle IDs are the 64-char lowercase hex SHA-256 from computeCircleId. */
function parseTrustedCircles(raw: string[]): string[] {
  for (const id of raw) {
    if (!HEX_RE.test(id)) {
      throw new Error(`veilTrustedCircles entry "${id}" is not a circle ID: expected 64 lowercase hex characters`)
    }
  }
  return [...new Set(raw)]
}

/** Trusted publishers may be hex or npub; both resolve to lowercase hex. */
function parseTrustedPublishers(raw: string[]): string[] {
  const out = new Set<string>()
  for (const entry of raw) {
    if (/^[0-9a-fA-F]{64}$/.test(entry)) {
      out.add(entry.toLowerCase())
      continue
    }
    if (entry.toLowerCase().startsWith('nsec1')) {
      throw new Error('veilTrustedPublishers wants a PUBLIC key; that is an nsec. Treat it as exposed.')
    }
    let hex: string | undefined
    try {
      const decoded = decodeNip19(entry)
      if (decoded.type === 'npub') hex = decoded.data as string
    } catch { /* reported below */ }
    if (!hex) throw new Error(`veilTrustedPublishers entry "${entry}" is neither an npub nor 64 hex characters`)
    out.add(hex)
  }
  return [...out]
}

/** Supported config file fields (subset of BrayConfig + secret paths) */
interface ConfigFile {
  secretKeyFile?: string
  bunkerUriFile?: string
  nwcUriFile?: string
  ncryptsecFile?: string
  ncryptsecPassword?: string
  ncryptsecPasswordFile?: string
  relays?: string[]
  walletsFile?: string
  torProxy?: string
  allowClearnetWithTor?: boolean
  /** NIP-42 policy: 'off' (default), 'on-demand', or 'eager'. */
  auth?: AuthMode
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
  /** Public keys this process must never sign as. See ContextOptions. */
  forbidPubkeys?: string[]
  /** Circle IDs (64 lowercase hex) whose Veil ring proofs count towards trust scores. */
  veilTrustedCircles?: string[]
  /** Pubkeys (hex or npub) whose Veil assertions and ring proofs count towards trust scores. */
  veilTrustedPublishers?: string[]
  /** Register the tools that mint spending connections (wallet-grant, wallet-refill, wallet-serve). */
  walletService?: boolean
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

/**
 * Parse BRAY_READ_ONLY. Strict on purpose: someone who writes
 * BRAY_READ_ONLY=yes expects bray not to sign, so an unrecognised value is a
 * startup error rather than a silent "off".
 */
export function parseReadOnlyFlag(raw: string | undefined): boolean {
  if (raw == null || raw.trim() === '') return false
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'on', 'yes'].includes(v)) return true
  if (['0', 'false', 'off', 'no'].includes(v)) return false
  throw new Error('Invalid BRAY_READ_ONLY value. Expected 1 or 0.')
}

/**
 * Parse NOSTR_PUBKEY (npub or 64 hex) for read-only mode. The value is never
 * echoed in an error, because a pasted secret would land in logs.
 */
export function parseReadOnlyPubkey(raw: string | undefined): string | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const v = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase()
  const lower = v.toLowerCase()
  if (lower.startsWith('nsec1') || lower.startsWith('ncryptsec1')) {
    throw new Error('NOSTR_PUBKEY wants a public key (npub), but holds a secret key. Treat that key as exposed.')
  }
  if (lower.startsWith('npub1')) {
    try {
      const decoded = decodeNip19(v)
      if (decoded.type === 'npub') return decoded.data as string
    } catch { /* fall through to the generic error */ }
  }
  throw new Error('NOSTR_PUBKEY must be an npub or 64 hex characters.')
}

export interface LoadConfigOptions {
  /**
   * Start read-only when no key or bunker is configured, instead of failing.
   * Only the MCP server sets this: the CLI and SDK keep the hard error, and
   * BRAY_READ_ONLY=1 is refused there rather than ignored.
   */
  allowReadOnly?: boolean
}

/** Load configuration from config file, environment variables, and secret files.
 *  Priority: env vars > config file > defaults */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<BrayConfig> {
  // Decided before any secret is read: BRAY_READ_ONLY=1 must never open a key
  // file, decrypt an ncryptsec, read a saved bunker URI or load a wallet.
  const forcedReadOnly = parseReadOnlyFlag(process.env.BRAY_READ_ONLY)
  if (forcedReadOnly && !options.allowReadOnly) {
    throw new Error('BRAY_READ_ONLY is supported by the MCP server only; the CLI and SDK need a signer.')
  }

  // Capture then remove bearer credentials before any parsing or validation can
  // throw. This keeps failure paths from leaving secrets in process.env.
  const capturedSecrets = {
    secretKey: process.env.NOSTR_SECRET_KEY,
    secretKeyFile: process.env.NOSTR_SECRET_KEY_FILE,
    bunkerUri: process.env.BUNKER_URI,
    bunkerUriFile: process.env.BUNKER_URI_FILE,
    ncryptsec: process.env.NOSTR_NCRYPTSEC,
    ncryptsecFile: process.env.NOSTR_NCRYPTSEC_FILE,
    ncryptsecPassword: process.env.NOSTR_NCRYPTSEC_PASSWORD,
    ncryptsecPasswordFile: process.env.NOSTR_NCRYPTSEC_PASSWORD_FILE,
    nwcUri: process.env.NWC_URI,
    nwcUriFile: process.env.NWC_URI_FILE,
  }
  delete process.env.NOSTR_SECRET_KEY
  delete process.env.NOSTR_SECRET_KEY_FILE
  delete process.env.NWC_URI
  delete process.env.NWC_URI_FILE
  delete process.env.BUNKER_URI
  delete process.env.BUNKER_URI_FILE
  delete process.env.NOSTR_NCRYPTSEC
  delete process.env.NOSTR_NCRYPTSEC_FILE
  delete process.env.NOSTR_NCRYPTSEC_PASSWORD
  delete process.env.NOSTR_NCRYPTSEC_PASSWORD_FILE

  const file = loadConfigFile()

  // In forced read-only mode the secret sources are blanked here, so every
  // branch below finds nothing to read. The env vars were deleted above.
  const secretEnvironment: Partial<typeof capturedSecrets> = forcedReadOnly ? {} : capturedSecrets
  const secretFile: Pick<ConfigFile, 'secretKeyFile' | 'bunkerUriFile' | 'nwcUriFile' | 'ncryptsecFile' | 'ncryptsecPassword' | 'ncryptsecPasswordFile'> =
    forcedReadOnly ? {} : file

  // --- Secret key ---
  const keyFilePath = secretEnvironment.secretKeyFile ?? secretFile.secretKeyFile
  const keyEnvVar = secretEnvironment.secretKey
  let secretKey: string

  // A local key source is an explicit choice to sign locally. A bunker URI
  // saved by `bunker connect` is only a fallback and must not override that
  // choice in the CLI, MCP server or SDK, all of which prefer bunkerUri when
  // it is present. Explicit bunker configuration still takes precedence.
  const hasLocalKeySource = !!(
    keyFilePath
    || keyEnvVar
    || secretEnvironment.ncryptsecFile
    || secretEnvironment.ncryptsec
    || secretFile.ncryptsecFile
  )

  let bunkerUri: string | undefined
  let bunkerPaired = false
  if (secretEnvironment.bunkerUriFile) {
    bunkerUri = readSecretFile(secretEnvironment.bunkerUriFile)
  } else if (secretEnvironment.bunkerUri) {
    bunkerUri = secretEnvironment.bunkerUri
  } else if (secretFile.bunkerUriFile) {
    bunkerUri = readSecretFile(secretFile.bunkerUriFile)
  } else if (!hasLocalKeySource && !forcedReadOnly) {
    // Fall back to the URI saved by `bunker connect` only when the caller has
    // not selected local signing for this invocation.
    const { readStateFile } = await import('./state.js')
    const saved = readStateFile<{ uri?: string; paired?: boolean }>('bunker-uri')
    if (saved.uri) {
      bunkerUri = saved.uri
      bunkerPaired = saved.paired === true
    }
  }

  // --- NIP-49 ncryptsec (password-encrypted key) ---
  const ncryptsec = secretEnvironment.ncryptsecFile
    ? readSecretFile(secretEnvironment.ncryptsecFile)
    : secretEnvironment.ncryptsec
      ? secretEnvironment.ncryptsec
      : secretFile.ncryptsecFile
        ? readSecretFile(secretFile.ncryptsecFile)
        : undefined
  // Password source precedence: env-var > env-file > config-file > inline-config.
  // Prefer file-based sources so the password can be delivered via systemd
  // credentials, docker secrets, or similar secure channels and never appears
  // in the process environment or config JSON.
  const ncryptsecPasswordFile = secretEnvironment.ncryptsecPasswordFile ?? secretFile.ncryptsecPasswordFile
  let ncryptsecPasswordBuf: Buffer | null = null
  let ncryptsecPassword: string | undefined
  if (secretEnvironment.ncryptsecPassword) {
    ncryptsecPassword = secretEnvironment.ncryptsecPassword
  } else if (ncryptsecPasswordFile) {
    // Read as Buffer so we can zeroise the at-rest byte representation even
    // though the derived UTF-8 string is immutable in V8.
    ncryptsecPasswordBuf = readFileSync(ncryptsecPasswordFile)
    // Strip a single trailing newline if present (common with `echo … > file`).
    let len = ncryptsecPasswordBuf.length
    if (len > 0 && ncryptsecPasswordBuf[len - 1] === 0x0a) len -= 1
    if (len > 0 && ncryptsecPasswordBuf[len - 1] === 0x0d) len -= 1
    ncryptsecPassword = ncryptsecPasswordBuf.subarray(0, len).toString('utf-8')
  } else if (secretFile.ncryptsecPassword) {
    ncryptsecPassword = secretFile.ncryptsecPassword
  }

  if (ncryptsec) {
    if (!ncryptsecPassword) {
      throw new Error('NOSTR_NCRYPTSEC provided but no password source (set NOSTR_NCRYPTSEC_PASSWORD, NOSTR_NCRYPTSEC_PASSWORD_FILE, or ncryptsecPasswordFile in config)')
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
      // Drop the password reference ASAP. V8 strings are immutable, but the
      // file-sourced Buffer *is* wipeable — zero it so the at-rest bytes are
      // no longer in the process heap.
      if (ncryptsecPasswordBuf) {
        ncryptsecPasswordBuf.fill(0)
        ncryptsecPasswordBuf = null
      }
      ncryptsecPassword = undefined
      bytes.fill(0)
    }
  } else if (keyFilePath) {
    secretKey = readSecretFile(keyFilePath)
  } else if (keyEnvVar) {
    secretKey = keyEnvVar
  } else if (bunkerUri) {
    // Bunker mode — no local secret needed
    secretKey = ''
  } else if (options.allowReadOnly) {
    // No signer at all: the MCP server starts read-only rather than failing.
    secretKey = ''
  } else {
    throw new Error('No secret key provided: set NOSTR_SECRET_KEY, NOSTR_SECRET_KEY_FILE, NOSTR_NCRYPTSEC, BUNKER_URI, or use a config file (~/.config/bray/config.json)')
  }

  // Read-only means no signer of any kind, whether forced or because nothing
  // was configured. Everything that can spend or sign is switched off below.
  const readOnly = forcedReadOnly || (!secretKey && !bunkerUri)
  // A signer that was configured but came back empty (an empty key or bunker
  // file) is a mistake to report, not a request for read-only mode.
  const configuredSigner = hasLocalKeySource
    || secretEnvironment.bunkerUriFile || secretEnvironment.bunkerUri || secretFile.bunkerUriFile
  if (readOnly && !forcedReadOnly && configuredSigner) {
    throw new Error('A key or bunker source is configured but empty. Fix it, or set BRAY_READ_ONLY=1 to run without a signer.')
  }
  const readOnlyPubkey = readOnly ? parseReadOnlyPubkey(process.env.NOSTR_PUBKEY) : undefined

  const secretFormat = secretKey ? detectKeyFormat(secretKey) : 'nsec' as const

  // --- NWC URI ---
  const rawNwcUri = secretEnvironment.nwcUri
  const nwcFilePath = secretEnvironment.nwcUriFile ?? secretFile.nwcUriFile
  if (rawNwcUri) {
    throw new Error('NWC_URI is disabled because bearer wallet credentials must not be stored in environment variables; use NWC_URI_FILE')
  }
  let nwcUri: string | undefined
  if (nwcFilePath && !readOnly) {
    nwcUri = readNwcUriFile(nwcFilePath)
  }
  // A mistyped spending ceiling is a startup error, not a silent default.
  paymentLimitsFromEnv()

  // --- Relays ---
  const relays = process.env.NOSTR_RELAYS
    ? parseRelays(process.env.NOSTR_RELAYS)
    : file.relays ?? []

  // --- Tor ---
  const torProxy = process.env.TOR_PROXY ?? file.torProxy ?? undefined
  const allowClearnetWithTor = process.env.ALLOW_CLEARNET_WITH_TOR === '1' || file.allowClearnetWithTor === true
  validateTorRelays(relays, torProxy, allowClearnetWithTor)

  // --- Dev: allow private-network relay URLs (for the in-memory test relay)
  const allowPrivateRelays = process.env.BRAY_ALLOW_PRIVATE_RELAYS === '1'

  // --- NIP-42 AUTH ---
  const authMode = parseAuthMode(process.env.NOSTR_AUTH ?? file.auth)

  // --- Transport ---
  const transportRaw = process.env.TRANSPORT ?? file.transport
  const transport = (transportRaw === 'http' ? 'http' : 'stdio') as 'stdio' | 'http'
  const port = parseInt(process.env.PORT ?? String(file.port ?? 3000), 10)
  const bindAddressSource = process.env.BIND_ADDRESS != null
    ? 'BIND_ADDRESS env'
    : file.bindAddress != null ? 'config file' : null
  const bindAddress = process.env.BIND_ADDRESS ?? file.bindAddress ?? '127.0.0.1'

  // Warn loudly when the HTTP transport is bound somewhere other than loopback.
  // Operators who *want* a public bind should still see this so they can confirm
  // it was their intent and not a stray BIND_ADDRESS leftover from another env.
  if (transport === 'http' && bindAddressSource !== null) {
    const isLoopback = bindAddress === '127.0.0.1' || bindAddress === '::1' || bindAddress === 'localhost'
    if (!isLoopback) {
      console.warn(
        `[bray] HTTP transport bound to ${bindAddress} (source: ${bindAddressSource}). ` +
        `This is reachable from outside the host — confirm authentication, TLS, and firewalling are configured.`,
      )
    }
  }

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

  // Comma-separated npubs or hex. A list nobody can parse is rejected at
  // startup by resolvePubkeyRef rather than silently permitting everything.
  const forbidPubkeys = [
    ...(process.env.NOSTR_FORBID_PUBKEY ?? '').split(','),
    ...(file.forbidPubkeys ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean)

  // --- Veil trust anchors ---
  const veilTrustedCircles = parseTrustedCircles(
    mergeList(process.env.VEIL_TRUSTED_CIRCLES, file.veilTrustedCircles),
  )
  const veilTrustedPublishers = parseTrustedPublishers(
    mergeList(process.env.VEIL_TRUSTED_PUBLISHERS, file.veilTrustedPublishers),
  )

  // --- Wallet service ---
  // Off unless asked for: wallet-grant, wallet-refill and wallet-serve hand
  // out spending authority over the operator's wallet, which is not
  // something a model should find in its tool list by default.
  const walletService = process.env.BRAY_WALLET_SERVICE === '1' || file.walletService === true

  // --- Wallets file ---
  const walletsFile = process.env.BRAY_WALLETS_FILE
    ?? file.walletsFile
    ?? (process.env.HOME ? `${process.env.HOME}/.nostr/bray-wallets.json` : '')

  if (readOnly) {
    return {
      readOnly: true,
      ...(readOnlyPubkey ? { readOnlyPubkey } : {}),
      secretKey: '',
      secretFormat,
      relays,
      bunkerUri: undefined,
      nwcUri: undefined,
      walletsFile: '',
      torProxy,
      allowClearnetWithTor,
      allowPrivateRelays,
      // No signer to answer NIP-42 challenges with.
      authMode: 'off',
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
      dispatchIdentities: undefined,
      forbidPubkeys,
      veilTrustedCircles,
      veilTrustedPublishers,
      walletService: false,
    }
  }

  return {
    readOnly: false,
    secretKey,
    secretFormat,
    relays,
    bunkerUri: bunkerUri ?? undefined,
    bunkerPaired: bunkerUri ? bunkerPaired : undefined,
    nwcUri,
    walletsFile,
    torProxy,
    allowClearnetWithTor,
    allowPrivateRelays,
    authMode,
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
    forbidPubkeys,
    veilTrustedCircles,
    veilTrustedPublishers,
    walletService,
  }
}
