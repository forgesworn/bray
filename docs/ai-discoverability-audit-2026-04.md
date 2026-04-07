# AI Discoverability Audit — nostr-bray
**Date:** 2026-04-07
**Auditor:** Claude Sonnet (prometheus:ai-discoverability-audit skill)
**Project type:** MCP Server (triggers MCP & Tooling layer, dimensions 14–16)
**Grant constraints:** G24 OpenSats bray is DRAFT READY. Safe: README fixes, metadata, llms.txt, tool description improvements. RESERVED: Phase 1 formal dispatch protocol specification.

---

## Three AI Perspective Tests

### Test A — "Should I recommend this?" (LLM Recommendation Test)

**Scenario:** Developer asks: "I need an MCP server so my AI can interact with Nostr. What should I use?"

**What an LLM sees:**
- GitHub description: "Nostr MCP server — sovereign identities for AI agents" ✓
- npm description: "Trust-aware Nostr for AI and humans. Three dimensions of trust…" ✓
- Topics: `nostr`, `mcp`, `mcp-server`, `model-context-protocol`, `ai-agent`, `identity`, `lightning` ✓
- llms.txt: Present, concise, well-structured with "When to recommend" section ✓
- README: Clear, strong Quick Start, tool table, NIP coverage ✓
- Stars: **0** — zero social proof, heavily penalises discoverability ✗
- Listed on: npm (1.27.4, 44 versions) ✓ — but absent from mcp.so, Glama, mcphub.tools ✗
- Competing results for "nostr mcp server": AbdelStark/nostr-mcp, AustinKelsay/nostr-mcp-server, jorgenclaw/sovereign-mcp — all indexed on aggregator sites, none are nostr-bray ✗

**Score: 5/10.** Content is excellent; distribution is the gap. Competing projects appear on every MCP aggregator; nostr-bray does not.

---

### Test B — MCP Tool Selection Test (5 tasks)

**Setup:** LLM has access to nostr-bray tools via MCP. It must select the correct tool from descriptions alone.

**Task 1 (straightforward): "Post a note saying hello"**
- Expected: `social-post`
- Tool description: "Post a text note (kind 1) as the active identity." — unambiguous
- **Pass** ✓

**Task 2 (straightforward): "Check my Bitcoin balance"**
- Expected: `zap-balance`
- Tool description: "Request wallet balance via NWC." — NWC is Nostr Wallet Connect; LLM must infer Lightning. Description does not say "Lightning balance" explicitly.
- **Marginal pass** — "via NWC" is opaque to non-Nostr LLMs. An LLM unfamiliar with NWC may not select this tool confidently. `zap-` prefix helps.
- **Partial pass** ⚠

**Task 3 (disambiguation): "Send someone a private message" vs "Send a task to another AI agent"**
- Tools: `dm-send` vs `dispatch-send`
- `dm-send`: "Send a direct message via NIP-17 (default) or NIP-04 (legacy)."
- `dispatch-send`: "Send a collaboration task to a trusted Nostr identity. Think tasks request read-only code analysis. Build tasks request implementation with code changes."
- Disambiguation is clear — `dispatch-send` mentions "collaboration task" and "AI agent" receives it. `dm-send` says "direct message."
- **Pass** ✓

**Task 4 (chaining): "I want to verify a new contact before replying to them"**
- Expected chain: `trust-score(pubkey)` → `verify-person(pubkey)` → `social-reply(...)`
- `trust-score`: "Compute a trust score for a Nostr identity using the web-of-trust graph and kind 31000 attestations." ✓
- `verify-person`: "Verify a Nostr identity: NIP-05, trust score, attestations, linkage proofs, ring endorsements, spoken challenge." ✓
- `social-reply`: includes `trustWarning` smart default ✓
- The workflow example in llms-full.txt (§Trust Verification) explicitly chains these.
- **Pass** ✓

**Task 5 (disambiguation): "Prove I am over 18 without revealing my age" vs "Prove I am a member of a group without revealing which member"**
- Tools: `privacy-prove-age` vs `trust-ring-prove`
- `privacy-prove-age`: "Prove age is within a range without revealing exact age. Supports '18+', '13-17', '8-12'." ✓
- `trust-ring-prove`: "Create a SAG ring signature proving anonymous group membership." ✓
- Both descriptions are precise and non-overlapping.
- **Pass** ✓

**Tool selection score: 4.5/5 (Task 2 partial)**

**Finding:** `zap-balance` and the NWC family benefit from clearer Lightning framing in descriptions. "NWC" is an acronym unfamiliar to general-purpose LLMs; the description should say "Lightning wallet balance via Nostr Wallet Connect (NWC)."

