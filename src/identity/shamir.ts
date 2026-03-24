import { writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

/** Split a secret into Shamir shards and write to files. Returns file paths only, never shard content. */
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

  for (let i = 0; i < shamirShares.length; i++) {
    const words = shareToWords(shamirShares[i])
    const filePath = join(args.outputDir, `shard-${i + 1}.bray`)
    writeFileSync(filePath, words.join(' '), 'utf-8')
    files.push(filePath)
  }

  return { files, threshold: args.threshold, shares: args.shares }
}

/** Restore a secret from shard files. Returns the reconstructed secret bytes. */
export function handleRestoreShamir(args: RestoreArgs): Uint8Array {
  if (args.files.length < args.threshold) {
    throw new Error(`Insufficient shards: have ${args.files.length}, need ${args.threshold}`)
  }

  const shares = args.files.map(filePath => {
    const content = readFileSync(filePath, 'utf-8').trim()
    const words = content.split(' ')
    return wordsToShare(words)
  })

  return reconstructSecret(shares, args.threshold)
}
