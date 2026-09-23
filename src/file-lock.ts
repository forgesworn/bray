import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'

// A short-lived advisory lock between bray processes that share one state
// file. Held only for a read-modify-write, never across a network call, so
// waiting for it is a matter of milliseconds.
//
// The lock is a file created with O_EXCL. A holder that died leaves it
// behind; it is taken over once its process is gone or it is older than
// anything a read-modify-write could plausibly take.

const STALE_MS = 10_000
const WAIT_MS = 5_000
const SLEEP = new Int32Array(new SharedArrayBuffer(4))

function holderIsGone(lockPath: string): boolean {
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs
    if (age > STALE_MS) return true
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    if (pid === process.pid) return false
    try {
      process.kill(pid, 0)
      return false
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ESRCH'
    }
  } catch {
    // vanished between the failed create and this look: try again
    return false
  }
}

/** Run `fn` while holding an exclusive lock at `${path}.lock`. */
export function withFileLock<T>(path: string, fn: () => T): T {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + WAIT_MS
  let descriptor: number | undefined
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (holderIsGone(lockPath)) {
        try { unlinkSync(lockPath) } catch { /* another waiter took it over first */ }
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lockPath}; another bray process is holding it.`)
      }
      Atomics.wait(SLEEP, 0, 0, 10)
    }
  }
  try {
    writeSync(descriptor, String(process.pid))
    return fn()
  } finally {
    closeSync(descriptor)
    try { unlinkSync(lockPath) } catch { /* already gone */ }
  }
}
