import { openSync, closeSync, fstatSync, readSync, writeFileSync, linkSync, unlinkSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { decode } from 'nostr-tools/nip19'
import { getInputAllowlist, validateInputPath } from '../validation.js'
import type { IdentityContext } from '../context.js'

/** Bounded regular-file read; checks the resolved path against Bray's input policy. */
function resolvedPolicy(path: string): string {
  const roots = getInputAllowlist().flatMap(root => {
    try { return [realpathSync(root)] } catch { return [] }
  })
  return validateInputPath(path, roots)
}

function readSmallFile(path: string): Buffer {
  const checked = resolvedPolicy(realpathSync(validateInputPath(path)))
  const fd = openSync(checked, 'r')
  const buffer = Buffer.alloc(1025)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 1024) throw new Error('Key/backup file is too large or is not a regular file')
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    if (length > 1024) throw new Error('Key/backup file is too large')
    return Buffer.from(buffer.subarray(0, length))
  } finally { buffer.fill(0); closeSync(fd) }
}

/** Owner-only offline export. Atomically creates a new file; never overwrites an old backup. */
export async function wrapKeyFile(ctx: IdentityContext, input: string, output: string): Promise<{file: string; npub: string}> {
  const file = validateInputPath(resolve(output))
  resolvedPolicy(realpathSync(dirname(file)))
  const encoded = readSmallFile(input)
  let raw: Uint8Array | undefined
  let temporary: string | undefined
  let ownsTemporary = false
  try {
    const text = encoded.toString('utf8').trim()
    if (/^[0-9a-f]{64}$/i.test(text)) raw = Buffer.from(text, 'hex')
    else {
      const decoded = decode(text)
      if (decoded.type !== 'nsec') throw new Error('Expected an nsec or 32-byte hex key file')
      raw = decoded.data
    }
    const record = await ctx.wrapRawIdentity(raw)
    const checked = await ctx.checkWrappedIdentity(record)
    temporary = `${file}.${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    ownsTemporary = true
    try { writeFileSync(fd, record) } finally { closeSync(fd) }
    // Authenticate the bytes read back from disk before linking the final name.
    await checkWrappedKeyFile(ctx, temporary, checked.npub)
    linkSync(temporary, file)
    return {file, npub: checked.npub}
  } finally {
    raw?.fill(0); encoded.fill(0)
    if (temporary && ownsTemporary) unlinkSync(temporary)
  }
}

/** Verify a selected backup file without loading its account or returning its secret. */
export async function checkWrappedKeyFile(ctx: IdentityContext, file: string, expectedNpub: string) {
  const bytes = readSmallFile(file)
  try { return await ctx.checkWrappedIdentity(bytes.toString('utf8').trim(), expectedNpub) }
  finally { bytes.fill(0) }
}

/** Explicit owner restore into this local process; selection still requires switch(npub). */
export async function loadWrappedKeyFile(ctx: IdentityContext, file: string, expectedNpub: string) {
  const bytes = readSmallFile(file)
  try { return await ctx.importWrappedIdentity(bytes.toString('utf8').trim(), expectedNpub) }
  finally { bytes.fill(0) }
}
