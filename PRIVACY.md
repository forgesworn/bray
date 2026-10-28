# Privacy

bray is software you run yourself, on your own machine. Its maintainers run no service for it, and it sends no telemetry, analytics or crash reports anywhere.

## Who sees your traffic

bray talks only to the places you or your AI client point it at, and each of them sees what bray sends it:

- **Nostr relays**: the relays in `NOSTR_RELAYS`, plus relays named in the relay lists (NIP-65) of the accounts you read. They see your queries, any events you publish, and your IP address unless you use `TOR_PROXY`.
- **Your signer**: with `BUNKER_URI`, the NIP-46 signer you chose sees each event bray asks it to sign.
- **Your wallet**: with `NWC_URI_FILE`, the Nostr Wallet Connect wallet you chose sees each payment request.
- **Other servers bray looks things up on**, when a tool needs them: NIP-05 domains, relay information documents (NIP-11), Blossom media servers, Lightning address servers for zaps, HTTP endpoints you ask it to call or pay, and GitHub, which serves the NIP texts behind `nip-list` and `nip-show`.

## What stays on your machine

Configuration, a saved bunker URI, scheduled posts, wallet connections and other state live in bray's state directory (by default `~/.config/bray`) and in the files you point it at. bray does not upload them. Secret environment variables are removed from the process once read.

## Read-only mode

With no key or bunker configured, bray runs read-only: it holds no secret and no wallet, and it only reads from relays and the servers above.

## Your AI client

bray returns tool results to the AI client that runs it. What that client, its model provider or any marketplace does with them is governed by their terms, not this document.

## Questions

Open an issue at https://github.com/forgesworn/bray/issues. For security problems, see [SECURITY.md](SECURITY.md).
