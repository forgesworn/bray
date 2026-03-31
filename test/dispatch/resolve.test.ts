import { describe, it, expect } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { npubEncode, nprofileEncode } from 'nostr-tools/nip19'
import { resolveRecipient, resolveRecipients } from '../../src/resolve.js'

const ALICE_HEX = getPublicKey(Buffer.from('01'.repeat(32), 'hex'))
const BOB_HEX = getPublicKey(Buffer.from('02'.repeat(32), 'hex'))

function makeIdentities(): Map<string, string> {
  const m = new Map<string, string>()
  m.set('alice', ALICE_HEX)
  m.set('bob', BOB_HEX)
  return m
}

describe('resolveRecipient', () => {
  // -------------------------------------------------------------------------
  // Hex passthrough
  // -------------------------------------------------------------------------
  it('resolves a 64-char hex pubkey directly', async () => {
    const result = await resolveRecipient(ALICE_HEX, makeIdentities())
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('hex')
    expect(result.displayName).toBe('alice')
  })

  it('resolves hex without identities map', async () => {
    const result = await resolveRecipient(ALICE_HEX)
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('hex')
    expect(result.displayName).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // NIP-19 (npub)
  // -------------------------------------------------------------------------
  it('resolves an npub to hex', async () => {
    const npub = npubEncode(ALICE_HEX)
    const result = await resolveRecipient(npub, makeIdentities())
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('npub')
    expect(result.displayName).toBe('alice')
  })

  it('resolves an npub with nostr: prefix', async () => {
    const npub = `nostr:${npubEncode(BOB_HEX)}`
    const result = await resolveRecipient(npub, makeIdentities())
    expect(result.pubkeyHex).toBe(BOB_HEX)
    expect(result.resolvedVia).toBe('npub')
  })

  // -------------------------------------------------------------------------
  // NIP-19 (nprofile)
  // -------------------------------------------------------------------------
  it('resolves an nprofile to hex', async () => {
    const nprofile = nprofileEncode({ pubkey: ALICE_HEX, relays: ['wss://relay.trotters.cc'] })
    const result = await resolveRecipient(nprofile, makeIdentities())
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('nprofile')
  })

  // -------------------------------------------------------------------------
  // Name lookup
  // -------------------------------------------------------------------------
  it('resolves a known name (case-insensitive)', async () => {
    const result = await resolveRecipient('Alice', makeIdentities())
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('name')
    expect(result.displayName).toBe('Alice')
  })

  it('resolves a lowercase name', async () => {
    const result = await resolveRecipient('bob', makeIdentities())
    expect(result.pubkeyHex).toBe(BOB_HEX)
    expect(result.resolvedVia).toBe('name')
  })

  it('trims whitespace from input', async () => {
    const result = await resolveRecipient('  alice  ', makeIdentities())
    expect(result.pubkeyHex).toBe(ALICE_HEX)
    expect(result.resolvedVia).toBe('name')
  })

  // -------------------------------------------------------------------------
  // Unknown
  // -------------------------------------------------------------------------
  it('throws for an unknown name', async () => {
    await expect(resolveRecipient('charlie', makeIdentities()))
      .rejects.toThrow(/charlie/)
  })

  it('includes known names in error message', async () => {
    try {
      await resolveRecipient('charlie', makeIdentities())
      expect.fail('Should have thrown')
    } catch (err: any) {
      expect(err.message).toContain('alice')
      expect(err.message).toContain('bob')
    }
  })

  it('throws when no identities map and input is not hex/npub/nip05', async () => {
    await expect(resolveRecipient('alice'))
      .rejects.toThrow(/Cannot resolve/)
  })
})

describe('resolveRecipients', () => {
  it('resolves a mixed array of identifiers in parallel', async () => {
    const npub = npubEncode(BOB_HEX)
    const results = await resolveRecipients(
      [ALICE_HEX, npub, 'alice'],
      makeIdentities(),
    )
    expect(results).toHaveLength(3)
    expect(results[0].pubkeyHex).toBe(ALICE_HEX)
    expect(results[0].resolvedVia).toBe('hex')
    expect(results[1].pubkeyHex).toBe(BOB_HEX)
    expect(results[1].resolvedVia).toBe('npub')
    expect(results[2].pubkeyHex).toBe(ALICE_HEX)
    expect(results[2].resolvedVia).toBe('name')
  })

  it('returns an empty array for empty input', async () => {
    const results = await resolveRecipients([], makeIdentities())
    expect(results).toEqual([])
  })

  it('rejects if any identifier fails', async () => {
    await expect(resolveRecipients([ALICE_HEX, 'unknown'], makeIdentities()))
      .rejects.toThrow(/Cannot resolve/)
  })
})
