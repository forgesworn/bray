# Changelog

## 1.42.1 (2026-07-28)

### Bug Fixes

- bound bunker connect and make startup non-blocking



## 1.42.0 (2026-07-28)

### Features

- add kind-info lookup over the pinned registry
- mine NIP-13 proof of work before signing
- answer NIP-42 AUTH challenges, off by default
- paginate relay queries past the single-REQ cap

### Bug Fixes

- send NIP-86 spec method names and cover the full management API



## 1.41.0 (2026-07-18)

### Features

- end-holds scale to how much the last screen says



## 1.40.1 (2026-07-18)

### Bug Fixes

- prefer explicit local keys over saved bunker



## 1.40.0 (2026-07-18)

### Features

- add protocol validation, sync, and group foundations



## 1.39.1 (2026-07-18)

### Bug Fixes

- help brought in step with the real CLI



## 1.39.0 (2026-07-18)

### Features

- command atlas pairs every CLI command with its ask
- story recordings compressed to a watchable pace

### Bug Fixes

- shamir copy says the assistant never sees the shares



## 1.38.0 (2026-07-18)

### Features

- terminal one-liners join the tool panels



## 1.37.0 (2026-07-18)

### Features

- try-it-yourself panels replace the solo demo GIFs



## 1.36.0 (2026-07-17)

### Features

- sanitised story recordings for every demo on the site

### Bug Fixes

- await async vault handlers in MCP tool wrappers



## 1.35.1 (2026-07-17)

### Bug Fixes

- mint keys before any configuration exists



## 1.35.0 (2026-07-17)

### Features

- guides with real recordings and a humanised front page



## 1.34.1 (2026-07-12)

### Bug Fixes

- vault config reads follow dominion-protocol kinds (30481)



## 1.34.0 (2026-07-12)

### Features