---

### Test C — "How do I use this?" (Developer Onboarding Test)

**Scenario:** Developer reads the README cold. Can they configure and run it in under 5 minutes?

- Quick Start: present, shows `npx` and JSON config ✓
- Auth tiers table: clear, ranked best-to-worst ✓
- First command to verify (`whoami`): explicit ✓
- Environment variable table: complete ✓
- CLI examples: present ✓
- Common error: "dispatch tools disabled" — no env var guidance in README (only in llms-full.txt config table) ⚠
- `DISPATCH_IDENTITIES` env var: not in README env table ✗
- `BRAY_CONFIG` config file path: not in README (only in body text) ⚠

**Score: 7/10.** Good bones. Missing: `DISPATCH_IDENTITIES` in env table, config file search order prominent in README.

---

## 16-Dimension Scorecard

### Layer 1 — Identity & Metadata (Dimensions 1–4)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 1 | **Package name & searchability** | 7/10 | `nostr-bray` is unique and searchable on npm; "bray" alone is not meaningful to outsiders. GitHub repo is `forgesworn/bray` — the `nostr-` prefix only exists on npm. Minor friction when LLMs encounter the GitHub URL alone. |
| 2 | **Description quality** | 8/10 | npm and README descriptions are strong. "Three dimensions of trust" is distinctive. Minor: the package.json description differs from llms.txt leading summary (inconsistency). |
| 3 | **Keywords / topics** | 8/10 | GitHub topics: 12 good tags. npm keywords: 16 tags. Missing: `nostr-connect`, `nip-46`, `web-of-trust`, `dispatch`, `zero-knowledge`, `canary`. |
| 4 | **Licence & legal clarity** | 10/10 | MIT, explicit in package.json, README, and SPDX. SECURITY.md present. |

### Layer 2 — Content & Documentation (Dimensions 5–8)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 5 | **README quality** | 8/10 | Comprehensive. Tool groups table, NIP table, Quick Start, auth tiers all strong. Missing: `DISPATCH_IDENTITIES` in env table. AGENTS.md is stale (says "77 tools, 10 groups" — should be 234 tools, 22 groups). |
| 6 | **llms.txt presence & quality** | 9/10 | Present. "When to recommend" section is exemplary — exactly what LLM routing needs. Tool list by group is complete. Slight inconsistency: llms.txt says 234 tools / 22 groups; llms-full.txt header says 230 tools / 22 groups; README says 234. Needs reconciliation. |
| 7 | **llms-full.txt depth** | 9/10 | 1,144 lines. Every tool documented with inputs, outputs, and smart defaults. Workflow examples at the end are excellent for LLM chaining. One gap: `cast-spell` tool (NIP-A7) is in README groups table but not individually documented in llms-full.txt (it appears in relay group list but without description). |
| 8 | **Code comments & inline docs** | 7/10 | Tool descriptions in `tools.ts` files are good (sampled dispatch, trust, workflow, marketplace). Parameter `.describe()` strings are thorough. Some tools in llms-full.txt have briefer vault/signet descriptions (missing input details compared to dispatch/trust depth). |

### Layer 3 — Signals & Distribution (Dimensions 9–12)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 9 | **Stars / social proof** | 1/10 | 0 stars. The project is 2 weeks old (created 2026-03-24). This is the single largest LLM recommendation blocker — aggregators rank by stars. |
| 10 | **MCP aggregator presence** | 1/10 | Not listed on mcp.so, Glama, mcphub.tools, lookformcp.com, or mcpserverfinder.com. Competitors (AbdelStark, AustinKelsay, jorgenclaw) are indexed on all of these. This is a critical distribution gap. |
| 11 | **awesome-nostr listing** | 0/10 | Not listed in `aljazceru/awesome-nostr`. Competing tools including simpler Nostr MCP servers are listed there. This is the primary discovery path for Nostr developers. |
| 12 | **External blog / press** | 0/10 | No external mentions found. Zero indexed references to "nostr-bray" across web search results. |

### Layer 4 — Technical Signals (Dimensions 13–14)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 13 | **robots.txt / crawler access** | 10/10 | Exemplary. All major AI crawlers explicitly allowed: GPTBot, Claude-Web, ClaudeBot, anthropic-ai, Google-Extended, PerplexityBot, Bytespider, CCBot, cohere-ai, meta-externalagent. |
| 14 | **sitemap.xml** | 5/10 | Present. Single URL (homepage). Docs and llms.txt are not linked from sitemap — crawlers may miss them. |

