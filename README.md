# nostr-bray

> Sovereign Nostr identities for AI agents

[![CI](https://github.com/forgesworn/bray/actions/workflows/ci.yml/badge.svg)](https://github.com/forgesworn/bray/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nostr-bray)](https://www.npmjs.com/package/nostr-bray)
[![licence](https://img.shields.io/npm/l/nostr-bray)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)](./tsconfig.json)

An MCP server that gives AI agents a full Nostr identity — not just a key pair, but a hierarchical identity tree with personas, attestations, ring signatures, encrypted DMs, and duress detection. 74 tools across 10 groups.

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

### Identity (11 tools)

| Tool | Description |
|------|-------------|
| `identity_create` | Generate a fresh identity with BIP-39 mnemonic |
| `identity_derive` | Derive a child identity by purpose and index |
| `identity_derive_persona` | Derive a named persona (work, personal, anonymous) |
| `identity_switch` | Switch active identity — all tools operate as the new identity |
| `identity_list` | List all known identities (public info only) |
| `identity_prove` | Create blind/full linkage proof |
| `identity_backup_shamir` | Split master secret into Shamir shard files |
| `identity_restore_shamir` | Reconstruct secret from shard files |
| `identity_backup` | Fetch profile, contacts, relay list as portable bundle |
| `identity_restore` | Re-sign migratable events under the active identity |
| `identity_migrate` | Full migration with preview, confirmation, and linkage proof |

### Social (14 tools)

| Tool | Description |
|------|-------------|
| `social_post` | Post a text note (kind 1) |
| `social_reply` | Reply with correct e-tag and p-tag threading |
| `social_react` | React to an event (kind 7) |
| `social_delete` | Request deletion of your event (kind 5) |
| `social_repost` | Repost/boost an event (kind 6) |
| `social_profile_get` | Fetch and parse a kind 0 profile |
| `social_profile_set` | Set profile with overwrite safety guard |
| `dm_send` | Send encrypted DM (NIP-17 default, NIP-04 opt-in) |
| `dm_read` | Read and decrypt received DMs |
| `contacts_get` | Fetch contact list (kind 3 follows) |
| `contacts_follow` | Follow a pubkey (publishes updated kind 3) |
| `contacts_unfollow` | Unfollow a pubkey |
| `social_notifications` | Fetch mentions, replies, reactions, zap receipts |
| `social_feed` | Fetch kind 1 text note feed |

### Trust (11 tools)

| Tool | Description |
|------|-------------|
| `trust_attest` | Create kind 31000 verifiable attestation |
| `trust_read` | Read attestations by subject/type/attestor |
| `trust_verify` | Validate attestation structure |
| `trust_revoke` | Revoke an attestation (identity check) |
| `trust_request` | Send attestation request via NIP-17 |
| `trust_request_list` | Scan DMs for attestation requests |
| `trust_proof_publish` | Publish linkage proof (kind 30078) with confirmation |
| `trust_ring_prove` | Anonymous group membership proof (ring signature) |
| `trust_ring_verify` | Verify ring signature proof |
| `trust_spoken_challenge` | Generate spoken verification token |
| `trust_spoken_verify` | Verify spoken token response |

### Relay (4 tools)

| Tool | Description |
|------|-------------|
| `relay_list` | List relays with shared-relay warnings |
| `relay_set` | Publish kind 10002 relay list |
| `relay_add` | Add relay to active identity (in-memory) |
| `relay_info` | Fetch NIP-11 relay information document |

### Zap (7 tools)

| Tool | Description |
|------|-------------|
| `zap_send` | Pay a Lightning invoice via NWC |
| `zap_balance` | Request wallet balance via NWC |
| `zap_make_invoice` | Generate a Lightning invoice via NWC |
| `zap_lookup_invoice` | Check invoice payment status via NWC |
| `zap_list_transactions` | List recent Lightning transactions |
| `zap_receipts` | Parse zap receipts (amount, sender, message) |
| `zap_decode` | Decode bolt11 invoice fields |

### Safety (2 tools)

| Tool | Description |
|------|-------------|
| `safety_configure` | Configure an alternative identity persona |
| `safety_activate` | Switch to alternative identity |

### Blossom (3 tools)

| Tool | Description |
|------|-------------|
| `blossom_upload` | Upload file to a blossom media server |
| `blossom_list` | List blobs for a pubkey |
| `blossom_delete` | Delete a blob by SHA-256 hash |

### Groups — NIP-29 (4 tools)

| Tool | Description |
|------|-------------|
| `group_info` | Fetch group metadata |
| `group_chat` | Read group chat messages |
| `group_send` | Send message to a group |
| `group_members` | List group members |

### Community NIPs (2 tools)

| Tool | Description |
|------|-------------|
| `nip_publish` | Publish a community NIP (kind 30817) |
| `nip_read` | Fetch community NIPs |

### Utility (16 tools)

| Tool | Description |
|------|-------------|
| `decode` | Decode npub/nsec/note/nevent/nprofile/naddr |
| `encode_npub` | Encode hex pubkey as npub |
| `encode_note` | Encode hex event ID as note |
| `encode_nprofile` | Encode pubkey + relays as nprofile |
| `encode_nevent` | Encode event ID + relays as nevent |
| `encode_naddr` | Encode addressable event as naddr |
| `encode_nsec` | Encode hex private key as nsec |
| `key_public` | Derive pubkey from secret key |
| `verify_event` | Verify event hash and signature |
| `filter` | Test if an event matches a filter |
| `nip44_encrypt` | NIP-44 encrypt for a recipient |
| `nip44_decrypt` | NIP-44 decrypt from a sender |
| `count` | Count events matching a filter |
| `fetch` | Fetch events by nip19 code |
| `nip_list` | List all official NIPs |
| `nip_show` | Show a specific NIP's content |

## Identity Switching

The killer feature. Every tool operates as the "active identity." Switch with a single call:

```
identity_derive_persona("work")    → npub1abc...
identity_switch("work")            → now operating as work persona
social_post("Hello from work!")    → signed by npub1abc...
identity_switch("master")          → back to master
social_post("Back to main")       → signed by master npub
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
