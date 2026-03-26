# nostr-bray Pain Point Solutions — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Workflow tools, smart defaults, nostr-veil integration

## Problem Statement

Research across Nostr client communities (Damus, Primal, Amethyst, Coracle, Nostrudel, nak) identifies 14 categories of user pain points. The top complaints:

1. **Key management / onboarding complexity** — key loss is permanent, no recovery, no guided setup
2. **Spam / no trust layer** — feeds overwhelmed by bots, no shared WoT, fragmented moderation
3. **Relay sustainability / data loss** — relays die, content disappears, no health visibility
4. **Content discovery / cold start** — empty feeds, hard to find people, no algorithmic help
5. **DM metadata leaks** — NIP-04 exposes sender/recipient, clients default to insecure
6. **Contact list overwrites** — kind 3 last-write-wins destroys follow lists
7. **Impersonation** — NIP-05 confused with verification, no real identity proofs
8. **IP exposure** — clients connect directly to relays, no Tor by default

nostr-bray already has the cryptographic primitives to solve most of these (nsec-tree, Shamir, NIP-VA attestations, ring signatures, NIP-17, Tor). The gap is **user-facing workflows** that compose these primitives into intuitive actions.

## Design Decisions

- **Approach:** Hybrid — smart defaults on existing tools + new workflow tools for multi-step operations
- **nostr-veil:** Hard dependency. Trust scoring enabled by default on feeds and notifications.
- **Prerequisite:** nostr-veil must be published to npm at >=0.1.0 with its full API surface (graph, proof, nip85, identity modules) before implementation begins. The library exists locally at full maturity (178 tests, 6 subpath exports) but npm currently has a 0.0.1 stub. Publish first, then add as dependency.
- **NIP changes:** None required. NIP-VA and NIP-TRUST are fit for purpose. Pain points are tool-layer problems.
- **UX principle:** Warn and inform, never silently block. User always has final say.
- **Parity:** Every feature works identically in CLI and MCP.
- **Backwards compatibility:** Adding `trust: 'strict'` as the default on `social-feed` and `social-notifications` changes output behaviour for existing users. This is intentional — trust-scored feeds are the value proposition. Users who want unfiltered output pass `trust: 'off'` or `--no-trust` on CLI.

## 1. nostr-veil Integration Layer

New module `src/veil/` wraps nostr-veil's trust graph and scoring APIs for use by bray's handlers.

### src/veil/scoring.ts

Thin wrapper over nostr-veil:

- `scorePubkey(pubkey, context)` — fetches kind 30382 (NIP-85) assertions from relays, calls `buildTrustGraph()` + `computeTrustRank()`, returns 0-100 normalised score
- `scoreEvents(events, context)` — batch-scores event authors, returns events annotated with `_trustScore`
- Scores cached per-pubkey with 5-minute TTL via `src/veil/cache.ts`

### src/veil/filter.ts

Filtering logic used by existing handlers:

- `filterByTrust(events, { threshold?, mode? })` — returns events where author score >= threshold
- `mode: 'strict'` (default) — hide events below threshold
- `mode: 'annotate'` — return all events with scores attached
- `mode: 'off'` — pass-through, no scoring

### src/veil/cache.ts

LRU cache for trust scores:

- Key: pubkey, Value: `{ score, endorsements, ringEndorsements, timestamp }`
- TTL: 5 minutes (configurable via `VEIL_CACHE_TTL` env var, in seconds)
- Max entries: 500 (configurable via `VEIL_CACHE_MAX` env var)
- Eviction: LRU when full
- Config loaded in `src/config.ts` alongside existing env vars

### Default Trust Threshold

Score >= 1 (at least one endorsement from someone in extended graph). Score 0 = "nobody in your network has endorsed this person." Catches worst spam while being lenient for legitimate strangers.

## 2. Smart Defaults on Existing Tools

Changes to existing handlers — no new tools.

### Social tools — trust scoring

| Tool | Change |
|---|---|
| `social-feed` | Add optional `trust` param (`'strict'` \| `'annotate'` \| `'off'`, default `'strict'`). Filter via `filterByTrust()`. Include `trustScore` on each event. |
| `social-notifications` | Filter through `filterByTrust('strict')` by default. Spam mentions/replies silently dropped. `trust` param to override. |
| `social-reply` | Annotate parent event with author trust score. Warn if score is 0: "This author has no trust endorsements in your network." Don't block. |
| `dm-read` | Annotate messages with sender trust score. No filtering (DMs are intentional). |

