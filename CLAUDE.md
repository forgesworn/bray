# CLAUDE.md — nostr-bray

MCP server giving AI agents sovereign Nostr identities. 90 tools across 11 groups.

## Commands

- `npm run build` — compile TypeScript to dist/
- `npm test` — run all tests (vitest, 329 tests)
- `npm run test:watch` — watch mode
- `npm run lint` — type-check without emitting (`tsc --noEmit`)
- `npm start` — run the MCP server (requires NOSTR_SECRET_KEY + NOSTR_RELAYS)
- `node dist/cli.js --help` — CLI help

## Architecture

Single-process MCP server. Entry points:
- `src/index.ts` — MCP server (config → IdentityContext → RelayPool → tool registration → transport)
- `src/cli.ts` — CLI wrapper (same handlers, no MCP)

**Central spine:** `IdentityContext` in `src/context.ts` manages the nsec-tree root, LRU identity cache with cryptographic zeroing, and signing. `TrustContext` in `src/trust-context.ts` aggregates trust signals across verification (Signet), proximity (WoT), and access (Dominion) dimensions.

**Handler extraction pattern:** Each tool group has:
- `src/<group>/handlers.ts` — pure logic functions (testable without MCP)
- `src/<group>/tools.ts` — Zod schemas + `server.registerTool()` wiring
- `test/<group>/handlers.test.ts` — unit tests for handlers

Tool groups: `identity/`, `social/` (includes blossom, dm, groups, nips, notifications), `trust/`, `relay/`, `zap/`, `safety/`, `signet/`, `vault/`, `util/`, `workflow/` (trust-score, feed-discover, verify-person, identity-setup, identity-recover, relay-health)

**Shared modules:**
- `src/config.ts` — env var + file secret loading, format detection
- `src/relay-pool.ts` — relay connections with SOCKS5h proxy, write queue, Tor policy
- `src/nip65.ts` — NIP-65 relay list fetch with signature verification + TTL cache
- `src/validation.ts` — Zod validators (`hexId`, `relayUrl`)

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `nostr-tools` — Nostr event creation, signing, NIP-17/44/04 encryption
- `nsec-tree` — hierarchical identity derivation from master secret
- `@forgesworn/ring-sig` — SAG ring signatures on secp256k1
- `@forgesworn/shamir-words` — Shamir Secret Sharing with BIP-39 output
- `nostr-attestations` — NIP-VA kind 31000 attestation builders/validators
- `spoken-token` — HMAC-based spoken verification tokens
- `canary-kit` — duress detection (imported via spoken-token)
- `signet-protocol` — identity verification protocol (Signet badge and credential types)
- `dominion-protocol` — epoch-based encrypted access control (Shamir, HKDF vault keys)

## Conventions

- **British English** everywhere
- **Git:** `type: description` commits. No `Co-Authored-By` lines.
- **Branch:** work on branches, merge to main. semantic-release auto-publishes on main.
- **Security:** never return private keys in tool responses. Zeroise buffers in `finally` blocks. Validate all external input.

## Security-Critical Paths

Be extra careful when modifying:
- `src/context.ts` — key material lifecycle, zeroise on eviction/destroy
- `src/zap/handlers.ts` — NWC secret handling, NIP-44 encrypt/decrypt
- `src/config.ts` — secret loading and env var cleanup
- `src/relay-pool.ts` — Tor policy enforcement
- `src/nip65.ts` — event signature verification
- `src/index.ts` — HTTP auth, rate limiting, body size limits
- `src/trust-context.ts` — trust signal aggregation across verification, proximity, and access dimensions
- `src/signet/` — Signet badge fetching, credential validation, policy enforcement
- `src/vault/` — Dominion vault key derivation, epoch rotation, access tier management
