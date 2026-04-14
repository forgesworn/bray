/**
 * MuSig2 — BIP-327 multi-signature primitives for Nostr.
 *
 * Implements the four subcommands: key, nonce, partial-sign, aggregate.
 * Pubkeys are x-only hex (32 bytes). Nonce custody is server-side: the
 * `nonce` handler returns an opaque `nonceId`; the secret nonce material
 * never leaves this process. The `partialSign` handler consumes the
 * nonce and deletes it (one-shot), so reuse is structurally impossible.
 *
 * Reference: https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes, concatBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { mod } from '@noble/curves/abstract/modular.js'
import { randomBytes } from '@noble/hashes/utils.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = ReturnType<typeof secp256k1.Point.fromHex>

export interface Musig2KeyResult {
  secKey: string
  pubKey: string
}

export interface Musig2NonceOptions {
  /** 32-byte hex aggregate x-only pubkey (optional, strongly recommended). */
  aggpk?: string
  /** Hex message to be signed (optional, strongly recommended). */
  msg?: string
  /** Hex application-specific extra input (optional). */
  extra?: string
}

export interface Musig2NonceResult {
  /**
   * Opaque 32-byte hex handle. Pass to `handleMusig2PartialSign` exactly once;
   * the underlying secret nonce is deleted on first use.
   */
  nonceId: string
  /** 66-byte hex: R1(33) || R2(33). Share with all co-signers. */
  pubNonce: string
}

export interface Musig2PartialSignResult {
  partialSig: string
}

export interface Musig2AggregateResult {
  sig: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

// ─── Helpers ──────────────────────────────────────────────────────────────────

function taggedHash(tag: string, ...data: Uint8Array[]): Uint8Array {
  const tagHash = sha256(utf8ToBytes(tag))
  return sha256(concatBytes(tagHash, tagHash, ...data))
}

function numTo32b(n: bigint): Uint8Array {
  return hexToBytes(n.toString(16).padStart(64, '0'))
}

function xBytes(P: Point): Uint8Array {
  return hexToBytes(P.x.toString(16).padStart(64, '0'))
}

function hasEvenY(P: Point): boolean {
  return P.y % 2n === 0n
}

function liftX(xb: Uint8Array): Point {
  return secp256k1.Point.fromHex('02' + bytesToHex(xb))
}

function parsePubKey(xOnlyHex: string): Point {
  const bytes = hexToBytes(xOnlyHex.length === 64 ? xOnlyHex : xOnlyHex.slice(2))
  return liftX(bytes)
}

function getSecondKey(pkList: string[]): string | null {
  for (let i = 1; i < pkList.length; i++) {
    if (pkList[i] !== pkList[0]) return pkList[i]
  }
  return null
}

function keyAggListHash(sortedPks: string[]): Uint8Array {
  const concat = concatBytes(...sortedPks.map(pk => hexToBytes(pk)))
  return taggedHash('KeyAgg list', concat)
}

function keyAggCoeff(sortedPks: string[], pk: string, L: Uint8Array): bigint {
  const second = getSecondKey(sortedPks)
  if (second !== null && pk === second) return 1n
  const h = taggedHash('KeyAgg coefficient', L, hexToBytes(pk))
  return mod(BigInt('0x' + bytesToHex(h)), N)
}

function keyAgg(pubKeysHex: string[]): { Q: Point; gacc: bigint; L: Uint8Array; sortedPks: string[] } {
  const sortedPks = [...pubKeysHex].sort()
  const L = keyAggListHash(sortedPks)

  let Q: Point = secp256k1.Point.ZERO
  for (const pk of sortedPks) {
    const a = keyAggCoeff(sortedPks, pk, L)
    const P = parsePubKey(pk)
    Q = Q.add(P.multiply(a))
  }

  const gacc = hasEvenY(Q) ? 1n : N - 1n
  if (!hasEvenY(Q)) Q = Q.negate()

  return { Q, gacc, L, sortedPks }
}

function bytesXor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

function u8(n: number): Uint8Array {
  return new Uint8Array([n & 0xff])
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, false)
  return b
}

function u64be(n: number): Uint8Array {
  const b = new Uint8Array(8)
  const hi = Math.floor(n / 2 ** 32)
  const lo = n >>> 0
  new DataView(b.buffer).setUint32(0, hi, false)
  new DataView(b.buffer).setUint32(4, lo, false)
  return b
}

/**
 * BIP-327 §NonceGen. Deterministic given `rand`; exposed for test vectors.
 *
 * Caller is responsible for providing 32 random bytes in `rand`. When `sk`
 * is supplied, the XOR-with-aux construction defends against partially
 * broken RNGs per the spec.
 */
