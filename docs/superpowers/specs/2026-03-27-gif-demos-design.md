# GIF Demo Recordings for bray

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Automated GIF demo pipeline covering all 185 bray tools

## Background

The bray marketing site and README need visual demos showing each tool in action. Rather than screenshots or written descriptions, short animated GIFs of real Claude Code sessions give immediate credibility and help users understand what each tool does.

## Approach

**Semi-automated recordings using `claude -p` + `asciinema` + `agg`.**

Each tool gets a one-line prompt. A shell script loops through all prompts, runs each via `claude -p` (non-interactive Claude Code), records the terminal session with `asciinema`, and converts to GIF with `agg`.

Tools are organised into two categories:
- **Story demos** (26 groupings of 2-4 tools chained into workflows)
- **Solo demos** (~80 standalone utility tools)

Story demos record a single session where Claude uses multiple tools in sequence. Solo demos record one tool call each.

### Why not VHS scripted simulations?

Simulations are easier to control but lack authenticity. Real Claude Code sessions show the actual MCP tool call flow, status line, thinking indicators, and formatted output. This is what users will see when they use bray themselves.

### Why not manual recording?

185 individual manual recordings would take days and be impossible to maintain as the tool set evolves. The semi-automated approach lets us reshoot any demo by re-running a single prompt.

## Prerequisites

- `asciinema` (terminal recorder): `brew install asciinema`
- `agg` (asciinema-to-GIF converter): `brew install agg`
- `claude` CLI with bray MCP server configured
- A dedicated demo identity (fresh nsec, test persona)
- Public test relays configured

## Directory Structure

```
site/demos/
  record.sh              # Main orchestrator
  prompts/
    stories/             # Multi-tool workflow prompts
      01-identity-onboarding.txt
      02-identity-backup.txt
      ...
    solo/                # Single-tool prompts
      encode-npub.txt
      verify-event.txt
      ...
  casts/                 # Raw asciinema recordings (.cast)
  gifs/                  # Final GIF output
  gallery.html           # Browsable gallery page
```

## Recording Pipeline

Per-demo flow:

1. `asciinema rec` starts capturing the terminal
2. `claude -p "$(cat prompts/stories/01-identity-onboarding.txt)"` runs in the recorded shell
3. Claude Code executes, calls bray MCP tools, shows output
4. `asciinema rec` stops when the command exits
5. `agg` converts the `.cast` file to a GIF

The orchestrator script (`record.sh`) handles:
- Looping through all prompt files
- Naming output files consistently
- Skipping already-recorded demos (unless `--force`)
- Setting terminal width/height for consistency

## GIF Specifications

| Setting | Value |
|---------|-------|
| Terminal width | 100 columns |
| Terminal height | 30 rows |
| Theme | Dark (matches site aesthetic) |
| Font size | 14px |
| Max duration | Story: 15-20s, Solo: 5-8s |
| Loop | Once, then hold final frame |
| Status line | `darren@ForgeSworn.dev:bray` |

## Story Demos (26 groupings)

Each story prompt asks Claude to perform a natural workflow using 2-4 tools in sequence.

| # | Story | Tools | Prompt summary |
|---|-------|-------|----------------|
| 1 | Identity Onboarding | identity-create, identity-derive-persona, identity-switch, whoami | Create a new identity, derive a "demo" persona, switch to it, confirm |
| 2 | Identity Backup | identity-backup-shamir, identity-restore-shamir | Split key into 3-of-5 shards, reconstruct from 3 |
| 3 | Profile and NIP-05 | social-profile-set, nip05-lookup, nip05-verify | Set profile, look up a NIP-05, verify it |
| 4 | Feed and Discovery | social-notifications, feed-discover, contacts-follow | Check notifications, discover accounts, follow one |
| 5 | Direct Messaging | contacts-search, dm-send, dm-read | Find contact, send encrypted DM, read inbox |
| 6 | Public Engagement | social-post, social-reply, social-react | Post a note, reply to someone, react |
| 7 | Trust Check | signet-badge, trust-score, verify-person | Quick badge, deep score, full verification |
| 8 | Attestation and Vouching | signet-vouch, trust-attest, trust-claim | Vouch for someone, build trust profile |
| 9 | Professional Verification | signet-verifiers, signet-policy-set, signet-policy-check | Find verifier, set policy, check compliance |
| 10 | Ring Signatures | trust-ring-prove, trust-ring-verify | Anonymous group endorsement |
| 11 | Spoken Verification | trust-spoken-challenge, trust-spoken-verify | In-person identity via spoken tokens |
| 12 | Privacy Proofs | privacy-commit, privacy-prove-age, privacy-verify-age | Prove 18+ without revealing age |
| 13 | Vault Setup | vault-create, vault-encrypt, vault-share | Create tiers, encrypt, share keys |
| 14 | Relay Management | relay-list, relay-set, relay-health | See relays, update list, check health |
| 15 | Relay Discovery | relay-discover, relay-nip-search, relay-recommend | Find relays by contacts, NIPs, strategy |
| 16 | Content Moderation | list-mute, label-create, moderation-filter | Mute, label, filter |
| 17 | Marketplace | marketplace-discover, marketplace-inspect, marketplace-pay, marketplace-call | Find service, inspect, pay, call |
| 18 | Zap Workflow | zap-balance, zap-make-invoice, zap-send | Check balance, create invoice, send |
| 19 | Decode and Fetch | decode, fetch | Decode nip19 code, fetch the event |
| 20 | Canary Session | canary-session-create, canary-session-current, canary-session-verify | Phone verification flow |
| 21 | Canary Group | canary-group-create, canary-group-current, canary-group-verify | Team liveness check-in |
| 22 | Canary Beacon | canary-beacon-create, canary-beacon-check | Location liveness proofs |
| 23 | Follow Sets | list-followset-create, list-followset-manage, list-followset-read | Audience segmentation |
| 24 | Bookmarks | list-pin, list-bookmark, list-bookmark-read | Curate and organise content |
| 25 | Blossom Files | blossom-upload, blossom-list, blossom-mirror | Upload, manage, replicate |
| 26 | Relay Operator | relay-info, relay-count, relay-auth | Inspect, count, authenticate |

