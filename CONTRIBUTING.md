# Contributing to nostr-bray

## Setup

```bash
git clone git@github.com:forgesworn/bray.git
cd bray
npm install
npm run build
npm test
```

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run lint           # Type-check without emitting
```

## Architecture

```
src/
  cli.ts               CLI entry point (subcommand parser)
  index.ts             MCP server entry point (config → context → tools → transport)
  config.ts            Environment variable + file-based secret loading
  context.ts           IdentityContext — LRU cache, derive, switch, sign, zeroise
  relay-pool.ts        Relay connections (SOCKS5h, write queue, Tor policy)
  nip65.ts             NIP-65 relay list fetch with signature verification
  validation.ts        Shared Zod validators (hexId, relayUrl)
  types.ts             Shared TypeScript types
  identity/            Identity tools — derive, prove, shamir, migration
  social/              Social tools — post, reply, DM, blossom media, groups, community NIPs, notifications, feed, contacts
  trust/               Trust tools — attestations, ring sigs, spoken tokens
  relay/               Relay tools — list, set, add, NIP-11 info
  zap/                 Zap tools — NWC wallet (NIP-47), receipts, decode
  safety/              Safety tools — duress persona configure/activate
  util/                Utility tools — decode, encode, verify, encrypt, filter, NIP browse, fetch
```

**Pattern:** Each tool group has `handlers.ts` (pure logic) and `tools.ts` (MCP registration with Zod schemas). Tests mirror this structure under `test/`.

## Conventions

- **British English** — colour, initialise, behaviour, licence
- **ESM only** — `"type": "module"` in package.json
- **Commit messages** — `type: description` (e.g. `feat:`, `fix:`, `test:`, `docs:`)
- **No Co-Authored-By** lines in commits
- **Branch workflow** — work on branches, merge to main when complete (semantic-release auto-publishes)

## Testing

Tests use [Vitest](https://vitest.dev/). Each handler file has a corresponding test file. Integration tests live in `test/integration/` and `test/zap/nwc-round-trip.test.ts`.

When adding a new tool:
1. Write failing tests in `test/<group>/handlers.test.ts`
2. Implement the handler in `src/<group>/handlers.ts`
3. Register the tool in `src/<group>/tools.ts` with Zod input schema
4. Add the registration call in `src/index.ts`
5. Verify: `npm run build && npm test`

## Security

This project handles private keys and wallet secrets. When contributing:

- Never log or return private key material in tool responses
- Zeroise `Buffer`/`Uint8Array` containing secrets in `finally` blocks
- Validate all external input (relay URLs, hex pubkeys) via `src/validation.ts`
- Use `verifyEvent()` before trusting Nostr events from relays
- See `SECURITY.md` for the full security model
