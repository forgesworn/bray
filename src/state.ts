import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

const DEFAULT_STATE_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'bray',
)

/** Read and parse a JSON state file. Returns `{}` if missing or corrupt. */
export function readStateFile<T = Record<string, unknown>>(
  name: string,
  stateDir = DEFAULT_STATE_DIR,
): T {
  const path = join(stateDir, name)
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return {} as T
  }
}

/**
 * Write a JSON state file with 0o600 permissions, atomically.
 *
 * Uses tmp-file + rename so a crash mid-write cannot leave the destination
 * truncated or world-readable: the tmp file is created with mode 0o600 and
 * renamed only after the data is fully written. On failure the tmp file is
 * removed.
 */
export function writeStateFile(
  name: string,
  data: unknown,
  stateDir = DEFAULT_STATE_DIR,
): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }
  const path = join(stateDir, name)
  const tmpPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmpPath, path)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* tmp may not exist */ }
    throw err
  }
}
