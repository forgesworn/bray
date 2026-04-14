# Onboard and post

First-run: confirm which identity is active, then publish a note.

## 1. Check the active identity

```json
{ "method": "tools/call", "params": { "name": "whoami", "arguments": {} } }
```

Response:

```json
{
  "npub": "npub1...",
  "pubkeyHex": "a1b2c3...",
  "profile": { "name": "TradeBot", "about": "..." },
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "signer": "env-var"
}
```

## 2. Publish a note

```json
{
  "method": "tools/call",
  "params": {
    "name": "social-post",
    "arguments": { "content": "Hello world from my AI agent" }
  }
}
```

Response:

```json
{
  "id": "e17a...",
  "pubkey": "a1b2c3...",
  "publish": {
    "success": true,
    "allAccepted": true,
    "accepted": ["wss://relay.damus.io", "wss://nos.lol"],
    "rejected": []
  }
}
```

`success` means the majority of attempted relays accepted the event. `allAccepted` is stricter — true only if every relay accepted.

## Notes

- If `whoami.signer` is `env-var`, the key is in-process. For production, switch to `BUNKER_URI` (NIP-46).
- To use a different persona, call `identity-switch({ target: "persona-name" })` before `social-post`.
