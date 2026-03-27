# NIP Additions + README Overhaul

**Date:** 2026-03-27
**Status:** Approved
**Scope:** 4 new NIPs (complete NIP-05, add NIP-42/45/50) + README/site documentation update

## Background

Audit of bray.forgesworn.dev revealed:
- NIP-05 (DNS identity) is only partially implemented (verification buried inside trust scoring, no standalone tools, relay discovery ignored)
- NIP-42 (relay AUTH), NIP-45 (COUNT), NIP-50 (search) are referenced in code/docs but not implemented
- ~54 tools across marketplace, moderation, privacy/ZK, lists, and labels are fully implemented but missing from the README
- Tool counts in the README are inaccurate (e.g. Blossom listed as 3, actually 10)

NIP-96 (HTTP file storage) was evaluated and deliberately excluded. Blossom is winning the ecosystem, bray already has 10 Blossom tools, and maintaining two parallel upload paths adds complexity without meaningful benefit.

## Decision: NIP-42 Approach

Three options were considered for relay AUTH:

- **A) Wrap SimplePool** with custom WebSocket interception for transparent auth
- **B) Drop to Relay class** for auth-required relays, creating two relay code paths
- **C) Explicit `relay-auth` tool** that the agent calls when needed

**Chosen: C.** It fits the MCP tool model (agent decides when to auth), keeps the pool architecture untouched, and can be upgraded to transparent auth later. nostr-tools' SimplePool does not expose AUTH hooks, making A/B premature.

## Implementation Plan

Five commits on a single branch, ordered by dependency and effort:

### Step 1: NIP-05 -- DNS Identity (complete it)

**New file:** `src/identity/nip05.ts`
**Modified:** `src/identity/tools.ts`, `src/workflow/handlers.ts`

Three new tools:

**`nip05-lookup`**
- Input: `identifier` (e.g. `bob@example.com`)
- Fetches `https://domain/.well-known/nostr.json?name=localPart`
- Returns: `{ pubkey, relays?, identifier }`
- Safety: URL validation (block private IPs), 5s timeout, response size cap

**`nip05-verify`**
- Input: `pubkey` (hex), `identifier` (user@domain)
- Fetches the nostr.json, compares pubkey
- Returns: `{ verified: boolean, identifier, pubkey }`
- Safety: same as lookup

**`nip05-relays`**
- Input: `identifier` (user@domain)
- Returns the `relays` field from the NIP-05 response: `{ relays: { [pubkey]: [url, ...] } }`
- Returns empty object if no relay hints present

**Refactor:** Extract `verifyNip05()` from `src/workflow/handlers.ts` into `src/identity/nip05.ts` as a shared function. The workflow handler imports it from the new location.

All tools are **discoverable** (not promoted).

### Step 2: NIP-50 -- Search Filters

**Modified:** `src/relay/handlers.ts`, `src/relay/tools.ts`

No new tools. Extends the existing `relay-query` tool:

- Add `search: z.string().optional().describe('Full-text search query (NIP-50). Only works on relays that support NIP-50.')` to the input schema
- In `handleRelayQuery()`, add `search` to the filter object when provided
- Add a note in the response when search is used, indicating not all relays support NIP-50

Graceful degradation: relays that do not support NIP-50 ignore the field and return unfiltered results.

### Step 3: NIP-45 -- COUNT

**New file:** `src/relay/count.ts`
**Modified:** `src/relay/tools.ts`

One new tool:

**`relay-count`**
- Input: `relays` (array of URLs), `filter` (standard Nostr filter object)
- Connects to each relay using nostr-tools' lower-level `Relay` class (SimplePool has no COUNT support)
- Sends `["COUNT", subId, filter]`
- Parses `["COUNT", subId, {"count": N}]` response
- Falls back to fetch-and-count if relay does not support COUNT (with warning in response, capped at limit 1000 to avoid pulling massive result sets)
- 5s timeout per relay, connection closed after response
- Returns: `{ counts: [{ relay, count, estimated?: boolean, fallback?: boolean }] }`

**Discoverable**, not promoted.

### Step 4: NIP-42 -- Relay AUTH

**New file:** `src/relay/auth.ts`
**Modified:** `src/relay/tools.ts`

One new tool:

**`relay-auth`**
- Input: `relay` (URL string)
- Flow:
  1. Connect to relay via lower-level `Relay` class
  2. Wait for `["AUTH", challenge]` (2s timeout)
  3. Build kind 22242 event: `{ kind: 22242, tags: [["relay", relayUrl], ["challenge", challenge]], content: "" }`
  4. Sign with current identity via `IdentityContext`
  5. Send `["AUTH", signedEvent]`
  6. Wait for `["OK", eventId, true, ...]` confirmation
  7. Close connection
- Returns: `{ authenticated: true, relay, pubkey }` or `{ authenticated: false, relay, error }`

**What it does not do:** No persistent sessions, no transparent pool-wide auth, no automatic retry. The agent reasons about auth failures and calls this tool explicitly.

**Safety:**
- Tor policy respected (SOCKS5h proxy if Tor-only mode)
- Challenge validated as string before signing
- Relay URL validated via existing `relayUrl` validator
- Kind 22242 events include relay URL tag (prevents cross-relay replay)

**Discoverable**, not promoted.

### Step 5: README + Site Overhaul

**Modified:** `README.md`, `docs/guide.md`

Changes:
- Fix tool counts in the group table (Blossom 3->10, Safety 2->14, Trust 11->22, Social 14->actual)
- Add missing tool groups: Marketplace, Moderation, Privacy/ZK, Lists, Labels, Relay Intelligence
- Add the 5 new tools and 1 enhanced tool from steps 1-4
- Update NIP support table to include NIP-05 (full), NIP-42, NIP-45, NIP-50
- Update total tool count to reflect reality
- No em dashes in copy

What does not change: overall structure, branding, configuration docs, transport docs.

## Testing

Each step includes unit tests following the existing pattern (`test/<group>/handlers.test.ts`):

- **NIP-05:** Mock fetch for nostr.json responses (valid, invalid, timeout, missing relays field)
- **NIP-50:** Verify search parameter is added to filter object correctly
- **NIP-45:** Mock WebSocket for COUNT response, verify fallback behaviour
- **NIP-42:** Mock WebSocket for AUTH challenge/response flow, verify kind 22242 event structure

## Files Changed

| File | Action | Step |
|------|--------|------|
| `src/identity/nip05.ts` | Create | 1 |
| `src/identity/tools.ts` | Modify | 1 |
| `src/workflow/handlers.ts` | Modify (extract verifyNip05) | 1 |
| `test/identity/nip05.test.ts` | Create | 1 |
| `src/relay/handlers.ts` | Modify (add search param) | 2 |
| `src/relay/tools.ts` | Modify (steps 2-4) | 2, 3, 4 |
| `test/relay/search.test.ts` | Create | 2 |
| `src/relay/count.ts` | Create | 3 |
| `test/relay/count.test.ts` | Create | 3 |
| `src/relay/auth.ts` | Create | 4 |
| `test/relay/auth.test.ts` | Create | 4 |
| `README.md` | Modify | 5 |
| `docs/guide.md` | Modify | 5 |

## Out of Scope

- NIP-96 (HTTP file storage) -- Blossom covers this, ecosystem momentum favours Blossom
- Transparent pool-wide AUTH -- future enhancement if demand justifies it
- NIP-07 (browser extension signing) -- not relevant for MCP server context
- Demo GIF recordings -- planned as a follow-up after features and docs land
