import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { readStateFile, writeStateFile } from './state.js'

const NSEC_TREE_PROFILES_DIR = join(homedir(), '.nsec-tree', 'profiles')
const BUNKER_KEYS_FILE = 'bunker-keys.json'

/**
 * Read the BIP-39 mnemonic from an nsec-tree-cli profile
 * (`~/.nsec-tree/profiles/<name>.json`). Lets `bunker --profile <name>` use the
 * master directly, so the operator never types or stores the 12 words separately.
 */
export function readNsecTreeProfileMnemonic(name: string, baseDir = NSEC_TREE_PROFILES_DIR): string {
  const raw = readFileSync(join(baseDir, `${name}.json`), 'utf8')
  const mnemonic = (JSON.parse(raw) as { root?: { mnemonic?: unknown } }).root?.mnemonic
  if (typeof mnemonic !== 'string' || mnemonic.trim() === '') {
    throw new Error(`nsec-tree profile "${name}" is not mnemonic-backed (no recoverable 12 words)`)
  }
  return mnemonic.trim()
}

/**
 * Get — creating + persisting on first use — a stable bunker connection key for
 * a label, so the bunker:// URI stays the same across restarts without the
 * operator managing key files. Stored in bray's state dir.
 */
export function getOrCreateBunkerKey(label: string, stateDir?: string): string {
  const keys = readStateFile<Record<string, string>>(BUNKER_KEYS_FILE, stateDir)
  const existing = keys[label]
  if (typeof existing === 'string' && /^[0-9a-f]{64}$/i.test(existing)) return existing
  const hex = bytesToHex(generateSecretKey())
  keys[label] = hex
  writeStateFile(BUNKER_KEYS_FILE, keys, stateDir)
  return hex
}
