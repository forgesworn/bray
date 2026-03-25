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

### Identity (12 tools)

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

### Social (14 tools)

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

### Trust (11 tools)

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

### Relay (5 tools)

| Tool | Description |
|------|-------------|
| `relay-list` | List relays with shared-relay warnings |
| `relay-set` | Publish kind 10002 relay list |
| `relay-add` | Add relay to active identity (in-memory) |
| `relay-query` | Query events from relays by kind, author, tags, or time range |
| `relay-info` | Fetch NIP-11 relay information document |

### Zap (7 tools)

| Tool | Description |
|------|-------------|
| `zap-send` | Pay a Lightning invoice via NWC |
| `zap-balance` | Request wallet balance via NWC |
| `zap-make-invoice` | Generate a Lightning invoice via NWC |
| `zap-lookup-invoice` | Check invoice payment status via NWC |
| `zap-list-transactions` | List recent Lightning transactions |
| `zap-receipts` | Parse zap receipts (amount, sender, message) |
| `zap-decode` | Decode bolt11 invoice fields |

### Safety (2 tools)

| Tool | Description |
|------|-------------|
| `safety-configure` | Configure an alternative identity persona |
| `safety-activate` | Switch to alternative identity |

### Blossom (3 tools)

| Tool | Description |
|------|-------------|
| `blossom-upload` | Upload file to a blossom media server |
| `blossom-list` | List blobs for a pubkey |
| `blossom-delete` | Delete a blob by SHA-256 hash |

### Groups — NIP-29 (4 tools)

| Tool | Description |
|------|-------------|
| `group-info` | Fetch group metadata |
| `group-chat` | Read group chat messages |
| `group-send` | Send message to a group |
| `group-members` | List group members |

### Community NIPs (2 tools)

| Tool | Description |
|------|-------------|
| `nip-publish` | Publish a community NIP (kind 30817) |
| `nip-read` | Fetch community NIPs |

### Utility (18 tools)

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

## Identity Switching

The killer feature. Every tool operates as the "active identity." Switch with a single call:

```
identity-derive-persona("work")    → npub1abc...
identity-switch("work")            → now operating as work persona
social-post("Hello from work!")    → signed by npub1abc...
identity-switch("master")          → back to master
social-post("Back to main")       → signed by master npub
```

Derived identities are cryptographically unlinkable unless you publish a linkage proof.

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
