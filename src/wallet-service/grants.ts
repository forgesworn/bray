import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { grantUri, type Grant, type GrantStore } from './service.js'
import { withFileLock } from '../file-lock.js'

// Where the grants live.
//
// Each one carries two secret keys: the service key it answers under, and
// the client key inside the URI that was handed out. Both spend, so the
// file is 0600 and written atomically - a half-written grants file after a
// crash would either lose a capability or leave one nobody can revoke.
//
// The file, not any process's memory, is the record. Several bray
// processes can share it (an MCP session, a CLI, a second client), so
// every change is a locked read-modify-write of the current file, and the
// process that serves grants re-reads a grant before each request. A
// revocation or refill made anywhere is therefore seen everywhere, and no
// process can undo one by writing back what it happened to remember.

const MAX_FILE_BYTES = 1_048_576
const MAX_GRANTS = 128

export interface GrantsFile {
  version: 1
  grants: Record<string, Grant[]>
}

export function defaultGrantsFile(): string {
  return join(process.env.BRAY_HOME ?? join(homedir(), '.config', 'bray'), 'wallet-grants.json')
}

function readFile(path: string): GrantsFile {
  if (!existsSync(path)) return { version: 1, grants: {} }
  const raw = readFileSync(path, 'utf8')
  if (raw.length > MAX_FILE_BYTES) throw new Error('The grants file is implausibly large; refusing to read it.')
  let parsed: GrantsFile
  try {
    parsed = JSON.parse(raw) as GrantsFile
  } catch {
    throw new Error('The grants file is not readable JSON.')
  }
  if (parsed?.version !== 1 || typeof parsed.grants !== 'object' || parsed.grants === null) {
    return { version: 1, grants: {} }
  }
  return parsed
}

function writeFile(path: string, file: GrantsFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(file, null, 2), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export function loadGrants(path: string, pubkeyHex: string): Grant[] {
  const held = readFile(path).grants[pubkeyHex]
  return Array.isArray(held) ? held : []
}

/**
 * Change one identity's grants as they stand on disk now, under a lock.
 * If `mutate` throws, nothing is written.
 */
export function updateGrants<T>(path: string, pubkeyHex: string, mutate: (grants: Grant[]) => T): T {
  return withFileLock(path, () => {
    const file = readFile(path)
    const grants = Array.isArray(file.grants[pubkeyHex]) ? file.grants[pubkeyHex] : []
    const result = mutate(grants)
    if (grants.length > MAX_GRANTS) throw new Error(`No more than ${MAX_GRANTS} connections per identity.`)
    file.grants[pubkeyHex] = grants
    writeFile(path, file)
    return result
  })
}

/** Replace one identity's grants wholesale. Prefer `updateGrants`. */
export function saveGrants(path: string, pubkeyHex: string, grants: Grant[]): void {
  if (grants.length > MAX_GRANTS) throw new Error(`No more than ${MAX_GRANTS} connections per identity.`)
  updateGrants(path, pubkeyHex, (held) => {
    held.splice(0, held.length, ...grants)
  })
}

// Only one process answers for the grants at a time. Two serving the same
// connection would each charge their own copy of its budget and each
// answer the same request.

function servingPid(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
    if (!Number.isSafeInteger(pid) || pid <= 0) return null
    if (pid === process.pid) return pid
    try {
      process.kill(pid, 0)
      return pid
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM' ? pid : null
    }
  } catch {
    return null
  }
}

/** Claim the right to serve the grants in `path`, or say who holds it. */
export function acquireServeLock(path: string): void {
  const lockPath = `${path}.serving`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600)
      try {
        writeSync(descriptor, String(process.pid))
      } finally {
        closeSync(descriptor)
      }
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const holder = servingPid(lockPath)
      if (holder === process.pid) return
      if (holder !== null) {
        throw new Error(
          `Another bray process (pid ${holder}) is already serving these wallet connections. Stop it first; two processes serving the same connections would each count their own budget.`,
        )
      }
      // The holder is gone: its claim goes with it.
      try { unlinkSync(lockPath) } catch { /* someone else cleared it first */ }
    }
  }
  throw new Error('Could not claim the wallet-service lock.')
}

export function releaseServeLock(path: string): void {
  const lockPath = `${path}.serving`
  if (servingPid(lockPath) === process.pid) {
    try { unlinkSync(lockPath) } catch { /* already gone */ }
  }
}

/** A `GrantStore` over the grants file, for the process that serves them. */
export function fileGrantStore(path: string, pubkeyHex: string): GrantStore {
  return {
    read: (grantId) => loadGrants(path, pubkeyHex).find((grant) => grant.id === grantId),
    update: (grantId, mutate) =>
      updateGrants(path, pubkeyHex, (grants) => {
        const grant = grants.find((held) => held.id === grantId)
        if (!grant) return undefined
        mutate(grant)
        return structuredClone(grant)
      }),
  }
}

function find(grants: Grant[], nameOrId: string, byPrefix: boolean): Grant | undefined {
  const wanted = nameOrId.trim().toLowerCase()
  return (
    grants.find((held) => held.id === wanted) ??
    grants.find((held) => held.name.toLowerCase() === wanted) ??
    (byPrefix ? grants.find((held) => held.id.startsWith(wanted)) : undefined)
  )
}

/** Revoke a connection on disk. Every process sees it before its next request. */
export function revokeGrant(path: string, pubkeyHex: string, nameOrId: string, now = Date.now()): Grant {
  return updateGrants(path, pubkeyHex, (grants) => {
    const grant = find(grants, nameOrId, true)
    if (!grant) throw new Error(`No connection here called ${nameOrId}.`)
    grant.revokedAt ??= now
    return structuredClone(grant)
  })
}

/** Reset a spending connection's budget on disk, optionally to a new figure. */
export function refillGrant(path: string, pubkeyHex: string, nameOrId: string, budgetMsat?: number): Grant {
  return updateGrants(path, pubkeyHex, (grants) => {
    const grant = find(grants, nameOrId, false)
    if (!grant) throw new Error(`No connection here called ${nameOrId}.`)
    if (grant.revokedAt) throw new Error('That connection is revoked - issue a new one.')
    if (grant.budgetMsat === undefined) throw new Error('That connection cannot spend, so it has no budget.')
    if (budgetMsat !== undefined) {
      if (grant.maxPaymentMsat !== undefined && grant.maxPaymentMsat > budgetMsat) {
        throw new Error('The per-payment ceiling is above that budget.')
      }
      grant.budgetMsat = budgetMsat
    }
    grant.spentMsat = 0
    return structuredClone(grant)
  })
}

/**
 * Write a grant's connection URI to its own 0600 file and return the path.
 *
 * The URI is a bearer secret: whoever holds it can do what the grant
 * allows. It goes to a file for the operator to hand over, never into a
 * tool result, where it would sit in a model's context and transcript.
 */
export function writeGrantUriFile(grantsFile: string, grant: Grant): string {
  const directory = join(dirname(grantsFile), 'wallet-connections')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const slug = grant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'connection'
  const path = join(directory, `${slug}-${grant.id}.nwc`)
  writeFileSync(path, `${grantUri(grant)}\n`, { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  return path
}