### Contact tools — safety net

| Tool | Change |
|---|---|
| `contacts-follow` | Add `confirm` param to handler signature and Zod schema. Snapshot current kind 3 before publishing. If new list is >20% smaller than old, return `{ published: false, warning: "Contact list shrank by N%. Pass confirm: true to proceed.", previous: [...], proposed: [...] }` instead of publishing. |
| `contacts-unfollow` | Same snapshot + size-check guard + `confirm` param. |

Note: Both handlers currently live in `src/social/handlers.ts` (not a separate contacts file). The handler return type gains a union: `PostResult | ContactGuardWarning`.

### DM tools — health awareness

| Tool | Change |
|---|---|
| `dm-send` | After NIP-65 inbox relay lookup, check reachability. Warn if none respond: "None of recipient's inbox relays responded. Message may not be delivered." Still sends. Handler lives in `src/social/dm.ts`. |

### Relay tools — health awareness

| Tool | Change |
|---|---|
| `relay-list` | Annotate each relay with `reachable: true/false` (3-second NIP-11 timeout). Note: `handleRelayList` is currently synchronous — becomes async to perform NIP-11 health checks. Tool registration in `src/relay/tools.ts` updated accordingly. |

### Identity tools — guidance

| Tool | Change |
|---|---|
| `identity-derive` | On first derivation (no cached identities), hint: "Consider running `identity-setup` for guided safe identity creation with backup and relay configuration." |

### Already safe (no changes needed)

- `social-profile-set` — shows diff, requires `confirm: true`
- `relay-set` — warns on existing list, requires `confirm: true`
- `zap-send` — preview mode, requires `confirm: true`

## 3. New Workflow Tools

Six new tools in `src/workflow/`. All registered in the action catalog (discoverable via `search-actions`).

### trust-score

**Purpose:** "How trustworthy is this pubkey?"

**Params:** `pubkey` (required), `depth?` (default 2)

**Behaviour:**
1. Fetch kind 30382 (NIP-85) assertions about subject
2. Fetch kind 31000 (NIP-VA) attestations about subject
3. Build trust graph via `buildTrustGraph()` + `computeTrustRank()`
4. Verify ring-backed assertions via `verifyProof()`
5. Return structured response:

```typescript
{
  pubkey: string
  npub: string
  score: number           // 0-100 normalised
  endorsements: number
  ringEndorsements: number
  attestations: Array<{
    type: string
    attestor: string
    content: string
    expires?: string
  }>
  socialDistance: number   // hops from active identity via follow graph
  flags: string[]         // warnings: "no endorsements", "expired attestations", etc.
}
```

**CLI:** `npx nostr-bray trust-score npub1...`

### feed-discover

**Purpose:** "Who should I follow?"

**Params:** `strategy?` (`'trust-adjacent'` | `'topic'` | `'active'`, default `'trust-adjacent'`), `limit?` (default 20), `query?` (required for `topic` strategy)

**Strategies:**
- **trust-adjacent** — pubkeys followed by your follows, not by you. Ranked by trust score.
- **topic** — search kind 1 events by query (NIP-50 if available, tag search fallback). Return authors ranked by trust score.
- **active** — pubkeys with >= 5 kind 1 posts in the last 7 days, within 2 hops of follow graph. Hop traversal: fetch active identity's kind 3 (hop 1), then fetch each contact's kind 3 (hop 2). Cap at 500 unique pubkeys to bound relay queries. Rank by trust score.

**Returns:** Array of `{ pubkey, npub, name?, nip05?, trustScore, mutualFollows, reason }`

**CLI:** `npx nostr-bray feed-discover --strategy trust-adjacent --limit 10`

### verify-person

**Purpose:** "Is this person who they claim to be?"

**Params:** `pubkey` (required), `method?` (`'full'` | `'quick'`, default `'quick'`)

**Quick mode:**
1. Fetch NIP-VA attestations (kind 31000)
2. Check NIP-05 resolution
3. Compute trust score
4. Check linkage proofs (kind 30078)
5. Return verification summary with confidence level