## Solo Demos (~80 tools)

Each solo prompt asks Claude to use one specific tool. Organised by group:

- **Encoding/Decoding** (6): encode-npub, encode-note, encode-nprofile, encode-nevent, encode-naddr, encode-nsec
- **Crypto Utilities** (6): verify-event, nip44-encrypt, nip44-decrypt, key-public, key-encrypt, key-decrypt
- **Privacy** (7): privacy-open, privacy-prove-range, privacy-verify-range, privacy-prove-threshold, privacy-verify-threshold, privacy-publish-proof, privacy-read-proof
- **Trust Utilities** (14): trust-verify, trust-read, trust-request, trust-request-list, trust-proof-publish, trust-attest-parse, trust-attest-filter, trust-attest-temporal, trust-attest-chain, trust-attest-check-revoked, trust-ring-lsag-sign, trust-ring-lsag-verify, trust-ring-key-image, trust-spoken-directional, trust-spoken-encode
- **Identity Utilities** (5): identity-list, identity-prove, identity-backup, identity-restore, identity-migrate
- **Content Management** (5): label-remove, label-read, label-search, label-self, list-mute-read, list-check-muted
- **Social Utilities** (4): social-delete, social-repost, dm-by-name, dm-conversation
- **Event Queries** (4): count, fetch, filter, social-feed
- **NIP Info** (2): nip-list, nip-show
- **Marketplace Utilities** (5): marketplace-search, marketplace-reputation, marketplace-compare, marketplace-probe, marketplace-credentials-clear
- **Canary Utilities** (8): canary-session-current, canary-session-verify, canary-group-current, canary-group-verify, canary-group-members, canary-group-join, canary-duress-signal, canary-duress-detect
- **Safety** (2): safety-configure, safety-activate
- **Signet** (1): signet-credentials
- **Relay Utilities** (4): relay-add, relay-query, relay-diversity, relay-compare
- **Zap Utilities** (4): zap-decode, zap-lookup-invoice, zap-list-transactions, zap-receipts
- **Workflow** (5): feed-discover, identity-setup, identity-recover, relay-health, onboard-verified
- **Blossom** (8): blossom-check, blossom-delete, blossom-discover, blossom-verify, blossom-repair, blossom-usage, blossom-servers-get, blossom-servers-set
- **Groups** (4): group-info, group-chat, group-send, group-members
- **NIP Publishing** (2): nip-publish, nip-read
- **Contacts** (3): contacts-get, contacts-follow, contacts-unfollow
- **Misc** (1): tombstone
- **NIP-05** (1): nip05-relays

## Embedding Strategy

**Gallery page** (`site/demos/gallery.html`):
- Browsable page with all GIFs organised by group
- Search/filter by tool name
- Linked from the main site navigation

**Site feature cards** (`site/index.html`):
- Each feature card gets one representative GIF (the story demo for that group)
- Plays on hover, pauses on mouse out
- Lazy-loaded for performance

**README** (`README.md`):
- Key story GIFs inline per tool group section
- Linked to gallery for the full set

## Demo Identity Setup

Before recording:
1. Generate a fresh identity with `identity-create`
2. Derive personas: "demo", "alice", "bob" for multi-identity demos
3. Configure test relays (`wss://relay.damus.io`, `wss://nos.lol`)
4. Set NWC URI to a test wallet (or skip zap demos if no test wallet)
5. Status line configured to `darren@ForgeSworn.dev:bray`

## Prompt Writing Guidelines

- Keep prompts short and specific: "Use the whoami tool to check the active identity"
- For story demos, describe the full workflow: "Create a new identity, derive a persona called 'demo', switch to it, then confirm with whoami"
- Avoid prompts that would expose real secrets or contact real people
- Use test data (fake npubs, example domains) where needed

## Maintenance

When new tools are added:
1. Write a prompt file in `prompts/solo/` or add to a story group
2. Run `record.sh <name>` to record just that demo
3. The gallery page auto-discovers GIFs from the `gifs/` directory

## Out of Scope

- Voiceover/narration (GIFs are silent; the terminal output speaks for itself)
- Video format (MP4, WebM); GIF only for simplicity and universal embedding
- Automated CI recording (manual trigger for now)