export function nonceGenInternal(args: {
  rand: Uint8Array
  sk?: Uint8Array | null
  pk: Uint8Array
  aggpk?: Uint8Array | null
  msg?: Uint8Array | null
  extraIn?: Uint8Array | null
}): { secNonce: Uint8Array; pubNonce: Uint8Array; k1: bigint; k2: bigint } {
  const { rand: randIn, sk, pk } = args
  if (randIn.length !== 32) throw new Error('rand must be 32 bytes')
  if (pk.length !== 33) throw new Error('pk must be 33-byte compressed')
  if (sk && sk.length !== 32) throw new Error('sk must be 32 bytes')

  const aggpk = args.aggpk ?? new Uint8Array(0)
  if (aggpk.length !== 0 && aggpk.length !== 32) throw new Error('aggpk must be 32 bytes or empty')
  const extraIn = args.extraIn ?? new Uint8Array(0)
  if (extraIn.length > 0xffffffff) throw new Error('extraIn too large')

  const rand = sk
    ? bytesXor(sk, taggedHash('MuSig/aux', randIn))
    : randIn

  const msg = args.msg
  const msgPrefixed = msg == null
    ? new Uint8Array([0])
    : concatBytes(new Uint8Array([1]), u64be(msg.length), msg)

  const nonceHash = (i: number): bigint => {
    const buf = concatBytes(
      rand,
      u8(pk.length), pk,
      u8(aggpk.length), aggpk,
      msgPrefixed,
      u32be(extraIn.length), extraIn,
      u8(i),
    )
    return mod(BigInt('0x' + bytesToHex(taggedHash('MuSig/nonce', buf))), N)
  }

  const k1 = nonceHash(0)
  const k2 = nonceHash(1)
  if (k1 === 0n || k2 === 0n) throw new Error('NonceGen produced zero scalar (negligible probability)')

  const R1 = secp256k1.getPublicKey(numTo32b(k1), true)
  const R2 = secp256k1.getPublicKey(numTo32b(k2), true)

  const secNonce = concatBytes(numTo32b(k1), numTo32b(k2), pk)
  const pubNonce = concatBytes(R1, R2)

  return { secNonce, pubNonce, k1, k2 }
}

// ─── Server-side nonce custody ────────────────────────────────────────────────

interface StoredNonce {
  k1: bigint
  k2: bigint
  pk: Uint8Array  // 33-byte compressed
  createdAt: number
}

const nonceStore = new Map<string, StoredNonce>()

