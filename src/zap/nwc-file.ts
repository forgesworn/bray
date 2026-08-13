import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { inspectNwcConnection } from '@forgesworn/nwc-kit'

const MAX_NWC_URI_BYTES = 8192
const MAX_PATH_CHARS = 4096

export function readPrivateRegularFile(filePath: string, maximumBytes: number, label: string): Buffer {
  const descriptor = openSync(filePath, 'r')
  let bytes: Buffer | undefined
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size === 0 || stats.size > maximumBytes) {
      throw new Error(`${label} must be a non-empty regular file no larger than ${maximumBytes} bytes`)
    }
    if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
      throw new Error(`${label} permissions are too broad; run chmod 600 on the file`)
    }
    bytes = Buffer.allocUnsafe(stats.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (count === 0) throw new Error(`${label} changed while it was being read`)
      offset += count
    }
    const extra = Buffer.allocUnsafe(1)
    try {
      if (readSync(descriptor, extra, 0, 1, null) !== 0) {
        throw new Error(`${label} changed while it was being read`)
      }
    } finally {
      extra.fill(0)
    }
    return bytes
  } catch (error) {
    bytes?.fill(0)
    throw error
  } finally {
    closeSync(descriptor)
  }
}

/** Read and validate an NWC connection from a private local secret file. */
export function readNwcUriFile(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > MAX_PATH_CHARS) {
    throw new Error('NWC URI file path is missing or too long')
  }
  const absolutePath = resolve(filePath)
  const bytes = readPrivateRegularFile(absolutePath, MAX_NWC_URI_BYTES, 'NWC URI file')
  try {
    const uri = bytes.toString('utf-8').trim()
    inspectNwcConnection(uri)
    return uri
  } finally {
    bytes.fill(0)
  }
}

/** Resolve and validate a secret-file path before adding it to the registry. */
export function normaliseNwcUriFile(filePath: string): string {
  const absolutePath = resolve(filePath)
  readNwcUriFile(absolutePath)
  return absolutePath
}
