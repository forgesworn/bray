import { describe, it, expect } from 'vitest'
import { resolveRecipient } from '../src/resolve.js'

describe('resolveRecipient error redaction', () => {
  it('resolves 64-char hex passthrough', async () => {
    const hex = 'a'.repeat(64)
    const result = await resolveRecipient(hex)
    expect(result.pubkeyHex).toBe(hex)
    expect(result.resolvedVia).toBe('hex')
  })

  it('redacts nsec in error message', async () => {
    const nsec = 'nsec1' + 'a'.repeat(58)
    await expect(resolveRecipient(nsec)).rejects.toThrow(/nsec1/)
    await expect(resolveRecipient(nsec)).rejects.toThrow(/redacted/)
    // The raw secret body must not leak
    await expect(resolveRecipient(nsec)).rejects.not.toThrow(new RegExp('a'.repeat(30)))
  })

  it('redacts ncryptsec in error message', async () => {
    const ncrypt = 'ncryptsec1' + 'b'.repeat(80)
    await expect(resolveRecipient(ncrypt)).rejects.toThrow(/ncryptse/)
    await expect(resolveRecipient(ncrypt)).rejects.toThrow(/redacted/)
    await expect(resolveRecipient(ncrypt)).rejects.not.toThrow(new RegExp('b'.repeat(30)))
  })

  it('does not enumerate known contact names on failure', async () => {
    const known = new Map([
      ['alice', 'a'.repeat(64)],
      ['bob', 'b'.repeat(64)],
      ['carol', 'c'.repeat(64)],
    ])
    await expect(resolveRecipient('unknown-name', known)).rejects.toThrow(/Cannot resolve/)
    await expect(resolveRecipient('unknown-name', known)).rejects.not.toThrow(/alice/)
    await expect(resolveRecipient('unknown-name', known)).rejects.not.toThrow(/carol/)
  })

  it('truncates very long inputs in error message', async () => {
    const longInput = 'zzz' + 'x'.repeat(500)
    await expect(resolveRecipient(longInput)).rejects.toThrow(/\d+ chars/)
  })
})
