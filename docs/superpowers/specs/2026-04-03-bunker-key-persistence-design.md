# Bunker Key Persistence

**Date:** 2026-04-03
**Status:** Approved

## Problem

NIP-46 bunker connections break across sessions because:

1. **Client side:** `BunkerContext.connect()` generates a new random client keypair every session when no `?secret=` is in the bunker URI. The bunker sees a brand new pubkey each time.
2. **Bunker side:** `startBunker()` holds `authorizedKeys` in memory only. Approvals are lost on process restart.

Result: users must re-approve the client on their bunker device every session.

## Solution

Persist state to `~/.config/bray/` using two JSON files, following bray's existing config directory convention.

### Client Key Persistence

**File:** `~/.config/bray/client-keys.json`
**Format:** `{ "<bunker-pubkey-hex>": "<client-secret-hex>" }`

**Flow change in `bunker-context.ts`:**

1. Parse bunker URI as today
2. If `?secret=` provided in URI, use it (no change)
3. Otherwise, check `client-keys.json` for an entry keyed by bunker pubkey
4. If found, reuse it. If not, generate a new key and persist it
5. Connect as normal

### Bunker Approval Persistence

**File:** `~/.config/bray/approved-clients.json`
**Format:** `{ "<bunker-pubkey-hex>": ["<client-pubkey-hex>", ...] }`

Keyed by the bunker's own pubkey so multiple bunker identities don't collide.

**Flow change in `bunker.ts`:**

1. At startup, load `approved-clients.json` and merge entries for this bunker's pubkey into `authorizedKeys`
2. When a client sends `connect` and passes the auth check (either no whitelist or already authorised), persist their pubkey to the file
3. First connection with no whitelist auto-approves and remembers. First connection with a whitelist only remembers keys already authorised.

### Shared Utility

**File:** `src/state.ts`

A small module with `readStateFile(name)` / `writeStateFile(name, data)` that handles:

- `~/.config/bray/` directory creation (if needed)
- JSON parse/stringify
- `0600` file permissions (owner-only read/write)

Both client and bunker sides use this module.

## Security

- State files get `0600` permissions (owner-only read/write)
- Client keys file contains secret material, same sensitivity as `?secret=` in bunker URIs
- Approved clients file only appends keys that already passed the auth gate
- No change to the zeroing behaviour in `BunkerContext.destroy()`

## Files Changed

- `src/state.ts` (new) -- shared state file read/write utility
- `src/bunker-context.ts` -- load/save client key via state module
- `src/bunker.ts` -- load/save approved client keys via state module
- `test/bunker-context.test.ts` -- test client key persistence
- `test/bunker.test.ts` -- test approval persistence
- `test/state.test.ts` (new) -- test state file utility
