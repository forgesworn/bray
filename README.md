# nostr-bray

**Trust-aware Nostr for AI and humans.**

Three dimensions of trust -- verification, proximity, and access -- woven into every interaction. 185 tools for identity, social, payments, moderation, privacy, and encrypted access control.

| Dimension | Source | Question |
|-----------|--------|----------|
| **Verification** | Signet | Are they real? |
| **Proximity** | Web of Trust | Do I know them? |
| **Access** | Dominion | What can they see? |

[![CI](https://github.com/forgesworn/bray/actions/workflows/ci.yml/badge.svg)](https://github.com/forgesworn/bray/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nostr-bray)](https://www.npmjs.com/package/nostr-bray)
[![coverage](https://img.shields.io/badge/coverage-96%25-brightgreen)](./package.json)
[![licence](https://img.shields.io/npm/l/nostr-bray)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)](./tsconfig.json)

An MCP server that gives AI agents a full Nostr identity: not just a key pair, but a hierarchical identity tree with personas, attestations, ring signatures, encrypted DMs, duress detection, identity verification via Signet, and epoch-based encrypted access control via Dominion. 185 tools across 17 groups.

## The Problem

AI agents interacting with Nostr today are handed a single key pair with no separation of concerns. One compromised session leaks everything. There is no way to rotate keys, prove identity links, or maintain separate personas for different contexts.

nostr-bray solves this with nsec-tree hierarchical derivation. A single master secret generates unlimited child identities, each with its own key pair, purpose, and relay set. Private keys are zeroed from memory on eviction. Agents can switch personas mid-conversation, prove they control the master without revealing the derivation path, and activate a duress identity if compromised.

## How It Works

Every tool operates as the "active identity." Derive a persona, switch to it, and everything you do is signed by that persona's key -- cryptographically unlinkable to the master unless you publish a proof.

```
identity-derive-persona("work")    → npub1abc...
identity-switch("work")            → now operating as work persona
social-post("Hello from work!")    → signed by npub1abc...
identity-switch("master")          → back to master
social-post("Back to main")       → signed by master npub
```

This is not just key management: it is context isolation. Each persona loads its own NIP-65 relay list on switch, signs with its own key, and maintains its own attestation chain. Compromise one and the others remain intact.

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
| WoT-scored feeds | Trust-filtered social feeds via nostr-veil integration |
| Relay health monitoring | Detect dead or unreliable relays before they lose your data |
| Contact list protection | Safety guard against accidental follow list destruction |

It also bundles NIP-46 bunker auth (your key never leaves the signer), NWC Lightning payments, NIP-29 groups, and a full social toolkit (post, reply, DM, follow, feed) into a single MCP server, so an AI agent can get a complete Nostr identity out of the box without stitching together multiple tools.

## Quick Start -- CLI

```bash
# Post a note to Nostr from your terminal
export NOSTR_SECRET_KEY="nsec1..."      # env var (least safe -- bunker or file preferred)
export NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol"

npx nostr-bray whoami                    # show your npub
npx nostr-bray post "hello from bray!"   # publish a note
npx nostr-bray persona work              # derive a work persona
npx nostr-bray prove blind               # create a linkage proof
npx nostr-bray --help                    # see all commands
```

## Quick Start -- MCP Server

Add to your Claude/Cursor/Windsurf MCP config:

**Recommended -- NIP-46 bunker (safest: key never leaves your device):**

```json
{
  "mcpServers": {
    "nostr": {
      "command": "npx",
      "args": ["nostr-bray"],
      "env": {
        "BUNKER_URI": "bunker://...",
        "NOSTR_RELAYS": "wss://relay.damus.io,wss://nos.lol"
      }
    }
  }
}
```

**Or with an NIP-49 encrypted key (ncryptsec):**

```json
{
  "mcpServers": {
    "nostr": {
      "command": "npx",
      "args": ["nostr-bray"],
      "env": {
        "NOSTR_NCRYPTSEC": "ncryptsec1...",
        "NOSTR_NCRYPTSEC_PASSWORD": "your-password",
        "NOSTR_RELAYS": "wss://relay.damus.io,wss://nos.lol"
      }
    }
  }
}
```

**Or with a secret file:**

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

Auth tier progression (safest to least safe): **bunker** > **ncryptsec** > **file** > **env var**

## Tool Groups

### Identity (15 tools) -- create, derive, switch, prove, backup, migrate, and resolve NIP-05 identifiers

| Tool | Description |
|------|-------------|
| `whoami` | Returns the active identity's npub |
| `identity-create` | Generate a fresh identity with BIP-39 mnemonic |
| `identity-derive` | Derive a child identity by purpose and index |
| `identity-derive-persona` | Derive a named persona (work, personal, anonymous) |
| `identity-switch` | Switch active identity -- all tools operate as the new identity |
| `identity-list` | List all known identities (public info only) |
| `identity-prove` | Create blind/full linkage proof |
| `identity-backup-shamir` | Split master secret into Shamir shard files |
| `identity-restore-shamir` | Reconstruct secret from shard files |
| `identity-backup` | Fetch profile, contacts, relay list as portable bundle |
| `identity-restore` | Re-sign migratable events under the active identity |
| `identity-migrate` | Full migration with preview, confirmation, and linkage proof |
| `nip05-lookup` | Resolve a NIP-05 identifier (user@domain) to a pubkey and relay hints |
| `nip05-verify` | Confirm a pubkey matches a claimed NIP-05 identifier |
| `nip05-relays` | Fetch relay hints from a NIP-05 server for a given identifier |

### Social (15 tools) -- post, reply, react, DM, follow, and read feeds

| Tool | Description |
|------|-------------|
| `social-post` | Post a text note (kind 1) |
| `social-reply` | Reply with correct e-tag and p-tag threading |
| `social-react` | React to an event (kind 7) |
| `social-delete` | Request deletion of your event (kind 5) |
| `social-repost` | Repost/boost an event (kind 6) |
| `social-profile-get` | Fetch and parse a kind 0 profile |
| `social-profile-set` | Set profile with overwrite safety guard |
| `social-notifications` | Fetch mentions, replies, reactions, zap receipts |
| `social-feed` | Fetch kind 1 text note feed |
| `feed-by-name` | Fetch a named persona's feed without switching identity |
| `profile-by-name` | Fetch a named persona's profile without switching identity |
| `contacts-get` | Fetch contact list (kind 3 follows) |
| `contacts-search` | Search contacts by name or NIP-05 identifier |
| `contacts-follow` | Follow a pubkey (publishes updated kind 3) |
| `contacts-unfollow` | Unfollow a pubkey |

### Direct Messages (4 tools) -- NIP-17 gift-wrapped DMs and conversation management

| Tool | Description |
|------|-------------|
| `dm-send` | Send encrypted DM (NIP-17 default, NIP-04 opt-in) |
| `dm-read` | Read and decrypt received DMs |
| `dm-by-name` | Read DMs for a named persona without switching identity |
| `dm-conversation` | Fetch a full conversation thread with a specific pubkey |

### Trust (22 tools) -- attestations, ring signatures, linkage proofs, spoken verification

| Tool | Description |
|------|-------------|
| `trust-attest` | Create kind 31000 verifiable attestation |
| `trust-claim` | Publish a self-signed trust claim |
| `trust-read` | Read attestations by subject/type/attestor |
| `trust-verify` | Validate attestation structure |
| `trust-revoke` | Revoke an attestation (identity check) |
| `trust-request` | Send attestation request via NIP-17 |
| `trust-request-list` | Scan DMs for attestation requests |
| `trust-proof-publish` | Publish linkage proof (kind 30078) with confirmation |
| `trust-ring-prove` | Anonymous group membership proof (SAG ring signature) |
| `trust-ring-verify` | Verify SAG ring signature proof |
| `trust-ring-lsag-sign` | Linkable ring signature (LSAG) -- detects double-signing |
| `trust-ring-lsag-verify` | Verify LSAG ring signature with key-image linkability check |
| `trust-ring-key-image` | Derive the key image for your key in a given ring |
| `trust-spoken-challenge` | Generate spoken verification token |
| `trust-spoken-verify` | Verify spoken token response |
| `trust-spoken-directional` | Generate directional spoken token (sender to recipient binding) |
| `trust-spoken-encode` | Encode a spoken token for transmission |
| `trust-attest-parse` | Parse raw attestation event into structured fields |
| `trust-attest-filter` | Filter a list of attestations by type, issuer, or validity |
| `trust-attest-temporal` | Check attestation validity at a specific point in time |
| `trust-attest-chain` | Resolve a chain of delegated attestations |
| `trust-attest-check-revoked` | Check whether an attestation has been revoked |

### Relay (12 tools) -- per-identity relay lists, NIP-65 management, direct queries, and intelligence

| Tool | Description |
|------|-------------|
| `relay-list` | List relays with shared-relay warnings |
| `relay-set` | Publish kind 10002 relay list |
| `relay-add` | Add relay to active identity (in-memory) |
| `relay-query` | Query events by kind, author, tags, time range, or full-text search (NIP-50) |
| `relay-info` | Fetch NIP-11 relay information document |
| `relay-count` | Count events matching a filter without fetching them (NIP-45) |
| `relay-auth` | Authenticate to a relay that requires NIP-42 AUTH |
| `relay-discover` | Discover relays via NIP-65 relay lists from your network |
| `relay-nip-search` | Find relays that support a specific NIP |
| `relay-compare` | Compare two relay sets for coverage overlap |
| `relay-diversity` | Score a relay set for geographic and operator diversity |
| `relay-recommend` | Recommend relays based on your network's NIP-65 lists |

### Zap (7 tools) -- Lightning payments and invoices via Nostr Wallet Connect

| Tool | Description |
|------|-------------|
| `zap-send` | Pay a Lightning invoice via NWC |
| `zap-balance` | Request wallet balance via NWC |
| `zap-make-invoice` | Generate a Lightning invoice via NWC |
| `zap-lookup-invoice` | Check invoice payment status via NWC |
| `zap-list-transactions` | List recent Lightning transactions |
| `zap-receipts` | Parse zap receipts (amount, sender, message) |
| `zap-decode` | Decode bolt11 invoice fields |

### Safety (14 tools) -- duress personas and CANARY liveness proofs

| Tool | Description |
|------|-------------|
| `safety-configure` | Configure an alternative identity persona |
| `safety-activate` | Switch to alternative identity |
| `canary-session-create` | Create a personal liveness canary (auto-expires) |
| `canary-session-current` | Fetch the current canary token for your session |
| `canary-session-verify` | Verify a canary is still live and un-tripped |
| `canary-group-create` | Create a shared CANARY group with member keys |
| `canary-group-join` | Join an existing CANARY group |
| `canary-group-current` | Fetch the current canary for a group |
| `canary-group-verify` | Verify a group canary is still live |
| `canary-group-members` | List members and admins of a CANARY group |
| `canary-beacon-create` | Publish a CANARY beacon event to Nostr |
| `canary-beacon-check` | Check whether a beacon is still live |
| `canary-duress-signal` | Emit a covert duress signal via canary trip |
| `canary-duress-detect` | Detect whether a canary trip was a duress signal |

### Signet (7 tools) -- identity verification and credential checks

| Tool | Description |
|------|-------------|
| `signet-badge` | Fetch the Signet verification badge for a pubkey |
| `signet-vouch` | Vouch for another identity's Signet credential |
| `signet-credentials` | List credentials associated with a Signet identity |
| `signet-policy-check` | Check whether a pubkey satisfies a verification policy |
| `signet-policy-set` | Set a verification policy for an interaction context |
| `signet-verifiers` | List trusted verifiers in the Signet network |
| `signet-challenge` | Issue a Signet verification challenge |

### Vault (9 tools) -- epoch-based encrypted access control via Dominion

| Tool | Description |
|------|-------------|
| `vault-create` | Create an encrypted vault with Dominion epoch key |
| `vault-encrypt` | Encrypt content into a vault |
| `vault-share` | Share vault access with a pubkey at a given tier |
| `vault-read` | Decrypt and read vault content (own vault) |
| `vault-read-shared` | Decrypt content using a vault key shared by another identity |
| `vault-revoke` | Revoke a pubkey's vault access |
| `vault-members` | List members and their access tiers |
| `vault-config` | View or update vault configuration |
| `vault-rotate` | Rotate the vault epoch key |

### Blossom (10 tools) -- media uploads, verification, and server management

| Tool | Description |
|------|-------------|
| `blossom-upload` | Upload file to a Blossom media server |
| `blossom-list` | List blobs for a pubkey |
| `blossom-delete` | Delete a blob by SHA-256 hash |
| `blossom-mirror` | Mirror a blob to an additional server |
| `blossom-check` | Check whether a blob exists on a server |
| `blossom-discover` | Discover Blossom servers from a pubkey's NIP-96 list |
| `blossom-verify` | Verify a blob's SHA-256 hash matches its content |
| `blossom-repair` | Re-upload a blob to servers that are missing it |
| `blossom-usage` | Report storage usage across all servers |
| `blossom-servers` | List configured Blossom servers |

### Groups -- NIP-29 (4 tools) -- group chat, metadata, and membership

| Tool | Description |
|------|-------------|
| `group-info` | Fetch group metadata |
| `group-chat` | Read group chat messages |
| `group-send` | Send message to a group |
| `group-members` | List group members |

### Community NIPs (2 tools) -- publish and read community-proposed NIPs

| Tool | Description |
|------|-------------|
| `nip-publish` | Publish a community NIP (kind 30817) |
| `nip-read` | Fetch community NIPs |

### Moderation (16 tools) -- labels, mute lists, pin lists, follow sets, and bookmarks

| Tool | Description |
|------|-------------|
| `label-create` | Create a NIP-32 label event (kind 1985) for content or identity |
| `label-self` | Self-label your own content or identity |
| `label-read` | Read labels applied to an event or pubkey |
| `label-search` | Search labels by namespace, value, or target |
| `label-remove` | Delete a label event (kind 5 deletion) |
| `list-mute` | Add a pubkey, event, keyword, or hashtag to your mute list |
| `list-mute-read` | Read your current mute list (NIP-51, kind 10000) |
| `list-check-muted` | Check whether a pubkey or event is in your mute list |
| `list-pin` | Add or remove events from your pin list (NIP-51, kind 10001) |
| `list-pin-read` | Read your pinned events list |
| `list-followset-create` | Create a named follow set (NIP-51, kind 30000) |
| `list-followset-manage` | Add or remove pubkeys from a named follow set |
| `list-followset-read` | Read a named follow set |
| `list-bookmark` | Add an event to your bookmarks list (NIP-51, kind 10003) |
| `list-bookmark-read` | Read your bookmarks list |
| `moderation-filter` | Apply a moderation filter to a list of events or pubkeys |

### Privacy (10 tools) -- Pedersen commitments and zero-knowledge range proofs

| Tool | Description |
|------|-------------|
| `privacy-commit` | Create a Pedersen commitment to a secret value |
| `privacy-open` | Verify a commitment opening (value + blinding factor) |
| `privacy-prove-range` | Prove a value is within [min, max] without revealing it |
| `privacy-verify-range` | Verify a range proof against a commitment |
| `privacy-prove-age` | Prove age is within a range (e.g. "18+") without revealing exact age |
| `privacy-verify-age` | Verify an age range proof |
| `privacy-prove-threshold` | Prove a value exceeds a threshold without revealing the exact value |
| `privacy-verify-threshold` | Verify a threshold proof |
| `privacy-publish-proof` | Publish a range proof as a kind 30078 Nostr event |
| `privacy-read-proof` | Fetch and verify range proof events from relays |

### Marketplace (12 tools) -- discover, probe, call, and publish L402/x402 paid services

| Tool | Description |
|------|-------------|
| `marketplace-discover` | Discover L402/x402 paid API services announced on Nostr (kind 31402) |
| `marketplace-inspect` | Get full details of a specific L402 service by event ID or identifier |
| `marketplace-search` | Full-text search across L402 service names, descriptions, and topics |
| `marketplace-reputation` | Check a service provider's reputation via attestations and zap history |
| `marketplace-compare` | Compare two or more L402 services side-by-side |
| `marketplace-probe` | Test connectivity and response to a paid API endpoint |
| `marketplace-pay` | Pay the L402 challenge for a service and store the credential |
| `marketplace-call` | Call a paid API endpoint using a stored L402 credential |
| `marketplace-announce` | Publish a kind 31402 L402 service announcement |
| `marketplace-update` | Update a previously published service announcement |
| `marketplace-retire` | Retire a service announcement (kind 5 deletion) |
| `marketplace-credentials-clear` | Clear stored L402 credentials for a service |

### Utility (19 tools) -- encode, decode, encrypt, verify, filter, fetch, and browse NIPs

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
| `tombstone` | Publish a kind 5 deletion event for any event you authored |

### Workflow (7 tools) -- trust scoring, discovery, verification, identity setup, relay health

| Tool | Description |
|------|-------------|
| `trust-score` | Compute WoT trust score for any pubkey -- combines NIP-85 assertions, NIP-VA attestations, and social distance |
| `feed-discover` | Discover accounts to follow via trust-adjacent, topic, or activity strategies |
| `verify-person` | Verify identity with attestations, NIP-05, linkage proofs, ring endorsements, and spoken challenges |
| `identity-setup` | Guided safe identity creation -- derives personas, creates Shamir backup, configures relays |
| `identity-recover` | Recover identity from Shamir backup shards with verification |
| `relay-health` | Check relay set health -- reachability, NIP support, event presence, write access |
| `search-actions` | Search across all available tool actions by keyword |

## NIP Support

| NIP | Description | Coverage |
|-----|-------------|----------|
| NIP-01 | Basic protocol, event signing | Full |
| NIP-02 | Follow list (kind 3) | Full |
| NIP-04 | Encrypted DMs (legacy) | Opt-in (`NIP04_ENABLED=1`) |
| NIP-05 | DNS identity verification | Full (lookup, verify, relay hints) |
| NIP-09 | Event deletion (kind 5) | Full |
| NIP-11 | Relay information document | Full |
| NIP-17 | Private DMs (gift wrap) | Full (default) |
| NIP-19 | bech32 encoding (npub, nsec, nprofile, nevent, naddr) | Full |
| NIP-29 | Group chat | Full |
| NIP-32 | Labels (kind 1985) | Full |
| NIP-40 | Expiration tag | Full |
| NIP-42 | Relay authentication | Full (`relay-auth`) |
| NIP-44 | Encrypted payloads v2 | Full (default for DMs and NWC) |
| NIP-45 | Event counts (COUNT) | Full (`relay-count`, with fallback) |
| NIP-46 | Nostr Connect (bunker) | Full |
| NIP-49 | Private key encryption | Full (ncryptsec) |
| NIP-50 | Search capability | Full (`search` param on `relay-query`) |
| NIP-51 | Lists (mute, pin, follow sets, bookmarks) | Full |
| NIP-57 | Lightning zaps | Full |
| NIP-65 | Relay list metadata | Full (per-identity, signature-verified) |
| NIP-78 | Application-specific data | Full (proofs, linkage events) |
| NIP-85 | Trust rankings | Full (WoT scoring) |
| NIP-96 | HTTP file storage | Full (Blossom) |
| NIP-VA | Verifiable attestations (kind 31000) | Full |

## Configuration

| Variable | Description |
|----------|-------------|
| `BUNKER_URI` | NIP-46 bunker URL -- safest option, key stays on your device |
| `NOSTR_SECRET_KEY` | nsec bech32, 64-char hex, or BIP-39 mnemonic |
| `NOSTR_SECRET_KEY_FILE` | Path to secret key file (takes precedence over env var) |
| `NOSTR_NCRYPTSEC` | NIP-49 encrypted key (requires `NOSTR_NCRYPTSEC_PASSWORD`) |
| `NOSTR_NCRYPTSEC_FILE` | Path to NIP-49 encrypted key file (requires `NOSTR_NCRYPTSEC_PASSWORD`) |
| `NOSTR_NCRYPTSEC_PASSWORD` | Password to decrypt an ncryptsec key |
| `NOSTR_RELAYS` | Comma-separated relay URLs |
| `TOR_PROXY` | SOCKS5h proxy for Tor (blocks clearnet relays by default) |
| `NIP04_ENABLED` | Set `1` to enable legacy NIP-04 DMs |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port (default 3000) |

## Documentation

- **[Usage Guide](./docs/guide.md)** -- walkthroughs for identity management, DMs, attestations, NWC payments, and duress
- **[Examples](./examples/)** -- MCP config files (basic, NWC, bunker) and a CLI workflow script
- **[Contributing](./CONTRIBUTING.md)** -- setup, architecture, testing, and conventions

## For AI Assistants

See [llms.txt](./llms.txt) for a concise summary optimised for AI context windows, or [llms-full.txt](./llms-full.txt) for complete tool documentation with parameter details.

## Licence

MIT
