/** Shared dispatch helpers shared across all CLI command modules. */

// Known two-word commands: `noun subverb` → normalised to `noun-subverb` internally.
// Enumerated explicitly to avoid swallowing positional args (e.g. `profile <pubkey>`).
export const COMPOUND_COMMANDS = new Set([
  'key-encrypt', 'key-decrypt',
  'dm-read',
  'proof-publish',
  'profile-set',
  'encode-npub', 'encode-note', 'encode-nprofile', 'encode-nevent', 'encode-nsec',
  'trust-read', 'trust-verify', 'trust-revoke', 'trust-request', 'trust-rank',
  'nip-publish', 'nip-read',
  'relay-set', 'relay-add', 'relay-curl',
  'outbox-relays', 'outbox-publish',
  'ring-prove', 'ring-verify',
  'musig2-key', 'musig2-nonce', 'musig2-partial-sign', 'musig2-aggregate',
  // sync
  'sync-pull', 'sync-push',
  // admin (NIP-86 relay management)
  'admin-allowpubkey', 'admin-banpubkey', 'admin-listallowedpubkeys', 'admin-listbannedpubkeys',
  'admin-allowkind', 'admin-bankind', 'admin-listallowedkinds', 'admin-listbannedkinds',
  'admin-blockip', 'admin-unblockip', 'admin-listblockedips',
])

// Commands that work purely offline — no relay connection needed
export const OFFLINE_COMMANDS = new Set([
  'whoami', 'create', 'list', 'derive', 'persona', 'switch', 'prove',
  'backup', 'restore', 'spoken-challenge', 'spoken-verify', 'trust-verify',
  'ring-verify', 'zap-decode', 'safety-configure', 'safety-activate',
  'decode', 'encode-npub', 'encode-note', 'encode-nprofile', 'encode-nevent', 'encode-nsec',
  'key-public', 'key-encrypt', 'key-decrypt', 'filter', 'verify', 'encrypt', 'decrypt',
  'musig2-key', 'musig2-nonce', 'musig2-partial-sign', 'musig2-aggregate',
])

export interface Helpers {
  req(index: number, usage: string): string
  flag(name: string, fallback?: string): string | undefined
  flags(name: string): string[]
  hasFlag(name: string): boolean
  out(data: unknown, humanFormatter?: (d: any) => string): void
}

export type OutputMode = 'json' | 'human' | 'jsonl' | 'csv' | 'tsv'

export function resolveOutputMode(
  cmdArgs: string[],
  envDefault: 'json' | 'human',
): OutputMode {
  if (cmdArgs.includes('--jsonl')) return 'jsonl'
  if (cmdArgs.includes('--csv')) return 'csv'
  if (cmdArgs.includes('--tsv')) return 'tsv'
  if (cmdArgs.includes('--json')) return 'json'
  if (cmdArgs.includes('--human')) return 'human'
  return envDefault
}

/** Serialise a value to delimited text (CSV or TSV).
 *
 * - Array of objects: first row is header from keys, subsequent rows are values.
 * - Array of primitives: one value per row.
 * - Single object: two-column key/value table.
 * - Primitive: single value.
 */
function toDelimited(data: unknown, sep: string): string {
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (sep === ',' && (s.includes(',') || s.includes('"') || s.includes('\n'))) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s.replace(/\t/g, ' ')
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return ''
    if (typeof data[0] === 'object' && data[0] !== null) {
      const keys = Object.keys(data[0] as object)
      const header = keys.map(k => escape(k)).join(sep)
      const rows = data.map(row =>
        keys.map(k => escape((row as Record<string, unknown>)[k])).join(sep),
      )
      return [header, ...rows].join('\n')
    }
    return data.map(v => escape(v)).join('\n')
  }

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${escape(k)}${sep}${escape(v)}`)
      .join('\n')
  }

  return escape(data)
}

export function makeHelpers(cmdArgs: string[], outputMode: OutputMode): Helpers {
  function req(index: number, usage: string): string {
    const val = cmdArgs[index]
    if (!val) throw new Error(`Usage: ${usage}`)
    return val
  }

  function flag(name: string, fallback?: string): string | undefined {
    const i = cmdArgs.indexOf(`--${name}`)
    if (i === -1) return fallback
    return cmdArgs[i + 1] ?? fallback
  }

  function hasFlag(name: string): boolean {
    return cmdArgs.includes(`--${name}`)
  }

  function flags(name: string): string[] {
    const result: string[] = []
    for (let i = 0; i < cmdArgs.length - 1; i++) {
      if (cmdArgs[i] === `--${name}`) result.push(cmdArgs[i + 1])
    }
    return result
  }

  function out(data: unknown, humanFormatter?: (d: any) => string): void {
    switch (outputMode) {
      case 'jsonl':
        if (Array.isArray(data)) {
          for (const item of data) console.log(JSON.stringify(item))
        } else {
          console.log(JSON.stringify(data))
        }
        break
      case 'csv':
        console.log(toDelimited(data, ','))
        break
      case 'tsv':
        console.log(toDelimited(data, '\t'))
        break
      case 'json':
        console.log(JSON.stringify(data, null, 2))
        break
      default: // human
        if (humanFormatter) {
          console.log(humanFormatter(data))
        } else {
          console.log(JSON.stringify(data, null, 2))
        }
    }
  }

  return { req, flag, flags, hasFlag, out }
}

/** Parse a shell line into args, respecting quotes */
export function parseShellLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote: string | null = null
  for (const ch of line) {
    if (inQuote) {
      if (ch === inQuote) { inQuote = null } else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current) { result.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) result.push(current)
  return result
}
