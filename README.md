# nostr-bray

**Trust-aware Nostr MCP for AI and humans.** 227 tools. Model-agnostic. Works with Claude, ChatGPT, Gemini, Cursor, Windsurf, or any MCP client.

[![npm](https://img.shields.io/npm/v/nostr-bray)](https://www.npmjs.com/package/nostr-bray)
[![CI](https://github.com/forgesworn/bray/actions/workflows/ci.yml/badge.svg)](https://github.com/forgesworn/bray/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/nostr-bray)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)](./tsconfig.json)

## Quick Start

Install globally or run via npx:

```bash
npm install -g nostr-bray
```

Add to your MCP client config:

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

Then ask your AI to call `whoami` to verify it works.

For production use, prefer NIP-46 bunker auth (your key never leaves your device):

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

Auth tier progression (safest to least safe): **bunker** > **ncryptsec** > **file** > **env var**

## Tool Groups

| Group | Tools | Key examples |
|-------|------:|--------------|
| **Identity** | 15 | `whoami`, `identity-derive-persona`, `identity-switch`, `identity-prove`, `nip05-lookup` |
| **Social** | 15 | `social-post`, `social-reply`, `social-feed`, `contacts-follow`, `social-notifications` |
| **Direct Messages** | 4 | `dm-send`, `dm-read`, `dm-conversation` |
| **Trust** | 22 | `trust-attest`, `trust-ring-prove`, `trust-spoken-challenge`, `trust-attest-chain` |
| **Dispatch** | 13 | `dispatch-send`, `dispatch-check`, `dispatch-reply`, `dispatch-capability-discover` |
| **Relay** | 12 | `relay-query`, `relay-set`, `relay-discover`, `relay-health`, `relay-recommend` |
| **Moderation** | 16 | `label-create`, `list-mute`, `list-bookmark`, `list-followset-create`, `moderation-filter` |
| **Marketplace** | 16 | `marketplace-discover`, `marketplace-call`, `listing-create`, `listing-search` |
| **Safety** | 14 | `canary-session-create`, `canary-group-create`, `canary-duress-signal`, `safety-activate` |
| **Blossom** | 10 | `blossom-upload`, `blossom-mirror`, `blossom-verify`, `blossom-repair` |
| **Privacy** | 10 | `privacy-commit`, `privacy-prove-range`, `privacy-prove-age`, `privacy-publish-proof` |
| **Zap** | 9 | `zap-send`, `zap-balance`, `zap-make-invoice`, `zap-decode` |
| **Vault** | 9 | `vault-create`, `vault-encrypt`, `vault-share`, `vault-rotate` |
| **Workflow** | 7 | `trust-score`, `verify-person`, `identity-setup`, `relay-health`, `feed-discover` |
| **Signet** | 7 | `signet-badge`, `signet-vouch`, `signet-credentials`, `signet-challenge` |
| **Communities** | 5 | `community-create`, `community-feed`, `community-post`, `community-approve` |
| **Badges** | 4 | `badge-create`, `badge-award`, `badge-accept`, `badge-list` |
| **Groups (NIP-29)** | 4 | `group-info`, `group-chat`, `group-send`, `group-members` |
| **Articles** | 3 | `article-publish`, `article-read`, `article-list` |
| **Calendar** | 3 | `calendar-create`, `calendar-read`, `calendar-rsvp` |
| **Wiki** | 3 | `wiki-publish`, `wiki-read`, `wiki-list` |
| **Search** | 3 | `search-notes`, `search-profiles`, `hashtag-feed` |
| **Scheduling** | 3 | `post-schedule`, `post-queue-list`, `post-queue-cancel` |
| **Community NIPs** | 2 | `nip-publish`, `nip-read` |
| **Utility** | 19 | `decode`, `encode-npub`, `nip44-encrypt`, `verify-event`, `nip-list` |
| **Catalog** | 2 | `search-actions`, `execute-action` |

Use `search-actions` to find tools by keyword, then `execute-action` to run them.

## Dispatch: AI-to-AI Collaboration

Dispatch lets AI agents collaborate over encrypted Nostr DMs. Any MCP-capable client can send structured tasks to other agents and receive results back.

**13 message types:** send, check, reply, ack, status, cancel, refuse, failure, query, propose, capability-publish, capability-discover, capability-read.

**NIP-89 capability discovery:** Agents publish what they can do. Other agents discover capabilities by topic, then route tasks to the right collaborator automatically.

```
dispatch-send("alice", "think", "Analyse the trade-offs of NIP-44 vs NIP-04")
dispatch-check()                    → inbox with pending tasks
dispatch-reply(taskId, result)      → send results back encrypted
```

All messages are NIP-44 encrypted. Recipients are resolved by name, NIP-05, npub, or hex.

## Identity Resolver

Every tool that accepts a recipient uses universal identity resolution. You never need to look up hex pubkeys manually.

Accepted formats:
- **Name** -- `"alice"` (resolved from your dispatch contacts)
- **NIP-05** -- `"alice@example.com"` (HTTP lookup)
- **npub** -- `"npub1abc..."` (NIP-19 decode)
- **Hex** -- `"a1b2c3..."` (64-character passthrough)

## Scheduled Posting

Sign events now, publish later. Events are signed immediately with your current key, then held in a queue until the scheduled time.

```
post-schedule("Good morning!", "2026-04-01T08:00:00Z")
post-queue-list()          → view pending scheduled posts
post-queue-cancel(id)      → cancel before it publishes
```

## NIP Coverage

nostr-bray implements or integrates the following NIPs:

| NIP | What |
|-----|------|
| **NIP-01** | Events, signing, relay protocol |
| **NIP-02** | Follow lists |
| **NIP-05** | DNS identity (lookup, verify, relay hints) |
| **NIP-09** | Event deletion |
| **NIP-11** | Relay information |
| **NIP-17** | Private DMs (gift wrap, default) |
| **NIP-19** | bech32 encoding (npub, nsec, nprofile, nevent, naddr) |
| **NIP-23** | Long-form articles (kind 30023) |
| **NIP-29** | Group chat |
| **NIP-32** | Labels |
| **NIP-40** | Expiration tags |
| **NIP-42** | Relay auth |
| **NIP-44** | Encrypted payloads v2 |
| **NIP-45** | Event counts |
| **NIP-46** | Nostr Connect (bunker) |
| **NIP-49** | Private key encryption (ncryptsec) |
| **NIP-50** | Search |
| **NIP-51** | Lists (mute, pin, follow sets, bookmarks) |
| **NIP-52** | Calendar events |
| **NIP-54** | Wiki pages |
| **NIP-57** | Lightning zaps |
| **NIP-58** | Badges |
| **NIP-65** | Relay list metadata |
| **NIP-72** | Communities |
| **NIP-78** | Application-specific data |
| **NIP-85** | Trust rankings |
| **NIP-89** | Recommended applications (dispatch capability discovery) |
| **NIP-96** | HTTP file storage (Blossom) |
| **NIP-99** | Classified listings |
| **NIP-VA** | Verifiable attestations (kind 31000) |

## Configuration

### Config file (recommended)

Create `~/.config/bray/config.json` (or `~/.nostr/bray.json`):

```json
{
  "bunkerUriFile": "/Users/you/.nostr/bunker-uri",
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "trustMode": "annotate"
}
```

Secrets are referenced by **file path** (`bunkerUriFile`, `secretKeyFile`, `nwcUriFile`) so they never appear in the config itself.

Search order: `BRAY_CONFIG` env var > `$XDG_CONFIG_HOME/bray/config.json` > `~/.nostr/bray.json`.

### Environment variables

| Variable | Description |
|----------|-------------|
| `BRAY_CONFIG` | Path to config file |
| `BUNKER_URI` | NIP-46 bunker URL (safest) |
| `BUNKER_URI_FILE` | Path to bunker URI file |
| `NOSTR_SECRET_KEY` | nsec, hex, or BIP-39 mnemonic |
| `NOSTR_SECRET_KEY_FILE` | Path to secret key file |
| `NOSTR_NCRYPTSEC` | NIP-49 encrypted key |
| `NOSTR_NCRYPTSEC_PASSWORD` | Password for ncryptsec |
| `NOSTR_RELAYS` | Comma-separated relay URLs |
| `TOR_PROXY` | SOCKS5h proxy for Tor |
| `NIP04_ENABLED` | Set `1` to enable legacy NIP-04 DMs |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port (default 3000) |

All secret env vars are deleted from `process.env` immediately after parsing.

## CLI

```bash
npx nostr-bray whoami                    # show your npub
npx nostr-bray post "hello from bray!"   # publish a note
npx nostr-bray persona work              # derive a work persona
npx nostr-bray prove blind               # create a linkage proof
npx nostr-bray --help                    # see all commands
```

## Documentation

- **[Usage Guide](./docs/guide.md)** -- walkthroughs for identity, DMs, attestations, payments, and duress
- **[Examples](./examples/)** -- MCP config files and CLI workflow scripts
- **[Contributing](./CONTRIBUTING.md)** -- setup, architecture, testing, and conventions

## For AI Assistants

See [llms.txt](./llms.txt) for a concise summary optimised for AI context windows, or [llms-full.txt](./llms-full.txt) for complete tool documentation with parameter details.

## Licence

MIT
