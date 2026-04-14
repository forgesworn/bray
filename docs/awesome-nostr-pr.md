# awesome-nostr PR — nostr-bray entry

Target repo: https://github.com/aljazceru/awesome-nostr

## Where to add

In the **Tools** or **Libraries & Frameworks** section. If there is an "MCP / AI Agents" subsection, use that.
If not, propose adding one:

```markdown
### MCP Servers / AI Agents

- [nostr-bray](https://github.com/forgesworn/bray) — Trust-aware Nostr MCP server. 238 tools for identity, social, DMs, trust scoring, AI-to-AI dispatch, Lightning payments, privacy proofs, and media. Model-agnostic.
```

If no AI/MCP section exists, add to **Tools**:

```markdown
- [nostr-bray](https://github.com/forgesworn/bray) — MCP server giving AI agents sovereign Nostr identities. 238 tools, 27 groups. Trust-scored feeds, NIP-46 bunker auth, AI-to-AI dispatch, ring signatures, zero-knowledge proofs, and L402 marketplace. `npx nostr-bray`.
```

## PR title

```
feat: add nostr-bray MCP server (238 tools, trust-aware, AI-to-AI dispatch)
```

## PR body

```markdown
Adds nostr-bray to the tools list.

**What it is:** An MCP (Model Context Protocol) server that gives AI agents sovereign Nostr identities. Works with Claude, ChatGPT, Gemini, Cursor, or any MCP client.

**Why it's notable:**
- 238 tools across 27 groups — by far the most comprehensive Nostr MCP server
- Trust-aware by default: feeds and DMs score and filter untrusted content automatically
- NIP-46 bunker auth: key never leaves the signing device
- AI-to-AI dispatch protocol: agents send and receive structured tasks over encrypted NIP-17 DMs
- Ring signatures for anonymous group membership proofs (SAG + LSAG)
- Zero-knowledge range proofs (age, income, balance) via Pedersen commitments
- L402/x402 marketplace discovery and payment
- CANARY coercion-resistance with duress detection
- Shamir Secret Sharing backup (BIP-39 word shards)

**npm:** https://www.npmjs.com/package/nostr-bray (44 published versions, 1.27.4 latest)
**GitHub:** https://github.com/forgesworn/bray
**Homepage:** https://bray.forgesworn.dev
**Licence:** MIT
```

## Notes

- Check awesome-nostr's contribution guidelines before submitting
- If they require a minimum star count, note that the project is 2 weeks old (2026-03-24)
- The `nostr-compass` newsletter (#12, 2026-03-04) covered Nostr AI tooling — could be a reference for the PR
