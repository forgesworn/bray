# AGENTS.md — nostr-bray

Generic AI agent instructions. For Claude Code see `CLAUDE.md`, for Cursor see `.cursorrules`.

## What this is

MCP server + CLI giving AI agents sovereign Nostr identities. 235 tools across 27 groups.

## Build & Test

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # ~1180 tests via vitest
npm run lint     # tsc --noEmit
```

## Architecture

```
src/
  index.ts              MCP server entry point (tool registration + HTTP/stdio transport)
  cli.ts                CLI entry point (77 subcommands + shell REPL)
  catalog.ts            ActionCatalog — non-promoted tools, search-actions + execute-action meta-tools
  context.ts            IdentityContext — master key, LRU cache, derive, sign, zeroise
  trust-context.ts      TrustContext — verification (Signet) + proximity (WoT) + access (Dominion)
  signing-context.ts    SigningContext interface (local key or NIP-46 bunker)
  bunker-context.ts     NIP-46 BunkerContext + Heartwood extension probe
  config.ts             Secret loading from env/files, format detection
  relay-pool.ts         Relay connections, SOCKS5h proxy, Tor policy, write queue
  nip65.ts              NIP-65 relay list (signature-verified, TTL cache)
  validation.ts         Shared Zod validators (hexId, relayUrl, validatePublicUrl)
  format.ts             Human-readable CLI formatters
  help.ts               Per-command help with examples
  tool-response.ts      MCP output format helper (json/human)
  identity/             Identity tools (derive, prove, Shamir, NIP-05, migration)
  social/               Social tools (post, DM, blossom, groups, articles, badges, calendar…)
  trust/                Trust tools (attestations, ring sigs, spoken tokens)
  relay/                Relay tools (list, set, query, NIP-11 info, intelligence)
  zap/                  Zap tools (NWC wallet via NIP-47)
  safety/               Safety tools (duress persona, canary sessions/groups/beacons)
  util/                 Utility tools (decode, encode, verify, encrypt, filter, NIP browse)
  workflow/             Workflow tools (trust-score, feed-discover, verify-person, relay-health…)
  marketplace/          Marketplace tools (discover, pay, call, listings)
  privacy/              Privacy tools (ZK range/age/threshold proofs)
  moderation/           Moderation tools (labels, mute lists, pin lists, follow sets, bookmarks)
  signet/               Signet tools (badge, vouch, credentials, policy, challenge)
  vault/                Vault tools (Dominion epoch-based encrypted vaults)
  dispatch/             Dispatch tools (send, check, reply, ack, propose, capabilities)
  handler/              Handler tools (publish + discover NIP-90 DVMs)
  veil/                 WoT filter engine (no tools — internal scoring + cache)
  widgets/              Widget handlers (feed, DM thread, identity picker — no tools.ts)
