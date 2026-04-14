# MuSig2 security notes (pre-merge checklist)

**Status:** `src/musig2/` and `src/cli/commands/musig2.ts` are uncommitted. The security audit on branch `security-audit-2026-04-14` identified three HIGH findings that must be addressed before committing these files.

The findings relate to BIP-327 compliance. MuSig2 is catastrophic on nonce reuse — a single reuse with the same signer but different messages recovers the private key completely, the same way ECDSA nonce reuse does.

## Finding 1 — NonceGen not BIP-327 compliant

**File:** `src/musig2/handlers.ts:154-169` (`handleMusig2Nonce`)

**Current:**
```ts
const k1 = secp256k1.utils.randomSecretKey()
const k2 = secp256k1.utils.randomSecretKey()
```

**Expected (BIP-327 §NonceGen):** `k1`, `k2` derived by hashing a structured input:

```
rand          — 32 bytes from a CSPRNG
| len(sk)      — u8
| sk           — signer secret key (32 bytes)
| len(aggpk)   — u8
| aggpk        — aggregate public key (32 bytes) or empty
| len(msg)     — u8 (0 if msg unknown)
| msg          — message to be signed (if known)
| len(extra)   — u8
| extra        — application-specific context
| i            — u8 (0 for k1, 1 for k2)
```

Each `k_i` is `SHA256(tag || encoding) mod n` with tag `"MuSig/nonce"`.

**Why it matters:** The BIP's HashDigest construction is specifically designed to stay safe even when the caller's RNG is partially broken. Pure-RNG nonces fail catastrophically if the process seed ever leaks or if randomness is low-entropy on embedded systems / early boot / containers.

**Fix:** Replace the two `randomSecretKey()` calls with a spec-compliant derivation that takes `aggpk`, `msg`, and `extra` as inputs. Add BIP-327 test vectors to a new `test/musig2/` test file.

## Finding 2 — `secNonce` not zeroised

**File:** `src/musig2/handlers.ts:182-249` (`handleMusig2PartialSign`)

The handler reads `secNonce` (hex string) and parses it into `k1`, `k2` BigInts, but never overwrites the input buffer or scalar intermediates. The hex string itself is immutable in V8 and lingers until GC.

**Fix:** Call `secNonceBytes.fill(0)` in a `finally` block. Document in the tool description that `secNonce` must be consumed exactly once and discarded. Consider refactoring to server-held nonce state: the MCP tool holds the nonce internally and accepts only an opaque reference from the caller, so the secret never enters user-observable state.

## Finding 3 — No guard against `secNonce` reuse

**File:** `src/musig2/handlers.ts` — handler-layer responsibility.

Nothing prevents an AI agent (the intended principal) from calling `handleMusig2PartialSign` twice with the same `secNonce` across two different messages. That single mistake recovers the private key.

**Fix:** Maintain a module-level `Set<string>` of consumed nonce hashes (`SHA256(secNonce)`). On each call, check membership before signing; reject with a clear, loud error if the nonce has been seen before. Add the nonce hash to the set after successful sign.

Alternative and stronger: hold nonces server-side in memory, return only an opaque `nonceId` to the caller, and delete the entry after a single partial-sign call. The hex `secNonce` never leaves the server process.

## Suggested test coverage (currently zero)

- Round-trip: key → nonce → partial-sign × N → aggregate → `schnorr.verify` against aggregated pubkey.
- BIP-327 test vectors (official test vectors at https://github.com/bitcoin/bips/blob/master/bip-0327/vectors).
- Nonce-reuse rejection (after fix 3 is in): assert that the second partial-sign call with the same `secNonce` throws.
- Even-y normalisation of both `Q` and `R` — edge cases around the negation paths.
- KeyAgg list hash / coefficient matches reference implementations for a fixed set of public keys.

## Checklist

- [x] NonceGen implemented per BIP-327 §NonceGen with hash binding over sk/aggpk/msg/extra.
- [x] `secNonce` kept server-side with one-shot delete (preferred option). Secret material never leaves the process; callers hold an opaque `nonceId` only.
- [x] Nonce-reuse guard in place and tested (second use of a `nonceId` throws).
- [x] BIP-327 NonceGen official test vectors pass (all 4).
- [x] CLI updated: `musig2 nonce` returns `nonceId`; `musig2 partial-sign` takes `--nonce-id`. The id is single-use by construction.

## Remaining (Finding 4, follow-up PR)

The pre-existing `keyAgg` / `handleMusig2PartialSign` / `handleMusig2Aggregate` paths use 32-byte x-only pubkeys, but BIP-327 mandates 33-byte compressed pubkeys for KeyAgg (the `L` hash concatenates 33-byte encodings; KeyAggCoeff input differs). These paths will not interop with other MuSig2 implementations until rewritten. Track separately; this PR scoped to NonceGen + custody only.