/** Test-only: purge all stored nonces. */
export function __resetMusig2NonceStore(): void {
  for (const entry of nonceStore.values()) {
    entry.k1 = 0n
    entry.k2 = 0n
    entry.pk.fill(0)
  }
  nonceStore.clear()
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export function handleMusig2Key(): Musig2KeyResult {
  const sk = secp256k1.utils.randomSecretKey()
  const pk = secp256k1.getPublicKey(sk, true)
  const pubKey = bytesToHex(pk.slice(1))
  const secKey = bytesToHex(sk)
  return { secKey, pubKey }
}

/**
 * Generate a MuSig2 nonce bound to the signer's secret key, and optionally
 * to the aggregate pubkey, message, and extra context. Returns an opaque
 * `nonceId`; the secret material stays in this process and is consumed
 * (deleted) on first call to `handleMusig2PartialSign`.
 *
 * Passing `aggpk` and `msg` is strongly recommended: it binds the nonce to
 * the signing session and maximises defence against RNG compromise.
 */
export function handleMusig2Nonce(secKey: string, opts: Musig2NonceOptions = {}): Musig2NonceResult {
  const skBytes = hexToBytes(secKey)
  if (skBytes.length !== 32) throw new Error('secKey must be 32-byte hex')
  const pk = secp256k1.getPublicKey(skBytes, true)

  const rand = randomBytes(32)

  const aggpk = opts.aggpk ? hexToBytes(opts.aggpk) : null
  const msg = opts.msg ? hexToBytes(opts.msg) : null
  const extraIn = opts.extra ? hexToBytes(opts.extra) : null

  let gen: ReturnType<typeof nonceGenInternal> | null = null
  try {
    gen = nonceGenInternal({ rand, sk: skBytes, pk, aggpk, msg, extraIn })

    const nonceId = bytesToHex(randomBytes(32))
    nonceStore.set(nonceId, {
      k1: gen.k1,
      k2: gen.k2,
      pk: Uint8Array.from(pk),
      createdAt: Date.now(),
    })

    const pubNonce = bytesToHex(gen.pubNonce)
    return { nonceId, pubNonce }
  } finally {
    rand.fill(0)
    skBytes.fill(0)
    if (gen) {
      gen.secNonce.fill(0)
    }
  }
}

/**
 * Create a partial signature (BIP-327 §Sign). The `nonceId` is consumed
 * on first use — a second call with the same id throws. This is the
 * primary defence against MuSig2's catastrophic nonce-reuse failure mode.
 */
export function handleMusig2PartialSign(
  secKey: string,
  nonceId: string,
  pubNonces: string[],
  pubKeys: string[],
  msgHex: string,
): Musig2PartialSignResult {
  const stored = nonceStore.get(nonceId)
  if (!stored) {
    throw new Error('musig2: unknown or already-consumed nonceId (nonce reuse is refused)')
  }
  nonceStore.delete(nonceId)

  const skBytes = hexToBytes(secKey)
  try {
    if (skBytes.length !== 32) throw new Error('secKey must be 32-byte hex')

    // Verify the signer's pk matches the one bound to the nonce.
    const derivedPk = secp256k1.getPublicKey(skBytes, true)
    if (bytesToHex(derivedPk) !== bytesToHex(stored.pk)) {
      throw new Error('musig2: secKey does not match the pubkey bound to this nonce')
    }

    const msg = hexToBytes(msgHex)

    let R1: Point = secp256k1.Point.ZERO
    let R2: Point = secp256k1.Point.ZERO
    for (const pn of pubNonces) {
      const pnBytes = hexToBytes(pn)
      const ri1 = secp256k1.Point.fromHex(bytesToHex(pnBytes.slice(0, 33)))
      const ri2 = secp256k1.Point.fromHex(bytesToHex(pnBytes.slice(33, 66)))
      R1 = R1.add(ri1)
      R2 = R2.add(ri2)
    }

    const { Q, gacc, sortedPks, L } = keyAgg(pubKeys)

    const aggnonce = concatBytes(
      hexToBytes(bytesToHex(R1.toBytes(true))),
      hexToBytes(bytesToHex(R2.toBytes(true))),
    )
    const bHash = taggedHash('MuSig/noncecoef', aggnonce, xBytes(Q), msg)
    const b = mod(BigInt('0x' + bytesToHex(bHash)), N)

    let R = R1.add(R2.multiply(b))
    const rHasEvenY = hasEvenY(R)
    if (!rHasEvenY) R = R.negate()

    const eHash = taggedHash('BIP0340/challenge', xBytes(R), xBytes(Q), msg)
    const e = mod(BigInt('0x' + bytesToHex(eHash)), N)

    const k1eff = rHasEvenY ? stored.k1 : mod(N - stored.k1, N)
    const k2eff = rHasEvenY ? stored.k2 : mod(N - stored.k2, N)

    const pkXOnly = bytesToHex(derivedPk.slice(1))
    const a = keyAggCoeff(sortedPks, pkXOnly, L)

    const skBig = mod(BigInt('0x' + bytesToHex(skBytes)), N)
    const actualPk = secp256k1.Point.fromHex(bytesToHex(derivedPk))
    const xeff = hasEvenY(actualPk) ? skBig : mod(N - skBig, N)

    const s = mod(k1eff + b * k2eff + e * a * gacc * xeff, N)

    return { partialSig: bytesToHex(numTo32b(s)) }
  } finally {
    skBytes.fill(0)
    stored.k1 = 0n
    stored.k2 = 0n
    stored.pk.fill(0)
  }
}

export function handleMusig2Aggregate(
  partialSigs: string[],
  pubNonces: string[],
  pubKeys: string[],
  msgHex: string,
): Musig2AggregateResult {
  const msg = hexToBytes(msgHex)

  let R1: Point = secp256k1.Point.ZERO
  let R2: Point = secp256k1.Point.ZERO
  for (const pn of pubNonces) {
    const pnBytes = hexToBytes(pn)
    const ri1 = secp256k1.Point.fromHex(bytesToHex(pnBytes.slice(0, 33)))
    const ri2 = secp256k1.Point.fromHex(bytesToHex(pnBytes.slice(33, 66)))
    R1 = R1.add(ri1)
    R2 = R2.add(ri2)
  }

  const { Q } = keyAgg(pubKeys)

  const aggnonce = concatBytes(
    hexToBytes(bytesToHex(R1.toBytes(true))),
    hexToBytes(bytesToHex(R2.toBytes(true))),
  )
  const bHash = taggedHash('MuSig/noncecoef', aggnonce, xBytes(Q), msg)
  const b = mod(BigInt('0x' + bytesToHex(bHash)), N)

  let R = R1.add(R2.multiply(b))
  if (!hasEvenY(R)) R = R.negate()

  let s = 0n
  for (const ps of partialSigs) {
    s = mod(s + BigInt('0x' + ps), N)
  }

  const sig = bytesToHex(concatBytes(xBytes(R), numTo32b(s)))

  return { sig }
}
