/**
 * Markdown identity table parser.
 *
 * Reads a markdown table of name -> hex pubkey mappings from an
 * identities file used by the dispatch system.
 */

import { readFileSync } from 'node:fs'

const HEX_64 = /^[0-9a-f]{64}$/

/** Separator rows contain only dashes, pipes, colons, and whitespace. */
function isSeparatorRow(row: string): boolean {
  return /^\|[\s:|-]+\|$/.test(row.trim())
}

/**
 * Parse a markdown identity table and return a map of lowercase name to hex pubkey.
 *
 * Accepts the standard format with columns: Name | Hex Pubkey | ...
 * Pubkeys may be wrapped in backticks. Only valid 64-character hex strings are accepted.
 */
export function parseIdentities(markdown: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!markdown || !markdown.trim()) return result

  const lines = markdown.split('\n')
  let headerSkipped = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue

    // Skip separator rows (e.g. |------|------|)
    if (isSeparatorRow(trimmed)) {
      headerSkipped = true
      continue
    }

    // Split on pipe, dropping the empty first and last segments
    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 2) continue

    const name = cells[0].trim()
    if (!name) continue

    // Skip the header row (first non-separator row before the separator)
    if (!headerSkipped) {
      headerSkipped = false
      continue
    }

    // Strip backticks from the hex pubkey cell
    const rawHex = cells[1].replace(/`/g, '').trim()

    if (!HEX_64.test(rawHex)) continue

    result.set(name.toLowerCase(), rawHex)
  }

  return result
}

/**
 * Load identities from a markdown file on disk.
 *
 * Throws if the file does not exist or cannot be read.
 */
export function loadIdentities(filePath: string): Map<string, string> {
  const content = readFileSync(filePath, 'utf-8')
  return parseIdentities(content)
}