**Full mode adds:**
6. Ring-backed assertion verification
7. Generate spoken verification challenge — uses a shared secret derived from NIP-44 conversation key between active identity and subject (deterministic, no prior exchange needed). Returns a 6-digit token with counter-based expiry (±1 counter tolerance, ~5 minute window). The other party verifies by running the same tool with their identity active.

**Returns:**

```typescript
{
  pubkey: string
  npub: string
  name?: string
  nip05: { verified: boolean, handle?: string }
  trustScore: number
  attestations: Array<{ type: string, by: string, content: string }>
  linkageProofs: Array<{ mode: string, linkedTo: string }>
  ringEndorsements: Array<{ circleSize: number, threshold: number, verified: boolean }>
  spokenChallenge?: { token: string, expiresIn: string }
  confidence: 'high' | 'medium' | 'low' | 'unknown'
}
```

**Confidence levels:**
- **high** — trust score >= 50 AND at least one NIP-VA attestation AND verified NIP-05
- **medium** — trust score >= 20 OR at least one attestation OR verified NIP-05
- **low** — trust score >= 1 (some endorsement exists)
- **unknown** — score 0, no attestations, no NIP-05

**CLI:** `npx nostr-bray verify-person npub1... --method full`

### identity-setup

**Purpose:** "Set me up safely from scratch."

**Params:** `personas?` (array of names, default `['main', 'anonymous']`), `shamirThreshold?` (default `{ shares: 5, threshold: 3 }`), `relays?` (array of URLs or sensible defaults)

**Behaviour:**
1. Derive each persona via nsec-tree
2. Create Shamir backup shards (files with 0600 permissions)
3. Configure relay sets per persona (main gets provided relays, anonymous gets separate set)
4. Publish NIP-65 relay lists for each persona
5. Return summary: personas created, shard file paths, relay config, "what next" guide

**Safety:** Shows preview of all actions, requires `confirm: true` to execute.

**Transport note:** Shamir shard files are written to the local filesystem. When running over HTTP transport (remote MCP), shard file paths are meaningless to the remote client. In HTTP mode, return shard content as NIP-49 ncryptsec-encrypted strings instead of file paths — the client provides a password, shards are encrypted before transmission. CLI mode writes files as described.

**CLI:** `npx nostr-bray identity-setup --personas main,work,anonymous --relays wss://relay.damus.io,wss://nos.lol`

### identity-recover

**Purpose:** "I lost access. Help me get back."

**Params:** `shardPaths` (array of file paths OR base64-encoded shard content for HTTP transport), `newRelays?` (relay URLs)

**Transport note:** In HTTP transport mode, accepts base64-encoded shard content directly instead of file paths. CLI mode reads from file paths as described.

**Behaviour:**
1. Read shard files, reconstruct master key via Shamir
2. Derive persona tree (deterministic — same master = same children)
3. Verify by comparing derived npubs against known identities
4. Optionally publish updated relay lists
5. Return: recovered identities, verification status, next steps

**Safety:** Never returns private keys. Shows derived npubs for user confirmation before publishing.

**CLI:** `npx nostr-bray identity-recover --shards shard1.txt,shard2.txt,shard3.txt`

### relay-health

**Purpose:** "Are my relays healthy?"

**Params:** `pubkey?` (default: active identity), `checkWrite?` (default `false`)

**Behaviour:**
1. Fetch NIP-65 relay list
2. Per relay: NIP-11 info request (response time, supported NIPs, limitations)
3. Check if relay holds recent events from this pubkey
4. Optionally test write access (publish disposable ephemeral event)
5. Return per-relay health report:

```typescript
{
  url: string
  reachable: boolean
  responseTime: number      // ms
  hasYourEvents: boolean
  supportedNips: number[]
  writeAccess?: boolean
  warnings: string[]        // "no NIP-50", "no NIP-17", ">2s response"
}
```

**CLI:** `npx nostr-bray relay-health`

## 4. NIP Audit Results

All existing NIPs assessed against pain points:

