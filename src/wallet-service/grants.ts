import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Grant } from './service.js'

// Where the grants live.
//
// Each one carries two secret keys: the service key it answers under, and
// the client key inside the URI that was handed out. Both spend, so the
// file is 0600 and written atomically - a half-written grants file after a
// crash would either lose a capability or leave one nobody can revoke.

const MAX_FILE_BYTES = 1_048_576
const MAX_GRANTS = 128

export interface GrantsFile {
  version: 1
  grants: Record<string, Grant[]>
}

export function defaultGrantsFile(): string {
  return join(process.env.BRAY_HOME ?? join(homedir(), '.config', 'bray'), 'wallet-grants.json')
}

export function loadGrants(path: string, pubkeyHex: string): Grant[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  if (raw.length > MAX_FILE_BYTES) throw new Error('The grants file is implausibly large; refusing to read it.')
  let parsed: GrantsFile
  try {
    parsed = JSON.parse(raw) as GrantsFile
  } catch {
    throw new Error('The grants file is not readable JSON.')
  }
  if (parsed?.version !== 1 || typeof parsed.grants !== 'object') return []
  const held = parsed.grants[pubkeyHex]
  return Array.isArray(held) ? held : []
}

export function saveGrants(path: string, pubkeyHex: string, grants: Grant[]): void {
  if (grants.length > MAX_GRANTS) throw new Error(`No more than ${MAX_GRANTS} connections per identity.`)
  let file: GrantsFile = { version: 1, grants: {} }
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as GrantsFile
      if (parsed?.version === 1 && typeof parsed.grants === 'object') file = parsed
    } catch {
      // an unreadable file is replaced rather than appended to; the
      // alternative is refusing to ever write again
    }
  }
  file.grants[pubkeyHex] = grants
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(file, null, 2), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}
