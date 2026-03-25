# AGENTS.md — nostr-bray

Generic AI agent instructions. For Claude Code see `CLAUDE.md`, for Cursor see `.cursorrules`.

## What this is

MCP server + CLI giving AI agents sovereign Nostr identities. 78 tools, 10 groups.

## Build & Test

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # 329 tests via vitest
npm run lint     # tsc --noEmit
```

## Architecture

```
src/
  index.ts          MCP server entry point
  cli.ts            CLI entry point (78 subcommands + shell REPL)
  context.ts        IdentityContext — master key, LRU cache, derive, sign, zeroise
  config.ts         Secret loading from env/files, format detection
  relay-pool.ts     Relay connections, SOCKS5h proxy, Tor policy, write queue
  nip65.ts          NIP-65 relay list (signature-verified, TTL cache)
  validation.ts     Shared Zod validators (hexId, relayUrl, validatePublicUrl)
  format.ts         Human-readable CLI formatters
  help.ts           Per-command help with examples
  tool-response.ts  MCP output format helper (json/human)
  identity/         Identity tools (derive, prove, shamir, migration)
  social/           Social tools (post, reply, DM, blossom, groups, NIPs, contacts)
  trust/            Trust tools (attestations, ring sigs, spoken tokens)
  relay/            Relay tools (list, set, add, NIP-11 info)
  zap/              Zap tools (NWC wallet via NIP-47)
  safety/           Safety tools (duress persona)
  util/             Utility tools (decode, encode, verify, encrypt, filter, NIP browse)
```

## Handler pattern

Each tool group: `handlers.ts` (pure logic) + `tools.ts` (Zod schemas + MCP registration).
Tests mirror at `test/<group>/handlers.test.ts`.

## Conventions

- British English
- ESM only, TypeScript strict
- Commits: `type: description` — no Co-Authored-By
- Security: never return private keys in tool responses, zeroise buffers in finally blocks
- Use `ctx.activePublicKeyHex` (not `ctx.activeNpub`) in relay filter fields

## Key dependencies

nostr-tools, nsec-tree, @forgesworn/ring-sig, @forgesworn/shamir-words, nostr-attestations, spoken-token, canary-kit, zod
