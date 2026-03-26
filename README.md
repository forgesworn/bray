# nostr-bray

> Sovereign Nostr identities for AI agents

[![CI](https://github.com/forgesworn/bray/actions/workflows/ci.yml/badge.svg)](https://github.com/forgesworn/bray/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nostr-bray)](https://www.npmjs.com/package/nostr-bray)
[![coverage](https://img.shields.io/badge/coverage-96%25-brightgreen)](./package.json)
[![licence](https://img.shields.io/npm/l/nostr-bray)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)](./tsconfig.json)

An MCP server that gives AI agents a full Nostr identity — not just a key pair, but a hierarchical identity tree with personas, attestations, ring signatures, encrypted DMs, and duress detection. 77 tools across 10 groups.

## The Problem

AI agents interacting with Nostr today are handed a single key pair with no separation of concerns. One compromised session leaks everything. There is no way to rotate keys, prove identity links, or maintain separate personas for different contexts.

nostr-bray solves this with nsec-tree hierarchical derivation. A single master secret generates unlimited child identities, each with its own key pair, purpose, and relay set. Private keys are zeroed from memory on eviction. Agents can switch personas mid-conversation, prove they control the master without revealing the derivation path, and activate a duress identity if compromised.

## How It Works

Every tool operates as the "active identity." Derive a persona, switch to it, and everything you do is signed by that persona's key — cryptographically unlinkable to the master unless you publish a proof.

```
identity-derive-persona("work")    → npub1abc...
identity-switch("work")            → now operating as work persona
social-post("Hello from work!")    → signed by npub1abc...
identity-switch("master")          → back to master
social-post("Back to main")       → signed by master npub
```

This is not just key management — it is context isolation. Each persona has its own relay set, its own contact list, and its own attestation chain. Compromise one and the others remain intact.

## Relationship to the Nostr Ecosystem

nostr-bray stands on the shoulders of the existing Nostr tooling:

- **[nostr-tools](https://github.com/nbd-wtf/nostr-tools)** (838 stars, 1.2M monthly npm downloads) is our primary dependency. It handles event creation, signing, NIP-44 encryption, relay connections, and most of the protocol-level heavy lifting. If you are building a Nostr client in JavaScript, nostr-tools is the standard.
- **[nak](https://github.com/fiatjaf/nak)** is the definitive Nostr CLI, written in Go by fiatjaf (the Nostr protocol creator). It covers far more ground than nostr-bray does: MuSig2 collaborative signing, a built-in relay server with negentropy sync, a FUSE filesystem, NIP-60 Cashu wallet, smart publishing with outbox routing, PoW mining, NIP-86 relay admin, paginated bulk downloads, and a full bunker (server + client) with persistence and QR codes. If you want a power-user Swiss Army knife for Nostr, nak is it. It also has [MCP support](https://github.com/fiatjaf/nak).

**What nostr-bray adds** is a narrow, opinionated layer on top: sovereign identity for AI agents. The features that are unique to nostr-bray all revolve around that theme:

| Capability | What it does |
|-----------|-------------|
| Hierarchical identity (nsec-tree) | Derive unlimited child keys from one master secret |
| Persona switching | Change the active signing identity mid-session |
| Ring signatures | Prove group membership without revealing which member you are |
| Shamir backup | Split the master secret into BIP-39 word shares for social recovery |
| Duress detection | An alternative identity that silently signals coercion |
| Verifiable attestations | NIP-VA kind 31000 creation, verification, and revocation |
| Linkage proofs | Prove (or selectively hide) links between personas |
| Spoken verification | HMAC-based spoken word tokens for in-person identity checks |

It also bundles NWC Lightning payments, Tor routing (SOCKS5h), NIP-29 groups, and a full social toolkit (post, reply, DM, follow, feed) into a single MCP server with 77 tools, so an AI agent can get a complete Nostr identity out of the box without stitching together multiple tools.

## Quick Start — CLI

```bash
# Post a note to Nostr from your terminal
export NOSTR_SECRET_KEY="nsec1..."
export NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol"

npx nostr-bray whoami                    # show your npub
npx nostr-bray post "hello from bray!"   # publish a note
npx nostr-bray persona work              # derive a work persona
npx nostr-bray prove blind               # create a linkage proof
npx nostr-bray --help                    # see all commands
```

## Quick Start — MCP Server

Add to your Claude/Cursor/Windsurf MCP config:

```json
{
  "mcpServers": {
    "nostr": {
      "command": "npx",
      "args": ["nostr-bray"],
      "env": {
        "NOSTR_SECRET_KEY": "nsec1...",
        "NOSTR_RELAYS": "wss://relay.damus.io,wss://nos.lol"
      }
    }
  }
}
```

Or with a secret file (recommended):

```json
{
  "mcpServers": {
    "nostr": {
      "command": "npx",
      "args": ["nostr-bray"],
      "env": {
        "NOSTR_SECRET_KEY_FILE": "/path/to/secret.key",
        "NOSTR_RELAYS": "wss://relay.damus.io,wss://nos.lol"
      }
    }
  }
}
```

## Tool Groups

### Identity (12 tools) — create, derive, switch, prove, backup, and migrate Nostr identities

| Tool | Description |
|------|-------------|
| `whoami` | Returns the active identity's npub |
| `identity-create` | Generate a fresh identity with BIP-39 mnemonic |
| `identity-derive` | Derive a child identity by purpose and index |
| `identity-derive-persona` | Derive a named persona (work, personal, anonymous) |
| `identity-switch` | Switch active identity — all tools operate as the new identity |
| `identity-list` | List all known identities (public info only) |
| `identity-prove` | Create blind/full linkage proof |
| `identity-backup-shamir` | Split master secret into Shamir shard files |
| `identity-restore-shamir` | Reconstruct secret from shard files |
| `identity-backup` | Fetch profile, contacts, relay list as portable bundle |
| `identity-restore` | Re-sign migratable events under the active identity |
| `identity-migrate` | Full migration with preview, confirmation, and linkage proof |

### Social (14 tools) — post, reply, react, DM, follow, and read feeds

| Tool | Description |
|------|-------------|
| `social-post` | Post a text note (kind 1) |
| `social-reply` | Reply with correct e-tag and p-tag threading |
| `social-react` | React to an event (kind 7) |
| `social-delete` | Request deletion of your event (kind 5) |
| `social-repost` | Repost/boost an event (kind 6) |
| `social-profile-get` | Fetch and parse a kind 0 profile |
| `social-profile-set` | Set profile with overwrite safety guard |
| `dm-send` | Send encrypted DM (NIP-17 default, NIP-04 opt-in) |
| `dm-read` | Read and decrypt received DMs |
| `contacts-get` | Fetch contact list (kind 3 follows) |
| `contacts-follow` | Follow a pubkey (publishes updated kind 3) |
| `contacts-unfollow` | Unfollow a pubkey |
| `social-notifications` | Fetch mentions, replies, reactions, zap receipts |
| `social-feed` | Fetch kind 1 text note feed |

### Trust (11 tools) — attestations, ring signatures, linkage proofs, spoken verification

| Tool | Description |
|------|-------------|
| `trust-attest` | Create kind 31000 verifiable attestation |
| `trust-read` | Read attestations by subject/type/attestor |
| `trust-verify` | Validate attestation structure |
| `trust-revoke` | Revoke an attestation (identity check) |
| `trust-request` | Send attestation request via NIP-17 |
| `trust-request-list` | Scan DMs for attestation requests |
| `trust-proof-publish` | Publish linkage proof (kind 30078) with confirmation |
| `trust-ring-prove` | Anonymous group membership proof (ring signature) |
| `trust-ring-verify` | Verify ring signature proof |
| `trust-spoken-challenge` | Generate spoken verification token |
| `trust-spoken-verify` | Verify spoken token response |

### Relay (5 tools) — per-identity relay lists, NIP-65 management, direct queries

| Tool | Description |
|------|-------------|
| `relay-list` | List relays with shared-relay warnings |
| `relay-set` | Publish kind 10002 relay list |
| `relay-add` | Add relay to active identity (in-memory) |
| `relay-query` | Query events from relays by kind, author, tags, or time range |
| `relay-info` | Fetch NIP-11 relay information document |

### Zap (7 tools) — Lightning payments and invoices via Nostr Wallet Connect

| Tool | Description |
|------|-------------|
| `zap-send` | Pay a Lightning invoice via NWC |
| `zap-balance` | Request wallet balance via NWC |
| `zap-make-invoice` | Generate a Lightning invoice via NWC |
| `zap-lookup-invoice` | Check invoice payment status via NWC |
| `zap-list-transactions` | List recent Lightning transactions |
| `zap-receipts` | Parse zap receipts (amount, sender, message) |
| `zap-decode` | Decode bolt11 invoice fields |

### Safety (2 tools) — duress personas for coercion resistance

| Tool | Description |
|------|-------------|
| `safety-configure` | Configure an alternative identity persona |
| `safety-activate` | Switch to alternative identity |

### Blossom (3 tools) — media uploads and management

| Tool | Description |
|------|-------------|
| `blossom-upload` | Upload file to a blossom media server |
| `blossom-list` | List blobs for a pubkey |
| `blossom-delete` | Delete a blob by SHA-256 hash |

### Groups — NIP-29 (4 tools) — group chat, metadata, and membership

| Tool | Description |
|------|-------------|
| `group-info` | Fetch group metadata |
| `group-chat` | Read group chat messages |
| `group-send` | Send message to a group |
| `group-members` | List group members |

### Community NIPs (2 tools) — publish and read community-proposed NIPs

| Tool | Description |
|------|-------------|
| `nip-publish` | Publish a community NIP (kind 30817) |
| `nip-read` | Fetch community NIPs |

### Utility (18 tools) — encode, decode, encrypt, verify, filter, fetch, browse NIPs

| Tool | Description |
|------|-------------|
| `decode` | Decode npub/nsec/note/nevent/nprofile/naddr |
| `encode-npub` | Encode hex pubkey as npub |
| `encode-note` | Encode hex event ID as note |
| `encode-nprofile` | Encode pubkey + relays as nprofile |
| `encode-nevent` | Encode event ID + relays as nevent |
| `encode-naddr` | Encode addressable event as naddr |
| `encode-nsec` | Encode hex private key as nsec |
| `key-public` | Derive pubkey from secret key |
| `key-encrypt` | Encrypt a secret key with a password (NIP-49 ncryptsec) |
| `key-decrypt` | Decrypt an ncryptsec (NIP-49) with a password |
| `verify-event` | Verify event hash and signature |
| `filter` | Test if an event matches a filter |
| `nip44-encrypt` | NIP-44 encrypt for a recipient |
| `nip44-decrypt` | NIP-44 decrypt from a sender |
| `count` | Count events matching a filter |
| `fetch` | Fetch events by nip19 code |
| `nip-list` | List all official NIPs |
| `nip-show` | Show a specific NIP's content |

## Configuration

| Variable | Description |
|----------|-------------|
| `NOSTR_SECRET_KEY` | nsec bech32, 64-char hex, or BIP-39 mnemonic |
| `NOSTR_SECRET_KEY_FILE` | Path to secret key file (takes precedence) |
| `NOSTR_RELAYS` | Comma-separated relay URLs |
| `TOR_PROXY` | SOCKS5h proxy for Tor (blocks clearnet relays by default) |
| `NIP04_ENABLED` | Set `1` to enable legacy NIP-04 DMs |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port (default 3000) |

## Documentation

- **[Usage Guide](./docs/guide.md)** — walkthroughs for identity management, DMs, attestations, NWC payments, Tor, and duress
- **[Examples](./examples/)** — MCP config files (basic, NWC, Tor) and a CLI workflow script
- **[Contributing](./CONTRIBUTING.md)** — setup, architecture, testing, and conventions

## For AI Assistants

See [llms.txt](./llms.txt) for a concise summary optimised for AI context windows, or [llms-full.txt](./llms-full.txt) for complete tool documentation with parameter details.

## Licence

MIT
