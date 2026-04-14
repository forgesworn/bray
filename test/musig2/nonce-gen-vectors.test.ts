import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { nonceGenInternal } from '../../src/musig2/handlers.js'

const here = dirname(fileURLToPath(import.meta.url))
const vectors = JSON.parse(
  readFileSync(join(here, 'nonce_gen_vectors.json'), 'utf8'),
) as {
  test_cases: Array<{
    rand_: string
    sk: string | null
    pk: string
    aggpk: string | null
    msg: string | null
    extra_in: string | null
    expected_secnonce: string
    expected_pubnonce: string
  }>
}

describe('BIP-327 NonceGen official test vectors', () => {
  for (const [i, tc] of vectors.test_cases.entries()) {
    it(`vector ${i}: sk=${tc.sk ? 'set' : 'null'}, msg=${tc.msg === null ? 'null' : `${tc.msg.length / 2}B`}`, () => {
      const result = nonceGenInternal({
        rand: hexToBytes(tc.rand_),
        sk: tc.sk ? hexToBytes(tc.sk) : null,
        pk: hexToBytes(tc.pk),
        aggpk: tc.aggpk ? hexToBytes(tc.aggpk) : null,
        msg: tc.msg === null ? null : hexToBytes(tc.msg),
        extraIn: tc.extra_in ? hexToBytes(tc.extra_in) : null,
      })

      expect(bytesToHex(result.secNonce).toUpperCase()).toBe(tc.expected_secnonce.toUpperCase())
      expect(bytesToHex(result.pubNonce).toUpperCase()).toBe(tc.expected_pubnonce.toUpperCase())
    })
  }
})