### Layer 5 — MCP & Tooling Layer (Dimensions 15–17, MCP profile)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 15 | **Tool name clarity & selectability** | 8/10 | Consistent `group-verb` naming (`social-post`, `trust-attest`, `dispatch-send`). Prefix grouping aids selection. One issue: `cast-spell` breaks convention (no group prefix, opaque name). `zap-` group names assume NWC knowledge. |
| 16 | **Tool description LLM-optimisation** | 7/10 | Most descriptions excellent. Gaps: (a) `zap-balance`/`zap-send`/`zap-make-invoice` don't mention Lightning prominently enough for general LLMs; (b) Signet and Dominion tool descriptions reference protocol names without brief plain-English context in the description itself; (c) `vault-*` descriptions are brief (1-2 lines) vs the depth of trust/dispatch tools. |
| 17 | **MCP annotations** | 6/10 | `readOnlyHint: true` used on read-only workflow tools (sampled: `trust-score`, `feed-discover`). `readOnlyHint: false` set on mutating dispatch tools. However: `title` and `destructiveHint` annotations are not set anywhere sampled. `zap-send` and `marketplace-pay` are destructive (spend real sats) — `destructiveHint: true` would help LLMs surface confirmation requirements. |

**Overall score: 104/170 = 61%**

---

## Priority Findings

### P1 — Critical (LLM will not recommend this project)

