import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPublicKey } from 'nostr-tools/pure'
import { npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { IdentityContext } from '../src/context.js'
import { wrapKeyFile, checkWrappedKeyFile, loadWrappedKeyFile } from '../src/identity/wrapped-files.js'

const dir = mkdtempSync(join(tmpdir(), 'bray-wrapped-'))
const ctx = new IdentityContext('11'.repeat(32), 'hex')
const raw = new Uint8Array(32).fill(0x22)
const npub = npubEncode(getPublicKey(raw))

describe('owner-only wrapped key files', () => {
  it('writes a private encrypted file, checks exact identity, loads without activation and never overwrites a backup', async () => {
    const oldEnv = process.env.BRAY_INPUT_DIRS
    process.env.BRAY_INPUT_DIRS = dir
    try {
      const input = join(dir, 'key.txt'), output = join(dir, 'account.nstw')
      writeFileSync(input, nsecEncode(raw), {mode: 0o600})
      expect(await wrapKeyFile(ctx, input, output)).toEqual({file: output, npub})
      const original = readFileSync(output, 'utf8')
      expect(original).toMatch(/^nstw1:/)
      expect(statSync(output).mode & 0o777).toBe(0o600)
      const active = ctx.activeNpub
      expect((await checkWrappedKeyFile(ctx, output, npub)).npub).toBe(npub)
      await expect(checkWrappedKeyFile(ctx, output, active)).rejects.toThrow()
      await expect(wrapKeyFile(ctx, input, output)).rejects.toThrow()
      expect(readFileSync(output, 'utf8')).toBe(original)
      expect((await loadWrappedKeyFile(ctx, output, npub)).origin).toBe('imported')
      expect(ctx.activeNpub).toBe(active)
      expect(readdirSync(dir).some(p => p.endsWith('.tmp'))).toBe(false)
      writeFileSync(input, 'A'.repeat(5000))
      await expect(wrapKeyFile(ctx, input, join(dir, 'bad.nstw'))).rejects.toThrow(/large/)
    } finally {
      if (oldEnv === undefined) delete process.env.BRAY_INPUT_DIRS
      else process.env.BRAY_INPUT_DIRS = oldEnv
      ctx.destroy(); rmSync(dir, {recursive: true, force: true})
    }
  })
})
