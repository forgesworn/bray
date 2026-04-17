# Security Audit — 2026-04-14

Findings and fix status. Branch: `security-audit-2026-04-14`.

## Summary

| Severity | Found | Fixed (this branch) | Closed in 0.2.0 + follow-up | Open |
|----------|------:|--------------------:|----------------------------:|-----:|
| CRITICAL | 4 | 4 | 0 | 0 |
| HIGH | 16 | 11 | 5 | 0 |
| MEDIUM | 15 | 1 | 14 | 0 |
| LOW/INFO | 20 | 1 | 6 | 13 |

Tests: 1400 → 1427 (+27 new) → 1462+ after security-followup-2026-04-17. All pass. Typecheck clean.

**Update 2026-04-17 (pt 2):** Batch C closed all remaining MEDIUM items and shipped the two investigations (M12, L1) as real fixes. MuSig2 HIGH items closed by 0.2.0. Remaining open items are all LOW-severity hygiene.

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

## Closed in 0.2.0 (commits e743775, 5b3a922)

**HIGH — MuSig2 (`src/musig2/handlers.ts`)** — all three items closed by the BIP-327-compliant rewrite landed in v0.2.0.

- ~~MuSig2 nonce generation not BIP-327 §NonceGen compliant.~~ **CLOSED.** `nonceGenInternal` at `src/musig2/handlers.ts:155-205` implements §NonceGen with full hash binding over `rand || pk || aggpk || msg_prefixed || extraIn || i`, including the `MuSig/aux` XOR construction defending against partially broken RNGs.
- ~~MuSig2 `secNonce` never zeroised.~~ **CLOSED.** `handleMusig2Nonce` at `src/musig2/handlers.ts:272-278` zeroises `rand`, `skBytes`, and `gen.secNonce` in a `finally` block. Server-held nonce custody (see below) means the secret nonce never leaves the process.
- ~~No protection against `secNonce` reuse.~~ **CLOSED.** Server-held nonce custody via `nonceStore` Map at `src/musig2/handlers.ts:216`. `handleMusig2PartialSign` at `src/musig2/handlers.ts:293-297` calls `nonceStore.delete(nonceId)` on first use; a second call with the same `nonceId` throws `"musig2: unknown or already-consumed nonceId (nonce reuse is refused)"`. Replaces the hex-`secNonce`-on-the-wire pattern entirely.

## Closed in security-followup-2026-04-17 (Batch B)

**MEDIUM**
- `ws://` scheme no longer permitted on clearnet relays. RelayPool rejects `ws://` URLs unless host is `.onion`. Wider relay-set + NIP-65 r-tag paths reuse the same gate.
- Relay info `fetch` validates `Content-Type` is `application/nostr+json` or `application/json` before `JSON.parse`. Mismatched responses throw before parsing.
- NIP-65 fallback fail-open now logs a `console.warn` when verified-events count is zero, including the npub being resolved.
- `state.ts` writes are atomic (tmp + rename) with `0o600` mode set on the tmp file before rename.
- `parseIdentities` enforces a 1 MiB input cap and a 10 000-line cap.
- `format.ts` strips ANSI escape sequences from all relay-supplied content fields (profiles, posts, DMs, notifications, articles, listings, communities, wiki) via a single `sanitiseTerminal` helper.

**LOW**
- `BIND_ADDRESS` warning banner: `config.ts` logs a `console.warn` on startup when bind address is non-loopback, naming the source (env vs config file).
- `serve.ts` test relay logs a loud warning when bound to a non-loopback hostname.

## Closed in security-followup-2026-04-17 (Batch C)

**MEDIUM**
- **M2** — HTTP transport documented as single-user. `src/index.ts` emits a startup warning explaining that session state is process-global and a second client will share it. Multi-tenant refactor tracked as future work.
- **M5** — DM tools (`dm-read`, `dm-conversation`) now pass `deps.trust` into the handler, so the configured trustMode actually annotates/filters DMs instead of silently failing open.
- **M6** — `validateInputPath` in `src/validation.ts` enforces an allowlist for user-supplied file paths. Default allowlist is `cwd()` + `~/.config/bray/inputs/`; override via `BRAY_INPUT_DIRS`. Applied to `handleIdentityRecover.shardPaths`, `handleRestoreShamir`, and the CLI `nip-publish <file>` path.
- **M7** — `ncryptsec` password now supports `NOSTR_NCRYPTSEC_PASSWORD_FILE` / `ncryptsecPasswordFile`. The file-sourced path reads a `Buffer` and zeroises it in the `finally` so the at-rest password bytes are wiped from the heap, not only GC-staged. V8 strings remain immutable so the UTF-8 decode still leaves a string until GC — documented accordingly.
- **M10** — `handleTrustRank` uses a per-(ctx, pool) `WeakMap` cache so subsequent calls reuse the TrustContext and its internal caches, eliminating the per-call follow-graph and Signet refetch.
- **M12** — `handleSocialProfileSet` filters the kind-0 query by `pubkey === ctx.activePublicKeyHex` before building the diff, so a hostile relay cannot leak a foreign identity's profile into `diff.old`.

**LOW**
- **L1** — `HeartwoodContext.probe` validates the `heartwood_list_identities` response is an array of objects with an `npub` field before promoting the base context. A bare number/string/`[]` response no longer upgrades the prototype.
- **L2** — Closed as won't-fix. `writeStateFile` now delivers NWC URI storage with `0o600` + atomic write, matching the convention used by SSH keys, GPG keyrings, Age secrets, and similar at-rest credentials. NIP-49 wrapping reserved for a future feature if demanded.

## Open (tracked)

**MEDIUM — open**
- None.

**LOW — open (hygiene items from the 2026-04-14 branch not picked up yet)**
- Multi-tenant HTTP refactor — if demand materialises, convert to per-session `McpServer` with a session map. Today's single-user warning is the stopgap.

**Already addressed in 2026-04-14 branch:**
- ~~HTTP fetch callsites bypass Tor proxy.~~ Fixed in `src/http-client.ts` via global undici dispatcher swap. Configured once from `src/index.ts`, `src/sdk.ts`, `src/cli/index.ts`.
- ~~Profile set signing in preview mode.~~ Item 14 above.

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
