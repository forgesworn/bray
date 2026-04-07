# MCP Registry Submissions -- ForgeSworn Servers

Three MCP servers, five registries. Copy-paste ready.

Updated: 2026-04-07

---

## Table of Contents

- [nostr-bray](#nostr-bray)
- [402-mcp](#402-mcp)
- [rendezvous-mcp](#rendezvous-mcp)
- [Status Tracking](#status-tracking)

---

## nostr-bray

**Package:** `nostr-bray` | **npm:** `npx nostr-bray` | **GitHub:** https://github.com/forgesworn/bray
**npm page:** https://www.npmjs.com/package/nostr-bray

### Glama (https://glama.ai/mcp/servers/submit)

- **Name:** nostr-bray
- **Repository:** https://github.com/forgesworn/bray
- **Install:** `npx nostr-bray`
- **Category:** Communication / Identity
- **Description:**

> Trust-aware Nostr MCP server for AI agents and humans. 235 tools across 27 groups covering identity, social, direct messages, trust attestations, encrypted dispatch (AI-to-AI collaboration), Lightning zaps, privacy proofs, ring signatures, blossom media, and more. Model-agnostic -- works with Claude, ChatGPT, Gemini, Cursor, or any MCP client. Three dimensions of trust (verification, proximity, access) woven into every interaction. Supports NIP-46 bunker auth so keys never leave a dedicated signing device.

### mcp.so (https://mcp.so)

- **Name:** nostr-bray
- **GitHub:** https://github.com/forgesworn/bray
- **npm:** https://www.npmjs.com/package/nostr-bray
- **Tags:** nostr, identity, trust, lightning, ai-agent, mcp-server, web-of-trust, privacy
- **Description:**

> Trust-aware Nostr MCP server. 235 tools for identity, social posting, encrypted DMs, trust scoring, AI-to-AI dispatch, Lightning zaps, ring signatures, zero-knowledge proofs, and marketplace discovery. Covers 30 NIPs. Model-agnostic.

### mcphub.tools (https://mcphub.tools/submit)

- **Name:** nostr-bray
- **Install:** `npx nostr-bray`
- **Category:** Communication / Social
- **Description:**

> Nostr MCP server with 235 tools across 27 groups. Trust-scored feeds, NIP-46 bunker auth, AI-to-AI dispatch over encrypted DMs, ring signatures, zero-knowledge age/income proofs, L402 marketplace, and CANARY duress detection. The most comprehensive Nostr toolkit for AI agents.

### awesome-mcp-servers (https://github.com/punkpeye/awesome-mcp-servers)

Add to the **Communication** or **Social** section:

```markdown
- [nostr-bray](https://github.com/forgesworn/bray) - Trust-aware Nostr MCP server. 235 tools covering identity, social, DMs, trust scoring, AI-to-AI dispatch, Lightning zaps, ring signatures, and privacy proofs. `npx nostr-bray`
```

### awesome-nostr (https://github.com/aljazceru/awesome-nostr)

If an "MCP Servers / AI Agents" section exists, add there. Otherwise add to **Tools**:

```markdown
- [nostr-bray](https://github.com/forgesworn/bray) - MCP server giving AI agents sovereign Nostr identities. 235 tools, 30 NIPs. Trust-scored feeds, NIP-46 bunker auth, AI-to-AI dispatch, ring signatures, zero-knowledge proofs, and L402 marketplace. `npx nostr-bray`
```

**PR title:**
```
feat: add nostr-bray MCP server (235 tools, trust-aware, AI-to-AI dispatch)
```

**PR body:**
```markdown
Adds nostr-bray to the tools list.

**What it is:** An MCP (Model Context Protocol) server that gives AI agents sovereign Nostr identities. Works with Claude, ChatGPT, Gemini, Cursor, or any MCP client.

**Why it's notable:**
- 235 tools across 27 groups -- the most comprehensive Nostr MCP server
- Trust-aware by default: feeds and DMs score and filter untrusted content
- Covers 30 NIPs (NIP-01, 02, 05, 09, 11, 17, 19, 23, 29, 32, 40, 42, 44, 45, 46, 49, 50, 51, 52, 54, 57, 58, 65, 72, 78, 85, 89, 96, 99, A7, VA)
- NIP-46 bunker auth: key never leaves the signing device
- AI-to-AI dispatch: agents send and receive tasks over encrypted NIP-17 DMs
- Ring signatures (SAG + LSAG) for anonymous group membership
- Zero-knowledge range proofs (age, income, balance) via Pedersen commitments
- L402 marketplace discovery and payment
- CANARY coercion-resistance with duress detection

**npm:** https://www.npmjs.com/package/nostr-bray
**GitHub:** https://github.com/forgesworn/bray
**Licence:** MIT
```

### Differentiator copy (for free-text fields)

> Most Nostr MCP servers offer 5-15 tools for basic posting. nostr-bray provides 235 tools with trust-aware defaults: feeds filter out untrusted content automatically, DMs annotate sender trust scores, and reply tools warn about unknown authors. Unique capabilities include AI-to-AI dispatch over encrypted Nostr DMs, zero-knowledge age/income proofs, ring signatures for anonymous group membership, CANARY duress detection, and an L402 marketplace. Supports NIP-46 bunker auth so keys never leave a dedicated signing device.

---

## 402-mcp

**Package:** `402-mcp` | **npm:** `npx 402-mcp` | **GitHub:** https://github.com/forgesworn/402-mcp
**npm page:** https://www.npmjs.com/package/402-mcp

### Glama (https://glama.ai/mcp/servers/submit)

- **Name:** 402-mcp
- **Repository:** https://github.com/forgesworn/402-mcp
- **Install:** `npx 402-mcp`
- **Category:** Finance / Payments
- **Description:**

> L402 + x402 client MCP that gives AI agents economic agency. Discover, pay for, and consume any payment-gated API -- no human registration, no API keys, no middlemen. Multi-wallet support (NWC Lightning, Cashu ecash, human QR fallback). Handles four HTTP 402 challenge variants: L402, IETF Payment, xCashu (NUT-18), and x402. Credentials encrypted at rest (AES-256-GCM). Safety caps on autonomous spend. Works with any L402 server -- not locked to a single vendor.

### mcp.so (https://mcp.so)

- **Name:** 402-mcp
- **GitHub:** https://github.com/forgesworn/402-mcp
- **npm:** https://www.npmjs.com/package/402-mcp
- **Tags:** l402, payments, lightning, bitcoin, cashu, micropayments, ai-agent, mcp-server
- **Description:**

> L402/x402 client MCP for AI agents. Discover paid APIs on Nostr, auto-pay with Lightning (NWC) or Cashu ecash, consume any payment-gated API. Multi-protocol (L402, x402, IETF Payment, xCashu). Encrypted credential storage. No Lightning node required.

### mcphub.tools (https://mcphub.tools/submit)

- **Name:** 402-mcp
- **Install:** `npx 402-mcp`
- **Category:** Finance / Payments
- **Description:**

> AI agents discover, pay for, and consume Lightning-gated APIs. 10 tools covering L402 discovery, autonomous Lightning and Cashu payments, credential caching, and volume discount purchasing. Supports L402, x402, IETF Payment, and xCashu protocols. Encrypted credential store, per-payment spend caps, rolling rate limits.

### awesome-mcp-servers (https://github.com/punkpeye/awesome-mcp-servers)

Add to the **Finance** or **Payments** section:

```markdown
- [402-mcp](https://github.com/forgesworn/402-mcp) - L402/x402 payment client for AI agents. Discover, pay for, and consume Lightning-gated APIs with NWC, Cashu, or human QR fallback. `npx 402-mcp`
```

### Differentiator copy (for free-text fields)

> The only MCP server that gives AI agents autonomous economic agency across multiple payment protocols. While Lightning Labs' agent tools require running a full LND node, 402-mcp connects to any NWC wallet with no infrastructure. Supports four HTTP 402 variants (L402, IETF Payment, xCashu, x402), discovers services on Nostr relays, and encrypts all credentials at rest. Safety-first: per-payment caps, rolling spend limits, SSRF protection.

---

## rendezvous-mcp

**Package:** `rendezvous-mcp` | **npm:** `npx rendezvous-mcp` | **GitHub:** https://github.com/forgesworn/rendezvous-mcp
**npm page:** https://www.npmjs.com/package/rendezvous-mcp

### Glama (https://glama.ai/mcp/servers/submit)

- **Name:** rendezvous-mcp
- **Repository:** https://github.com/forgesworn/rendezvous-mcp
- **Install:** `npx rendezvous-mcp`
- **Category:** Maps / Location / Travel
- **Description:**

> Fair meeting point discovery for AI agents. Uses isochrone-based travel time fairness, not naive geographic midpoints. 5 tools: score candidate venues by fairness for 2-10 participants, search OpenStreetMap for venues, compute reachability polygons, get turn-by-turn directions. Works out of the box with free public routing -- no API keys needed. Self-host Valhalla for unlimited queries.

### mcp.so (https://mcp.so)

- **Name:** rendezvous-mcp
- **GitHub:** https://github.com/forgesworn/rendezvous-mcp
- **npm:** https://www.npmjs.com/package/rendezvous-mcp
- **Tags:** maps, location, routing, meeting-point, fairness, isochrone, openstreetmap, geospatial
- **Description:**

> Fair meeting point MCP for AI agents. Score venues by travel time fairness for 2-10 participants using isochrone intersection, not naive midpoints. OSM venue search, turn-by-turn directions, reachability polygons. No API keys needed.

### mcphub.tools (https://mcphub.tools/submit)

- **Name:** rendezvous-mcp
- **Install:** `npx rendezvous-mcp`
- **Category:** Maps / Location
- **Description:**

> AI-driven fair meeting point discovery. Score candidate venues by travel time fairness using isochrone intersection for 2-10 participants. Search OpenStreetMap for venues, compute reachability polygons, get directions. Free public routing out of the box, self-host Valhalla for unlimited queries.

### awesome-mcp-servers (https://github.com/punkpeye/awesome-mcp-servers)

Add to the **Location / Maps** or **Travel** section:

```markdown
- [rendezvous-mcp](https://github.com/forgesworn/rendezvous-mcp) - Fair meeting point discovery using isochrone-based travel time fairness, OSM venue search, and turn-by-turn directions. `npx rendezvous-mcp`
```

### Differentiator copy (for free-text fields)

> The only MCP server for location fairness. Other mapping tools find the geographic midpoint; rendezvous-mcp computes actual travel time isochrones and scores venues by how fairly the journey is distributed across all participants. Supports driving, cycling, walking, and public transport. Free to use out of the box with public routing, or self-host Valhalla for unlimited queries.

---

## Status Tracking

### nostr-bray

| Registry | Submitted | Listed | Date | Notes |
|----------|-----------|--------|------|-------|
| Glama | - | - | | |
| mcp.so | - | - | | |
| mcphub.tools | - | - | | |
| awesome-mcp-servers | - | - | | PR to punkpeye/awesome-mcp-servers |
| awesome-nostr | - | - | | PR to aljazceru/awesome-nostr |

### 402-mcp

| Registry | Submitted | Listed | Date | Notes |
|----------|-----------|--------|------|-------|
| Glama | - | - | | |
| mcp.so | - | - | | |
| mcphub.tools | - | - | | |
| awesome-mcp-servers | - | - | | PR to punkpeye/awesome-mcp-servers |

### rendezvous-mcp

| Registry | Submitted | Listed | Date | Notes |
|----------|-----------|--------|------|-------|
| Glama | - | - | | |
| mcp.so | - | - | | |
| mcphub.tools | - | - | | |
| awesome-mcp-servers | - | - | | PR to punkpeye/awesome-mcp-servers |

---

## Submission order

1. **awesome-mcp-servers** first -- highest SEO value, all three servers in one PR or three separate PRs
2. **Glama** -- web form, quick submission, good LLM visibility
3. **mcp.so** -- web form or GitHub PR
4. **mcphub.tools** -- web form
5. **awesome-nostr** -- bray only, separate PR

For awesome-mcp-servers, consider one PR per server to keep reviews simple.