- send client name metadata on bunker connect (#52)



## 1.33.0 (2026-07-04)

### Features

- bunker --profile <name>, auto-stable connection key, and relay fallback
- add bunker --persona <name> to sign as a derived nsec-tree identity
- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- update vault + attestation for dominion-protocol 0.1.0 and nostr-attestations API changes
- close security audit deferrals (Batches A, B, C)
- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## 0.6.0 (2026-06-22)

### Features

- bunker --profile <name>, auto-stable connection key, and relay fallback
- add bunker --persona <name> to sign as a derived nsec-tree identity
- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- update vault + attestation for dominion-protocol 0.1.0 and nostr-attestations API changes
- close security audit deferrals (Batches A, B, C)
- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## 0.5.0 (2026-06-22)

### Features

- bunker --profile <name>, auto-stable connection key, and relay fallback
- add bunker --persona <name> to sign as a derived nsec-tree identity
- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- update vault + attestation for dominion-protocol 0.1.0 and nostr-attestations API changes
- close security audit deferrals (Batches A, B, C)
- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## 0.4.0 (2026-06-22)

### Features

- add bunker --persona <name> to sign as a derived nsec-tree identity
- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- update vault + attestation for dominion-protocol 0.1.0 and nostr-attestations API changes
- close security audit deferrals (Batches A, B, C)
- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## 0.3.0 (2026-04-17)

### Features

- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- close security audit deferrals (Batches A, B, C)
- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## 0.2.0 (2026-04-16)

### Features

- route all HTTP fetches through Tor SOCKS proxy when configured
- BIP-327 compliant MuSig2 NonceGen with server-held nonce custody
- wallet subcommands for NIP-47 Nostr Wallet Connect (Phase 4 D)
- Phase 4A trust-aware req variants and trust-rank command
- Phase 4 G — bunker connect/authorize/status subcommands
- Phase 4 F — NIP-29 group admin write ops (create/update/add-user/remove-user/set-roles)
- Phase 4 E+H — output format flags (--jsonl/--csv/--tsv), NIP-65 outbox helpers
- Phase 4 B+C — publish-raw quorum/timeout/report, subscribe streaming
- Items 17-19 — sync pull/push, NIP-86 admin, relay curl
- add nostr-bray/types barrel and @experimental tags on unstable categories
- barrel exports + subpath entry points — Item 9
- add SDK factory (createBray / defaultBray) — Item 8
- normalise CLI verbs to space-separated subcommand style
- add req CLI verb for generic NIP-01 filter queries
- add event CLI verb for arbitrary event construction
- add per-command --relay flag to all publishing commands
- add bunker sign one-shot NIP-46 signing command
- add publish-raw command (sign+broadcast pre-built events)

### Bug Fixes

- update musig2 2-of-2 flow test for server-held nonce custody
- validate default relays in RelayPool constructor
- add BRAY_ALLOW_PRIVATE_RELAYS opt-in for dev relays
- enforce Blossom upload cap on every input path
- secret zeroisation discipline and .gitignore hardening
- privacy leak in profile-set preview and resolveRecipient errors
- tighten input validation across tool boundaries
- HTTP transport bearer-auth and rate-limit hardening
- harden SSRF validation and relay URL checks



## [0.1.0] — 2026-04-14

First public release. Covers CLI parity with nak, the SDK surface, and trust-aware extensions.

### New CLI commands

| Command | Description |
|---------|-------------|
| `publish-raw` | Sign and broadcast a pre-built event from stdin (NIP-01) |
| `bunker sign` | One-shot NIP-46 signing without storing a bunker session |
| `bunker connect` | Start a persistent bunker session |
| `bunker authorize` | Approve a pending NIP-46 authorisation request |
| `bunker status` | Show active bunker session |
| `event` | Construct and publish an arbitrary Nostr event |
| `req` | Generic NIP-01 filter query |
| `subscribe` | Long-running subscription with streamed output |
| `trust-rank` | Compute and display WoT trust rank for a pubkey |
| `wallet connect` | Register a NIP-47 NWC connection URI |
| `wallet disconnect` | Remove a stored NWC connection |
| `wallet status` | Show active wallet connection |
| `wallet pay` | Pay a Lightning invoice via NWC |
| `wallet balance` | Query wallet balance |
| `wallet history` | List recent payment history |
| `outbox-relays` | Fetch NIP-65 outbox relay list for a pubkey |
| `outbox-publish` | Publish to a pubkey's outbox relays |
| `sync-pull` | Pull events from a relay into local storage |
| `sync-push` | Push locally-held events to a relay |
| `relay-curl` | Raw relay WebSocket probe |
| `admin-*` | NIP-86 relay admin commands (allow/ban pubkey, kind, IP) |
| `group-create` | NIP-29 group creation |
| `group-update` | NIP-29 group metadata update |
| `group-add-user` | Add user to NIP-29 group |
| `group-remove-user` | Remove user from NIP-29 group |
| `group-set-roles` | Set roles on a NIP-29 group member |
| `musig2-key` | MuSig2 BIP-327 key aggregation |
| `musig2-nonce` | MuSig2 nonce generation |
| `musig2-partial-sign` | MuSig2 partial signature |
| `musig2-aggregate` | MuSig2 signature aggregation |

### New flags

- `--relay <url>` — per-command relay override on all publishing commands
- `--min-trust <score>` — filter `req` results by minimum trust score
- `--report` — print per-relay outcome after `publish-raw`
- `--timeout <ms>` — relay timeout for `publish-raw`
- `--quorum <n>` — require `n` relay confirmations for `publish-raw`
- `--jsonl` / `--csv` / `--tsv` — output format on every command

### CLI changes

**Verb style**: compound verbs now use space-separated subcommand style everywhere. Pass the noun and subverb as separate arguments — `bray key encrypt` rather than `bray key-encrypt`. Both forms are accepted; the space form is canonical.

**Migration table** for callers that previously passed a hyphenated single argument:

| Old (single hyphenated arg) | New (space-separated) |
|-----------------------------|----------------------|
| `key-encrypt` | `key encrypt` |
| `key-decrypt` | `key decrypt` |
| `dm-read` | `dm read` |
| `proof-publish` | `proof publish` |
| `profile-set` | `profile set` |
| `encode-npub` | `encode npub` |
| `encode-note` | `encode note` |
| `encode-nprofile` | `encode nprofile` |
| `encode-nevent` | `encode nevent` |
| `encode-nsec` | `encode nsec` |
| `trust-read` | `trust read` |
| `trust-verify` | `trust verify` |
| `trust-revoke` | `trust revoke` |
| `trust-request` | `trust request` |
| `nip-publish` | `nip publish` |
| `nip-read` | `nip read` |
| `relay-set` | `relay set` |
| `ring-prove` | `ring prove` |
| `ring-verify` | `ring verify` |

**`cli.ts` split**: the monolithic 947-line `src/cli.ts` has been split into per-category modules under `src/cli/commands/`. No user-visible change.

### SDK (new in 0.1.0)

`nostr-bray` now exports a full SDK surface. Import patterns:

```ts
// Full factory
import { createBray, defaultBray } from 'nostr-bray'
const bray = await defaultBray()
const result = await bray.identity.whoami()

// Category subpath (tree-shakeable)
import { whoami } from 'nostr-bray/identity'
import { dmRead } from 'nostr-bray/social'

// Types only
import type { BrayConfig, IdentityResult } from 'nostr-bray/types'
```

Subpath exports: `nostr-bray/identity`, `nostr-bray/social`, `nostr-bray/trust`,
`nostr-bray/relay`, `nostr-bray/zap`, `nostr-bray/vault`, `nostr-bray/dispatch`,
`nostr-bray/signet`, `nostr-bray/moderation`, `nostr-bray/privacy`,
`nostr-bray/marketplace`, `nostr-bray/workflow`, `nostr-bray/types`.

Package is marked `"sideEffects": false` for bundler tree-shaking.

Categories marked `@experimental` in TSDoc may change shape in 0.1.x patches.

### `loadConfig` bunker-URI fallback

`loadConfig()` now accepts a `NOSTR_BUNKER_URI` environment variable as a
fallback when no `NOSTR_SECRET_KEY` is present. The CLI picks this up
automatically; SDK callers can pass `{ bunkerUri }` to `createBray()`.
