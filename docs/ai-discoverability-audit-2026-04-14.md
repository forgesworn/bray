# AI Discoverability Audit -- nostr-bray (2026-04-14)

Second audit. Prior pass at `ai-discoverability-audit-2026-04.md`.

## Overall Score: 8.2 / 10 (up from 6.0; +0.4 since Tier 4a applied)

## AI Perspective Tests

| Test | Before | After | Change | Finding |
|------|-------:|------:|-------:|---------|
| A: Recommendation (40%) | 7 | 8 | +1 | Value prop and differentiators clearer after llms.txt links to scenarios and docs. Dispatch + trust-aware framing now lands. |
| B: Code Generation / Tool Selection (40%) | 6.5 | 9.5 | +3 | Parameter accuracy 5 → 10 once `site/tools-manifest.json` is linked from llms.txt. Canonical JSON Schema for all 238 tools eliminates guessing. |
| C: Competitive Position (20%) | 3 | 4 | +1 | Richer docs improve once-landed impressions. External trust signals (stars, registry, em-dash fix) unchanged -- capped until Tier 4 ships. |

## Dimensional Scores

| Layer | Dimension | Before | After | Status |
|-------|-----------|-------:|------:|--------|
| Communication | First impressions | 6 | 6 | Unchanged (tagline not reordered) |
| Communication | README structure | 8 | 8 | - |
| Communication | llms.txt | 7 | 9 | Now links to manifest, scenarios, docs |
| Communication | Package metadata | 7 | 8 | Keywords expanded to 20 |
| Dev Experience | Examples | 5 | 8 | 5 worked agent-scenarios added |
| Dev Experience | Documentation | 8 | 9 | trust-scoring.md, dispatch.md added |
| Dev Experience | Structured data | 6 | 10 | tools-manifest.json generated from live Zod schemas |
| AI Collaboration | Agent instructions | 6 | 8 | .cursorrules brought in sync (77→235, 10→27 groups) |
| AI Collaboration | CONTRIBUTING.md | 7 | 7 | - |
| AI Collaboration | Context7/docs | 3 | 3 | No submission yet |
| Trust | GitHub presence | 3.5 | 7 | Description rewritten (no em dash, trust-aware), 7 new topics (19 total), wiki disabled, secret scanning + push protection on, Dependabot alerts + auto fixes on, social preview already uploaded |
| Trust | Maturity signals | 6 | 6 | - |
| Trust | Web footprint | 2 | 2 | Unchanged (Tier 4) |
| MCP & Tooling | Tool descriptions | 8.5 | 8.5 | Already strong |
| MCP & Tooling | Tool naming | 8 | 8 | - |
| MCP & Tooling | Server instructions / registry | 6 | 7 | Manifests reconciled (versions + group count) |

## Visibility Gap

- **Quality:** ~8/10 (weighted across Comms + DevEx + AI Collab + MCP + GitHub presence)
- **Visibility:** ~3/10 (0 GitHub stars, only Glama listing, still not in MCP registry or any awesome-* lists)
- **Gap:** still under-visible, though GitHub presence has closed
- **Interpretation:** repo metadata work done. The remaining bottleneck is third-party distribution: MCP registry, awesome-mcp-servers, awesome-nostr, Context7, launch post.

## Fixed This Session

**Tier 1 -- factual corrections:**
- `.cursorrules` -- tool counts 77→235, 10→27 groups, 329→1400 tests, added trust-context
- `server.json` -- version 1.27.7 → 1.31.0 (reconciled with npm)
- `site/mcp.json` -- 24 → 27 tool groups; added missing scheduled/community-nips/meta groups; version 1.27.4 → 1.31.0; description fixed
- `package.json` -- keywords expanded from 16 to 20: added ai-agents, dispatch, nip-17, nip-44

**Tier 2 -- new artifacts:**
- `scripts/export-tool-schemas.mjs` -- capture-only proxy harvests every Zod schema; runs in `npm run build`
- `site/tools-manifest.json` -- 238 tools with full JSON Schema draft 2020-12 parameter definitions (8669 lines)
- `examples/agent-scenarios/` -- 5 worked MCP JSON-RPC transcripts (onboard-and-post, dm-with-nip05, zap-with-confirm, trust-check-then-reply, dispatch-roundtrip) plus README
- `docs/trust-scoring.md` -- composite-level formula, three-dimension explanation, trust modes
- `docs/dispatch.md` -- setup, task types, lifecycle, chaining, capability discovery

**Tier 3 -- llms.txt and build integration:**
- llms.txt top matter now points at tools-manifest.json (draft 2020-12)
- llms.txt Links section adds manifest, scenarios, trust doc, dispatch doc
- package.json build script now runs export-tool-schemas.mjs after widgets

All 1400 tests pass after the changes.

## Remaining Opportunities (not applied this session)

Ordered by AI test score impact.

### Tier 4a -- GitHub repo metadata (DONE 2026-04-14)
- ✅ Description rewritten: "Trust-aware Nostr MCP server for AI agents and humans. Verification, proximity, and access woven into every interaction."
- ✅ 7 new topics added (`trust`, `web-of-trust`, `signet`, `dominion`, `nip-46`, `attestations`, `bunker`); 19 total. `ai` skipped — `ai-agent` covers it.
- ✅ Secret scanning + push protection enabled
- ✅ Dependabot vulnerability alerts + automated security fixes enabled
- ✅ Social preview image (1280×640) uploaded
- ✅ Wiki disabled
- ✅ Security policy enabled

### Tier 4b -- third-party distribution (still open)
1. **Submit to `registry.modelcontextprotocol.io`** — zero Nostr servers there; first-mover window still open. `server.json` already reconciled.
2. File awesome-mcp-servers PR (submission doc drafted at `docs/mcp-aggregator-submission.md`)
3. File awesome-nostr PR (drafted at `docs/awesome-nostr-pr.md`)
4. Submit to Context7 — paste GitHub URL at https://context7.com (uses `llms.txt` + `llms-full.txt` already in repo)
5. Publish launch post on forgesworn.dev ("Why we built bray"), link from README

### Tier 5 -- optional polish (small Test A lift)
11. Reorder README tagline to lead with concrete capabilities (dispatch, sovereign identity, DMs, payments) over the abstract "three dimensions of trust" framing
12. Add "Security model" README section summarising zeroisation, NIP-44, bunker tier, test count
13. Add download badge (`shields.io/npm/dm/nostr-bray`) and bundle-size badge
14. Reconcile `package.json` version with npm (semantic-release vs working copy confusion)

### Known discrepancies not blocking
- Tool count: llms.txt says 235, manifest yields 238 (relay-intelligence-tools adds extras). Minor; could align by adjusting the headline number to "~240 tools" or fixing the count.
- Promoted set size (48) is near the edge of what smaller models can juggle -- trimming to ~25 core promoted tools and relying on `search-actions` for the rest would reduce first-call tool-list thrash.