| Pain Point | Protocol | Verdict |
|---|---|---|
| Impersonation | NIP-VA (kind 31000) | Sufficient — attestation chains solve real verification |
| No shared WoT | NIP-85 + NIP-VA | Sufficient — nostr-veil integrates both |
| Trust revocation | NIP-TRUST (kind 30515) | Sufficient — not yet consumed by veil (future enhancement) |
| Contact list overwrites | Kind 3 (NIP-02) | Protocol limitation — mitigated at tool layer |
| DM metadata | NIP-17 + NIP-44 | Sufficient — bray defaults to NIP-17 |
| No forward secrecy | NIP-44 | Protocol limitation — needs community-level work |
| Relay data loss | NIP-65 | Sufficient for config — data loss is economic problem |
| Spam | NIP-85 + NIP-VA + NIP-56 | Sufficient — gap was tool-layer filtering, now solved |
| Content discovery | NIP-50 | Partial — NIP-50 optional, mitigated by social graph traversal |
| Cold start | None | Tool-layer problem — solved by feed-discover |

**No NIP changes required.**

## 5. Module Structure

### New files

```
src/veil/
  scoring.ts
  filter.ts
  cache.ts

src/workflow/
  handlers.ts
  tools.ts

test/veil/
  scoring.test.ts
  filter.test.ts
  cache.test.ts

test/workflow/
  handlers.test.ts
```

### Modified files

```
src/social/handlers.ts     — trust param + filtering on feed, notifications, reply
src/social/dm.ts           — relay health warning on send, trust annotation on read
src/social/handlers.ts     — (also) snapshot + size-check guard on contacts-follow/unfollow + confirm param
src/social/tools.ts        — add confirm param to contacts-follow/unfollow Zod schemas
src/relay/handlers.ts      — health annotation on relay-list
src/identity/handlers.ts   — identity-setup hint on first derivation
src/catalog.ts             — register 6 workflow tools
package.json               — add nostr-veil dependency
```

### Dependency flow

```
nostr-veil (hard dependency, new)
  ├── @forgesworn/ring-sig     (already in bray)
  ├── nostr-attestations        (already in bray)
  └── nsec-tree                 (already in bray)

src/veil/scoring.ts
  ├── nostr-veil/graph
  ├── nostr-veil/proof
  └── src/relay-pool.ts

src/veil/filter.ts
  └── src/veil/scoring.ts

src/workflow/handlers.ts
  ├── src/veil/scoring.ts
  ├── src/veil/filter.ts
  ├── src/identity/handlers.ts
  ├── src/trust/handlers.ts
  ├── src/relay/handlers.ts
  └── src/context.ts
```

### Catalog placement

All 6 workflow tools in the action catalog (discoverable via `search-actions`). Promoted tool set unchanged.

### Tool registration pattern

Workflow tools follow the same pattern as existing groups. `src/workflow/tools.ts` exports a `registerWorkflowTools(server, deps)` function that receives the MCP server proxy and a dependencies object:

```typescript
interface WorkflowDeps {
  context: IdentityContext
  pool: RelayPool
  nip65: Nip65Manager
  scoring: VeilScoring  // from src/veil/scoring.ts
}
```

Called from `src/index.ts` alongside existing `register*Tools()` calls.

### Relationship to existing tools

`trust-score` is a higher-level composition of `trust-read` + veil scoring. `trust-read` remains for raw attestation queries; `trust-score` adds WoT graph analysis on top. They complement, not replace.

### Testing

- **Veil module tests** (`test/veil/`): mock relay pool to return fixture NIP-85 events, verify scoring produces expected 0-100 values, verify filtering modes, verify cache TTL and eviction. ~15-20 tests.
- **Workflow handler tests** (`test/workflow/`): mock veil scoring + mock relay pool + mock identity context. Test each of the 6 tools with happy path + edge cases (no endorsements, expired attestations, unreachable relays, Shamir reconstruction failure). ~30-40 tests.
- **Smart default tests**: extend existing test files (`test/social/handlers.test.ts`, `test/relay/handlers.test.ts`) with cases for trust params, contact size guard warnings, relay health annotations. ~15-20 tests.
- **Target:** maintain 96% coverage. Estimated ~60-80 new tests total.
- **Mocking nostr-veil:** create `test/helpers/mock-veil.ts` with factory functions that return `TrustRank[]` and `ProofVerification` objects. Same pattern as existing `test/helpers/`.
