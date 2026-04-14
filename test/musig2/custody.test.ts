import { describe, it, expect, beforeEach } from 'vitest'
import {
  handleMusig2Key,
  handleMusig2Nonce,
  handleMusig2PartialSign,
  __resetMusig2NonceStore,
} from '../../src/musig2/handlers.js'

describe('MuSig2 server-held nonce custody', () => {
  beforeEach(() => __resetMusig2NonceStore())

  const msg = 'a'.repeat(64)

  it('returns an opaque nonceId, not secret material', () => {
    const { secKey } = handleMusig2Key()
    const { nonceId, pubNonce } = handleMusig2Nonce(secKey, { msg })
    expect(nonceId).toMatch(/^[0-9a-f]{64}$/)
    expect(pubNonce).toMatch(/^[0-9a-f]{132}$/)
  })

  it('rejects a second partialSign call with the same nonceId (reuse guard)', () => {
    const { secKey, pubKey } = handleMusig2Key()
    const { nonceId, pubNonce } = handleMusig2Nonce(secKey, { msg })

    // First call consumes the nonce. It may throw for other reasons
    // (single-signer keyAgg quirks) — we only care that the second call
    // is rejected specifically for reuse.
    try { handleMusig2PartialSign(secKey, nonceId, [pubNonce], [pubKey], msg) } catch { /* ignore */ }

    expect(() => handleMusig2PartialSign(secKey, nonceId, [pubNonce], [pubKey], msg))
      .toThrow(/unknown or already-consumed nonceId/)
  })

  it('rejects partialSign when secKey does not match the nonce-bound pubkey', () => {
    const signerA = handleMusig2Key()
    const signerB = handleMusig2Key()
    const { nonceId, pubNonce } = handleMusig2Nonce(signerA.secKey, { msg })

    expect(() => handleMusig2PartialSign(signerB.secKey, nonceId, [pubNonce], [signerA.pubKey], msg))
      .toThrow(/does not match the pubkey bound to this nonce/)
  })

  it('rejects an unknown nonceId', () => {
    const { secKey, pubKey } = handleMusig2Key()
    const fakeId = 'f'.repeat(64)
    expect(() => handleMusig2PartialSign(secKey, fakeId, ['00'.repeat(66)], [pubKey], msg))
      .toThrow(/unknown or already-consumed nonceId/)
  })
})
