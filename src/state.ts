import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

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

/** Write a JSON state file with 0600 permissions. Creates directory if needed. */
export function writeStateFile(
  name: string,
  data: unknown,
  stateDir = DEFAULT_STATE_DIR,
): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }
  const path = join(stateDir, name)
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
  chmodSync(path, 0o600)
}