```

## Tool groups

| Group | Tools | Key tools |
|-------|------:|-----------|
| identity | 16 | `whoami`, `identity-derive`, `identity-switch`, `identity-prove`, `identity-backup-shamir`, `nip05-lookup` |
| social | 15 | `social-post`, `social-reply`, `social-feed`, `social-react`, `social-delete`, `social-repost` |
| dm | 4 | `dm-send`, `dm-read`, `dm-conversation`, `dm-by-name` |
| blossom | 10 | `blossom-upload`, `blossom-list`, `blossom-discover`, `blossom-verify`, `blossom-repair` |
| articles | 3 | `article-publish`, `article-read`, `article-list` |
| wiki | 3 | `wiki-publish`, `wiki-read`, `wiki-list` |
| badges | 4 | `badge-create`, `badge-award`, `badge-accept`, `badge-list` |
| communities | 5 | `community-create`, `community-feed`, `community-post`, `community-approve`, `community-list` |
| groups (NIP-29) | 4 | `group-info`, `group-chat`, `group-send`, `group-members` |
| calendar | 3 | `calendar-create`, `calendar-read`, `calendar-rsvp` |
| search | 3 | `search-notes`, `search-profiles`, `hashtag-feed` |
| community NIPs | 2 | `nip-publish`, `nip-read` |
| scheduling | 4 | `post-schedule`, `post-queue-list`, `post-queue-cancel`, `publish-event` |
| trust | 22 | `trust-attest`, `trust-verify`, `trust-ring-prove`, `trust-ring-lsag-sign`, `trust-spoken-challenge` |
| relay | 13 | `relay-query`, `relay-list`, `relay-set`, `relay-add`, `relay-info`, `relay-count`, `relay-auth`, `relay-discover`, `relay-nip-search`, `relay-compare`, `relay-diversity`, `relay-recommend`, `cast-spell` |
| zap | 9 | `zap-send`, `zap-balance`, `zap-make-invoice`, `zap-list-transactions`, `zap-receipts` |
| safety | 14 | `safety-activate`, `canary-session-create`, `canary-group-create`, `canary-beacon-create`, `canary-duress-detect` |
| utility | 19 | `decode`, `nip44-encrypt`, `nip44-decrypt`, `verify-event`, `key-encrypt`, `key-decrypt`, `nip-list` |
| workflow | 7 | `trust-score`, `verify-person`, `feed-discover`, `identity-setup`, `relay-health`, `onboard-verified` |
| marketplace | 16 | `marketplace-discover`, `marketplace-search`, `marketplace-pay`, `listing-create`, `listing-search` |
| privacy | 10 | `privacy-prove-range`, `privacy-verify-range`, `privacy-prove-age`, `privacy-prove-threshold` |
| moderation | 16 | `label-create`, `list-mute`, `list-pin`, `list-followset-create`, `list-bookmark`, `moderation-filter` |
| signet | 7 | `signet-badge`, `signet-vouch`, `signet-credentials`, `signet-policy-check`, `signet-challenge` |
| vault | 9 | `vault-create`, `vault-encrypt`, `vault-read`, `vault-share`, `vault-rotate`, `vault-members` |
| dispatch | 13 | `dispatch-send`, `dispatch-check`, `dispatch-reply`, `dispatch-ack`, `dispatch-propose`, `dispatch-capability-publish` |
| handler | 2 | `handler-publish`, `handler-discover` |
| catalog | 2 | `search-actions`, `execute-action` |

## Promoted vs catalogued

51 tools are promoted (always visible to Claude). The rest live in the `ActionCatalog` and are discoverable via `search-actions` + runnable via `execute-action`. The server logs the split at startup:

```
nostr-bray: 51 promoted tools + 182 cataloged (235 total)
```

Use `search-actions` when you need a less common capability. Use `execute-action` to run it by name.

## Handler pattern

Each tool group: `handlers.ts` (pure logic) + `tools.ts` (Zod schemas + MCP registration).
Tests mirror at `test/<group>/handlers.test.ts`.

## Conventions

- British English
- ESM only, TypeScript strict
- Commits: `type: description` — no Co-Authored-By
- Security: never return private keys in tool responses, zeroise buffers in `finally` blocks
- Use `ctx.activePublicKeyHex` (not `ctx.activeNpub`) in relay filter fields

## Security-critical paths

Extra care when modifying:

- `src/context.ts` — key material lifecycle, zeroise on eviction/destroy
- `src/zap/handlers.ts` — NWC secret handling, NIP-44 encrypt/decrypt
- `src/config.ts` — secret loading and env var cleanup
- `src/relay-pool.ts` — Tor policy enforcement
- `src/nip65.ts` — event signature verification
- `src/index.ts` — HTTP auth (Bearer token, timing-safe), rate limiting, body size limits
- `src/trust-context.ts` — trust signal aggregation across verification, proximity, access
- `src/signet/` — Signet badge fetching, credential validation, policy enforcement
- `src/vault/` — Dominion vault key derivation, epoch rotation, access tier management

## Trust

- Check `signet-badge` before interacting with unfamiliar pubkeys
- Use `trust-score` for the full composite view (verification + proximity + access)
- Respect vault tiers — do not share decrypted vault content outside its intended audience
- In strict trust mode, content from unknown pubkeys is filtered out automatically

## Key dependencies

nostr-tools, nsec-tree, @forgesworn/ring-sig, @forgesworn/shamir-words, nostr-attestations, spoken-token, canary-kit, signet-protocol, dominion-protocol, zod
