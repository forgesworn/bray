# Per-Identity NWC Wallet Configuration

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Allow each derived identity/persona to have its own NWC wallet

## Problem

bray has a single global `NWC_URI` env var. All identities share one wallet. This means:
- No wallet isolation between personas
- Cannot demo zaps between two identities
- Cannot fund an easter-egg wallet tied to a specific demo identity

## Design

### Wallets file

`~/.nostr/bray-wallets.json` (overridable via `BRAY_WALLETS_FILE` env var):

```json
{
  "wallets": {
    "<hex-pubkey>": "nostr+walletconnect://...",
    "<hex-pubkey>": "nostr+walletconnect://..."
  }
}
```

File permissions: `0600` on creation. Created lazily on first `zap-wallet-set` call.

### NWC URI resolution order

When any zap tool fires:
1. Per-identity wallet (active identity's hex pubkey looked up in wallets map)
2. Global `NWC_URI` env var (fallback for identities without a per-identity wallet)
3. Error: "No wallet configured for this identity"

### New tools

**`zap-wallet-set`** - Set NWC URI for the active identity
- Input: `{ nwcUri: string }`
- Validates the URI format (must parse as nostr+walletconnect://)
- Writes to wallets JSON file
- Returns confirmation with the identity's npub

**`zap-wallet-clear`** - Remove wallet for the active identity
- No input
- Removes the pubkey entry from the JSON file
- Returns confirmation

### File changes

| File | Change |
|------|--------|
| `src/zap/handlers.ts` | Add `loadWallets`, `saveWallets`, `resolveNwcUri` functions |
| `src/zap/tools.ts` | Add `zap-wallet-set`/`zap-wallet-clear`. Resolve NWC via `resolveNwcUri` instead of `deps.nwcUri` |
| `src/index.ts` | Pass `walletsFile` + `globalNwcUri` in deps instead of raw `nwcUri` |
| `src/config.ts` | Add `walletsFile` config (default `~/.nostr/bray-wallets.json`) |
| `src/types.ts` | Add `walletsFile` to BrayConfig |
| `src/marketplace/tools.ts` | Same resolution change for marketplace-pay |
| `src/cli.ts` | Same resolution change for CLI zap commands |

### Security

- Wallets file stores NWC URIs containing wallet secrets. File created with `0600` permissions.
- NWC secret strings zeroised after parsing, matching existing pattern in handlers.ts.
- `zap-wallet-set` validates URI format before persisting.

## Follow-up

After implementation:
- Update CLAUDE.md with new tools and config
- Update site/index.html tool count
- Set up demo phoenixd wallets on Hetzner
- Re-record zap GIF demos with real wallets
