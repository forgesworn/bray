# Security Audit — 2026-04-14

Findings and fix status. Branch: `security-audit-2026-04-14`.

## Summary

| Severity | Found | Fixed (this branch) | Deferred |
|----------|------:|--------------------:|---------:|
| CRITICAL | 4 | 4 | 0 |
| HIGH | 16 | 11 | 5 |
| MEDIUM | 15 | 1 | 14 |
| LOW/INFO | 20 | 1 | 19 |

Tests: 1400 → 1427 (+27 new). All pass. Typecheck clean.

## Fixed in this branch

**CRITICAL**
1. `relay-add` / `relay-set` skipped SSRF validation — now call `validateRelayUrl` before mutating pool or signing kind-10002.
2. `RelayPool.reconfigure` trusted URLs when Tor was off — now runs `validatePublicUrl` on every URL unconditionally, with `.onion` hosts bypassing (they don't resolve in DNS).
3. `execute-action` forwarded unvalidated params when a catalog entry had no `inputSchema` — now fails closed.
4. `verify-event`, `trust-verify`, `trust-attest-parse` accepted `z.record(z.unknown())` and cast to `any` — now use the shared `nostrEventSchema` (hex id/pubkey/sig, bounded kind and created_at, array-of-arrays tags).

**HIGH**
5. `validatePublicUrl` expanded to cover IPv6 loopback (`::1`, `::`, `::ffff:`), ULA (`fc00::/7`), link-local (`fe80::/10`), `0.0.0.0/8`, CGNAT (`100.64/10`), cloud metadata aliases, reserved TLDs (`.local`, `.internal`, `.localhost`), integer-only hostnames, and hex/octal-prefixed hostnames.
6. `isOnion` tightened to require v2 (16 chars) or v3 (56 chars) base32, so `127.0.0.1.onion` no longer bypasses the Tor gate.
7. NIP-65 `parseRelayTags` caps at 50 r-tags and 512-char URLs, and silently drops any tag that fails `validatePublicUrl`.
8. Bearer-token constant-time compare no longer short-circuits on length difference — token is copied into a padded buffer and `timingSafeEqual` always runs.
9. Rate-limit map capped at 10k entries, oldest evicted on overflow.
10. Blossom upload cap enforced on `data` and `sourceUrl` paths, not just `filePath`. Streaming reader aborts mid-transfer when bounds exceeded.
11. NIP-17 unwrapped rumor revalidated before its fields flow into `DmReadEntry`.
12. Zap receipt description parsed through a Zod schema — `pubkey` bounded to string length, `tags` required to be an array-of-arrays.
13. `identity-derive` and `identity-derive-persona` purpose/name constrained to `/^[a-z0-9-]{1,32}$/`; index bounded to int32 max.
14. `handleSocialProfileSet` no longer signs a kind-0 event in preview mode — the signed overwrite could previously leak via MCP response logs.
15. `resolveRecipient` redacts `nsec1…` / `ncryptsec1…` inputs in error messages and no longer enumerates known contact names.

**MEDIUM**
16. WebSocket `maxPayload` clamped to 512 KiB on both Tor-proxied and direct connections (nostr-tools leaves it at ws's 100 MiB default).
17. HTTP POST body `Content-Length` preflight added — oversized requests rejected before streaming.

**LOW**
18. `.gitignore` expanded to cover common secret filename patterns (`.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials.json`, `serviceAccountKey.json`).
19. Secret-zeroisation discipline: `ncryptsec` password reference dropped immediately after `decrypt()` returns. `handleIdentityRecover` hex-string reference dropped likewise. V8 strings are immutable so this is GC-timing hardening, not wipe.

## Deferred (tracked for follow-up)

**HIGH — in untracked MuSig2 code (`src/musig2/`, `src/cli/commands/musig2.ts`)**
- **MuSig2 nonce generation not BIP-327 §NonceGen compliant.** Handler uses plain `randomSecretKey()` for `k1`, `k2`; BIP-327 mandates hash binding over `rand || sk || aggpk || msg || extra || i`. On any RNG degradation or seed leak, nonce reuse with the same signer produces full private-key recovery — the canonical catastrophic MuSig2 failure. Fix: implement §NonceGen exactly.
- **MuSig2 `secNonce` never zeroised.** The hex-encoded 97-byte secret nonce is returned to the caller and never cleared from the parsing buffers. Combined with any retry/log, this leaks nonce material. Fix: zeroise the input `secNonceBytes` in a `finally`, and either store nonces server-side with one-shot delete semantics or document loudly that `secNonce` must be consumed exactly once.
- **No protection against `secNonce` reuse.** A caller can invoke `handleMusig2PartialSign` twice with the same `secNonce` across different message sets; this is the single catastrophic MuSig2 failure mode. Fix: maintain a process-level `Set<hash(secNonce)>` of consumed nonces and reject reuse.

Not fixed here because these files are your uncommitted work-in-progress. **Address before committing.** See `docs/musig2-security-notes.md` for the reviewer's reasoning.

**HIGH — architectural, addressed in follow-up**
- ~~**HTTP fetch callsites bypass Tor proxy.**~~ Originally: only WebSocket connections went through the SOCKS agent; every `fetch()` went clearnet, leaking DNS and IP on every NIP-05 lookup, Blossom operation, and relay-info fetch. Fixed in `src/http-client.ts`: when `TOR_PROXY` is set, the global undici dispatcher is swapped to a `Socks5ProxyAgent` at startup, so every `fetch()` in the process (including any added in future) flows through the proxy with `ATYP=DOMAIN` semantics — DNS happens at the proxy, no clearnet leak. Configured once from `src/index.ts`, `src/sdk.ts`, `src/cli/index.ts`. Structural protection rather than discipline-based; no callsite needs to opt in.

**HIGH — profile set signing**
- (Addressed above — item 14.)

**MEDIUM — not fixed**
- `ws://` scheme permitted on clearnet relays — signed events sent over unencrypted WebSocket. Consider blocking unless the host is `.onion`.
- Session creation drops other sessions — multi-tenant HTTP transport is broken. Document as single-user only, or refactor to per-session `McpServer`.
- Relay `fetch` lacks content-type check before 1 MiB JSON.parse.
- NIP-65 fallback fail-open on no-verified-events should log a warning.
- Trust filtering fail-open when context is undefined (M1 from reviewer 4): defend by typing the context as non-optional.
- Input obviously-private path traversal not enforced on user-supplied `shardPaths` or `filePath` fields (Shamir recover, nip-publish from disk). Restrict to an allowlisted directory.
- `ncryptsec` password in file-sourced config stays in closure until GC.
- `state.ts` writes are non-atomic (write then chmod). Use tmp+rename.
- `parseIdentities` has no input size limit.
- `trust-rank` creates a fresh TrustContext per call (performance, not security).
- `format.ts` interpolates relay content without stripping ANSI escapes.
- `handleSocialProfileSet.diff.old` may blend content from a different identity's prior publications under the current persona's response.

**LOW — not fixed**
- HeartwoodContext probe promotes prototype on any parseable response.
- NWC URI stored in plaintext on disk (0o600 is present).
- `BIND_ADDRESS` and `homepage` fields trusted from env without warning banner.
- `serve.ts` test relay has no loud warning when bound to non-loopback.

## Test coverage added

- `test/validation.test.ts` — 22 tests covering expanded SSRF ranges and obfuscated-IP rejection.
- `test/resolve.test.ts` — 5 tests asserting nsec/ncryptsec redaction and non-enumeration of known contacts.
- `test/dispatch/resolve.test.ts` updated — asserts non-enumeration contract (was previously asserting the leaky behaviour).
- `test/relay-pool.test.ts` updated — uses a valid v3 onion label now that `isOnion` is strict.

## Not audited

- `dist/`, `node_modules/` — build output and vendor code.
- `test/fixtures/` — mock data.
- `docs/`, `*.md` — documentation files.
- Untracked `src/musig2/` and `src/cli/commands/musig2.ts` — reviewed but not modified; findings above.

## Merge

```
git checkout main && git merge security-audit-2026-04-14
```
