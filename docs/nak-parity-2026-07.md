# nostr-bray vs nak — parity review (July 2026)

**Compared:** nak `v0.20.2` (HEAD `160afb5`, 23 Jul 2026) against nostr-bray `1.41.0`.

Method: nak built from source (`CGO_ENABLED=0 go build`) and its complete help tree enumerated — 143 command paths across 34 top-level commands — then diffed against bray's CLI dispatch table and MCP tool manifest.

---

## 1. Positioning

The two tools overlap but are not the same product.

| | nak | nostr-bray |
|---|---|---|
| Primary interface | CLI (single Go binary) | MCP server (stdio) + CLI + npm SDK |
| MCP surface | 6 tools (`nak mcp`) | 250+ tools |
| Nostr SDK | `fiatjaf.com/nostr` (own) | `nostr-tools` |
| Local event store | LMDB, wired into every query | none |
| Outbox model | first-class, `sdk.System` on every command | explicit `outbox relays` / `outbox publish` |
| Distribution | static binary; brew/nix/AUR/docker | npm, requires Node |
| Trust model | none | Signet + WoT + Dominion |

nak is the protocol reference implementation with excellent pipe ergonomics. bray is an agent-facing platform. The useful framing is that nak defines the *protocol coverage floor* bray should meet, and bray's differentiation lives above that floor.

nak's own MCP mode is a 352-line afterthought — `publish_note`, `resolve_nostr_uri`, `search_profile`, `get_outbox_relay_for_pubkey`, `read_events_from_relay`, `search_events`. That axis is not contested.

---

## 2. Closed since this review was first written

| Gap | Resolution |
|---|---|
| NIP-86 sent `bankind` / `listbannedkinds`, which are not spec method names | Fixed; full 25-method coverage plus `listdisallowedkinds` |
| No NIP-42 AUTH in the relay pool | `NOSTR_AUTH` with `off` / `on-demand` / `eager` |
| No proof of work | NIP-13 mining, bounded by deadline and difficulty ceiling |
| `req` silently truncated at the relay's single-REQ cap | `--paginate` / `paginate` |
| No event schema validation | `validate-event` over a pinned Registry of Kinds snapshot |
| No kind lookup | `kind-info` over the same snapshot |
| Filter-based sync, no negentropy | `sync-plan` uses NIP-77 Negentropy where supported |

---

## 3. Commands nak has that bray has no equivalent for

| nak command | paths | NIP | Notes |
|---|---|---|---|
| `git` | 23 | NIP-34 | clone/init/status/sync/fetch/pull/push plus `patch`, `pr`, `issue`. Largest single gap. |
| `wallet` | 11 | NIP-60/61 | Cashu tokens, mints, nutzaps. bray's wallet is NIP-47 NWC — complementary, not overlapping. |
| `podcast` | 4 | — | play/info/list |
| `key expand` / `combine` / `validate` / `default` | 4 | — | bray has `key public` / `encrypt` / `decrypt` only |
| `gift wrap` / `gift unwrap` | 3 | NIP-59 | standalone wrapping of arbitrary events; bray only wraps DMs internally |
| `nsite` | 3 | NIP-5A | static site publish/download |
| `dekey` | 1 | NIP-4E | decoupled encryption keys, multi-device |
| `fs` | 1 | — | FUSE mount, experimental |
| `outbox list` | 1 | NIP-65 | local relay-hint database |
| `curl` (top level) | 1 | NIP-98 | bray has `relay curl`, roughly equivalent |

---

## 4. Depth gaps where both tools have the command

### `event` / publish

Missing from bray: `--musig`, `--envelope`, `--nevent`, `--force-sign`, `-d/-e/-h/-p` tag shortcuts, `--created-at`, `--author`, kind-by-name (`-k "text note"`), `--jq`.

bray has `--no-publish`, `--no-sign`, `--report` and `--quorum` per-relay reporting, plus `--pow`, which nak also has.

### `req`

Missing from bray: `--ids-only` and `--only-missing` (NIP-77 on the query path), `--bare`, `--no-verify`, `--spell` (emit kind 777), `--jq`.

bray has `--min-trust`, which filters results through `TrustContext`. nak has no analogue and structurally cannot.

### `serve`

nak: `--negentropy`, `--grasp`, `--blossom`, `--auth`, `--eager-auth`. bray implements NIP-01 and NIP-11 only.

### `bunker`

nak has `--qrcode` and `--authorized-secrets`; bray has neither. bray has `connect` / `authorize` / `status` / `daemon` subcommands and Heartwood probing, which nak has no equivalent for.

### `blossom`

bray is ahead: 10 tools against nak's 6. But bray's CLI exposes only 3 of its own 10.

---

## 5. What bray has that nak has nothing comparable to

Roughly 200 tools with no nak counterpart:

- **Trust** — Signet verification badges and credentials, WoT proximity scoring, Dominion access tiers, NIP-VA kind 31000 attestations with chains/revocation/temporal validity, SAG and LSAG ring signatures, spoken tokens, `--min-trust` filtering.
- **Identity tree** — nsec-tree hierarchical derivation, named personas, Shamir backup/restore with BIP-39 word shards, migration with linkage proofs.
- **Safety / duress** — canary groups, beacons, sessions, duress personas.
- **Vault** — Dominion epoch-based encrypted access control, key rotation.
- **Privacy** — zero-knowledge range, age and threshold proofs.
- **Dispatch** — AI-to-AI task protocol over encrypted DMs with capability discovery.
- **Marketplace** — L402/x402 paid API discovery and payment, kind 31402.
- **Relay intelligence** — health, diversity, recommendation, comparison, NIP search.
- **Content NIPs** — NIP-23, 52, 58, 72, 54, 99, 32, 51, 89.
- **Operational** — Tor/SOCKS5h policy enforcement, MCP widgets, npm SDK exports.

nak has no library surface at all. It is a binary.

---

## 6. Remaining recommendations

### Worth doing

1. **Standalone NIP-59 `gift wrap` / `gift unwrap`** — the internals already exist in `nip17-wrap.ts`.
2. **`serve --auth --negentropy --blossom`** — the test relay is currently NIP-01 plus NIP-11 only.
3. **Event ergonomics** — tag shortcuts, kind-by-name, `--created-at`, `--envelope`, `--nevent`.
4. **Expose the 7 blossom tools missing from the CLI.**
5. **`bunker --qrcode`.**
6. **`--ids-only` / `--only-missing` on `req`**, reusing the NIP-77 work already done for `sync-plan`.

### Decide rather than default

7. **NIP-34 git** — 23 command paths, arguably a separate product. Skip unless a specific agent use case appears.
8. **NIP-60/61 Cashu** — genuinely complements NWC. Worth it only if agent-held ecash is on the roadmap.
9. **NIP-4E dekey** — multi-device key decoupling would pair well with the identity tree.

### Deliberately not recommended

`--jq` (MCP clients get structured JSON; shell users can pipe to real jq), `fs`/FUSE, `nsite`, `podcast`.

---

## 7. Note on method

An earlier draft of this document recommended building event validation and negentropy sync. Both had already landed on `main` while the review was being written, and the review was measuring against a stale branch. The versions on `main` are better than what the review proposed — the validator pins the registry to an upstream commit and SHA-256 and returns structured issue codes with paths and severities.

Worth checking `main` before acting on any gap listed here.