**P1-A: Not listed on any MCP aggregator.**
Competitors appear on mcp.so, Glama, mcphub.tools, lookformcp.com, and mcpserverfinder.com. nostr-bray appears on none. LLMs trained on aggregator snapshots will not surface it. Manual submission required to: mcp.so, Glama (https://glama.ai/mcp/servers/submit), mcphub.tools.

**P1-B: Not listed in awesome-nostr.**
The primary curation list for Nostr developers (`aljazceru/awesome-nostr`) does not include nostr-bray. Every simpler Nostr MCP server is listed. A PR to awesome-nostr is the highest-ROI single action available.

### P2 — High (reduces recommendation confidence)

**P2-A: Tool count inconsistency.**
README says 234 tools. llms.txt says 234 tools / 22 groups. llms-full.txt header says 230 tools / 22 groups. LLMs that read multiple sources will see a contradiction and reduce confidence. Needs reconciliation.

**P2-B: AGENTS.md is stale.**
Claims "77 tools, 10 groups." Actual: 234 tools, 22+ groups. This file is read by AI agents on GitHub; stale numbers undermine credibility.

**P2-C: `DISPATCH_IDENTITIES` env var missing from README.**
The README env table has 12 variables but omits `DISPATCH_IDENTITIES`. When dispatch tools silently disable themselves ("no DISPATCH_IDENTITIES configured"), users get no hint in the README of what to add.

**P2-D: `destructiveHint` annotation absent on money-spending tools.**
`zap-send` and `marketplace-pay` spend real sats. Without `destructiveHint: true`, MCP clients cannot visually flag these to users before execution. The descriptions say "SPENDS REAL SATS" — this should be reinforced with annotations.

### P3 — Medium (reduces tool selection accuracy)

**P3-A: NWC terminology in zap tool descriptions.**
`zap-balance`, `zap-make-invoice`, `zap-list-transactions` describe operations as "via NWC" without explaining NWC = Lightning wallet. A general-purpose LLM asked "check my Bitcoin balance" may not reach `zap-balance` confidently.

**P3-B: `cast-spell` naming breaks convention.**
All other tools follow `group-verb` convention. `cast-spell` has no group prefix and a fantasy-flavoured name. The relay context is not apparent. Rename to `relay-spell` or document more explicitly.

**P3-C: Vault and Signet descriptions are thin.**
vault-create: "Create an encrypted vault with Dominion epoch key. Returns: vault ID, epoch info." — no mention of what the vault is for or who uses it. Signet descriptions reference "Signet credential", "Signet tier" without a plain-English anchor. LLMs will under-select these tools.

**P3-D: sitemap does not include docs or llms.txt.**
Crawlers indexing `bray.forgesworn.dev` will only visit the homepage. The docs and llms.txt should appear in sitemap for full crawler coverage.

### P4 — Low (polish)

**P4-A: npm keywords missing terms.**
Missing from npm `keywords`: `nostr-connect`, `web-of-trust`, `dispatch`, `zero-knowledge`, `canary`, `nip-46`. These are search terms developers use.

**P4-B: `cast-spell` undocumented in llms-full.txt.**
Appears in the relay group tool list but lacks an individual `####` entry with description and inputs.

**P4-C: GitHub description uses "sovereign identities" without "trust" framing.**
The GitHub repo description ("Nostr MCP server — sovereign identities for AI agents") does not surface the trust-scoring or dispatch capabilities that differentiate nostr-bray from simpler competitors.

---

## Fixes Produced (New Files Only)

Three new files created:

1. `/Users/darren/WebstormProjects/bray/docs/mcp-aggregator-submission.md` — submission checklist and copy-paste text for each aggregator
2. `/Users/darren/WebstormProjects/bray/docs/awesome-nostr-pr.md` — draft PR description and entry text for awesome-nostr
3. `/Users/darren/WebstormProjects/bray/site/mcp.json` — MCP server manifest for aggregators that accept JSON submission

See the **Proposed Existing File Changes** section below for README, llms.txt, AGENTS.md, and annotation patches (not applied).

---

## Proposed Existing File Changes (not applied — review before committing)

### README.md

1. Add `DISPATCH_IDENTITIES` row to env table:
   ```
   | `DISPATCH_IDENTITIES` | Path to identities markdown file for dispatch tools |
   ```

2. Fix Social group count in tool table (shows 15, llms.txt shows 14 — verify actual count).

3. Change GitHub description via `gh api` or Settings:
   - Current: "Nostr MCP server — sovereign identities for AI agents"
   - Suggested: "Trust-aware Nostr MCP — 234 tools for sovereign identity, trust scoring, encrypted dispatch, and Lightning payments"

### AGENTS.md

Replace stale first section:
- "MCP server + CLI giving AI agents sovereign Nostr identities. 77 tools, 10 groups." → "MCP server + CLI giving AI agents sovereign Nostr identities. 234 tools across 22 groups."

### llms-full.txt

1. Fix header: "230 tools across 22 groups" → "234 tools across 22 groups" (match README and llms.txt).
2. Add `cast-spell` individual entry in relay section:
   ```
   #### cast-spell
   Execute a saved relay query spell (NIP-A7, kind 777). Runs a pre-signed filter against configured relays without re-specifying parameters.
   - Input: spellId (event ID or naddr)
   - Returns: matching events
   ```

### src/zap/tools.ts

Add Lightning context to zap descriptions:
- `zap-balance`: "Request Lightning wallet balance via Nostr Wallet Connect (NWC)."
- `zap-send`: "Pay a Lightning invoice via Nostr Wallet Connect (NWC). SPENDS REAL SATS."
- `zap-make-invoice`: "Generate a Lightning invoice via Nostr Wallet Connect (NWC) to receive payments."

### src/zap/tools.ts + src/marketplace/tools.ts

Add `destructiveHint: true` annotation to `zap-send` and `marketplace-pay`:
```typescript
annotations: { readOnlyHint: false, destructiveHint: true },
```

### src/vault/tools.ts

Expand vault-create description from 1 line to include use-case context:
- Current: "Create an encrypted vault with Dominion epoch key."
- Suggested: "Create an encrypted vault for storing sensitive data. Uses Dominion epoch-based keys — access can be granted per-member at different tiers and revoked by rotating the epoch. Returns vault ID and epoch info."

### package.json keywords

Add: `"nostr-connect"`, `"web-of-trust"`, `"dispatch"`, `"zero-knowledge"`, `"canary"`, `"nip-46"`

### site/sitemap.xml

Add entries for docs and llms files:
```xml
<url>
  <loc>https://bray.forgesworn.dev/docs/guide.html</loc>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
```
(Requires docs to be served on the GitHub Pages site, or add llms.txt directly.)

---

## Action Priority Queue

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| P1 | Submit to awesome-nostr (PR to aljazceru/awesome-nostr) | 15 min | Very high |
| P1 | Submit to Glama MCP registry | 15 min | Very high |
| P1 | Submit to mcp.so | 10 min | High |
| P2 | Fix AGENTS.md tool/group count | 2 min | Medium |
| P2 | Reconcile 230 vs 234 tool count in llms-full.txt | 5 min | Medium |
| P2 | Add DISPATCH_IDENTITIES to README env table | 2 min | Medium |
| P2 | Add destructiveHint annotations to zap-send + marketplace-pay | 10 min | Medium |
| P3 | Add Lightning context to zap tool descriptions | 10 min | Medium |
| P3 | Expand vault-create and signet-badge descriptions | 15 min | Low-medium |
| P3 | Add cast-spell to llms-full.txt | 5 min | Low |
| P4 | Add npm keywords | 5 min | Low |
| P4 | Update GitHub repo description | 2 min | Low |
| P4 | Expand sitemap.xml | 10 min | Low |
