import { writeFileSync, readFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { validateInputPath } from '../validation.js'
import {
  splitSecret,
  reconstructSecret,
  shareToWords,
  wordsToShare,
} from '@forgesworn/shamir-words'

export interface BackupArgs {
  secret: Uint8Array
  threshold: number
  shares: number
  outputDir: string
}

export interface RestoreArgs {
  files: string[]
  threshold: number
}

/**
 * Split a secret into Shamir shards and write to files. Returns file paths only, never shard content.
 *
 * @param args - Shamir backup parameters.
 * @param args.secret - The raw secret bytes to split (e.g. a seed derived from the mnemonic).
 * @param args.threshold - Minimum number of shards required to reconstruct the secret.
 * @param args.shares - Total number of shards to produce; must be ≥ `threshold`.
 * @param args.outputDir - Absolute path to an existing directory where shard files are written.
 *   Each file is written atomically (temp-then-rename) with mode `0o600`.
 * @returns An object with `files` (absolute paths to the written `.bray` shard files),
 *   `threshold`, and `shares`. The shard content is never included in the return value.
 *
 * @example
 * const result = handleBackupShamir({
 *   secret: seedBytes,
 *   threshold: 2,
 *   shares: 3,
 *   outputDir: '/home/user/backups',
 * })
 * console.log(result.files)
 * // ['/home/user/backups/shard-1.bray', '/home/user/backups/shard-2.bray', ...]
 */
export function handleBackupShamir(args: BackupArgs): { files: string[]; threshold: number; shares: number } {
  // Validate output directory exists
  try {
    const stat = statSync(args.outputDir)
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${args.outputDir}`)
  } catch (err: any) {
    if (err.code === 'ENOENT') throw new Error(`Output directory does not exist: ${args.outputDir}`)
    throw err
  }

  const shamirShares = splitSecret(args.secret, args.threshold, args.shares)
  const files: string[] = []

  // Write to temp files first, then rename atomically
  const tempPaths: string[] = []
  for (let i = 0; i < shamirShares.length; i++) {
    const words = shareToWords(shamirShares[i])
    const filePath = join(args.outputDir, `shard-${i + 1}.bray`)
    const tempPath = `${filePath}.tmp`
    writeFileSync(tempPath, words.join(' '), { encoding: 'utf-8', mode: 0o600 })
    tempPaths.push(tempPath)
    files.push(filePath)
  }

  // Atomic rename — all or nothing
  for (let i = 0; i < tempPaths.length; i++) {
    renameSync(tempPaths[i], files[i])
  }

  return { files, threshold: args.threshold, shares: args.shares }
}

/**
 * Restore a secret from shard files. Returns the reconstructed secret bytes.
 *
 * @param args - Shamir restore parameters.
 * @param args.files - Absolute paths to at least `threshold` `.bray` shard files.
 * @param args.threshold - The threshold value that was used when the shards were created.
 * @returns The reconstructed secret as a `Uint8Array`. The caller is responsible for
 *   zeroing this buffer once it is no longer needed.
 * @throws {Error} If fewer than `threshold` files are provided.
 *
 * @example
 * const secret = handleRestoreShamir({
 *   files: ['/home/user/backups/shard-1.bray', '/home/user/backups/shard-3.bray'],
 *   threshold: 2,
 * })
 * // Use secret to reconstruct the identity, then zero it:
 * secret.fill(0)
 */
export function handleRestoreShamir(args: RestoreArgs): Uint8Array {
  if (args.files.length < args.threshold) {
    throw new Error(`Insufficient shards: have ${args.files.length}, need ${args.threshold}`)
  }

  const shares = args.files.map(filePath => {
    const safePath = validateInputPath(filePath)
    const content = readFileSync(safePath, 'utf-8').trim()
    const words = content.split(' ')
    return wordsToShare(words)
  })

  return reconstructSecret(shares, args.threshold)
}
