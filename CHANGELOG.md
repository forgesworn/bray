# Changelog

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
