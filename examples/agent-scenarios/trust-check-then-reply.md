# Trust-check then reply

An unknown pubkey mentions you. Before replying, check whether they're trustworthy across verification, proximity, and access dimensions.

## 1. Read notifications with trust annotations

```json
{
  "method": "tools/call",
  "params": {
    "name": "social-notifications",
    "arguments": { "trust": "annotate", "limit": 20 }
  }
}
```

Each notification entry now carries a `trust` field:

```json
{
  "notifications": [{
    "id": "e42...",
    "pubkey": "c5d9...",
    "content": "@me what do you think?",
    "trust": {
      "level": "stranger",
      "tier": null,
      "distance": -1,
      "vaultTiers": [],
      "flags": []
    }
  }]
}
```

## 2. Score the sender in full

```json
{
  "method": "tools/call",
  "params": {
    "name": "trust-score",
    "arguments": { "pubkey": "c5d9...", "depth": 2 }
  }
}
```

Response:

```json
{
  "composite": { "level": "verified-stranger", "summary": "Signet-verified (tier 2) but outside follow graph" },
  "verification": { "tier": 2, "verifier": "npub1..." },
  "proximity": { "distance": -1, "mutualFollows": false },
  "access": { "vaultTiers": [] }
}
```

## 3. Reply with the trust context

```json
{
  "method": "tools/call",
  "params": {
    "name": "social-reply",
    "arguments": {
      "replyTo": "e42...",
      "content": "Thanks for the ping."
    }
  }
}
```

Response:

```json
{
  "id": "e55...",
  "publish": { "success": true },
  "trustWarning": null
}
```

If the sender had been `unknown` / `stranger`, `trustWarning` would have been populated — bray flags replies to untrusted authors so you can choose to abort.

## Notes

- `depth` controls how many hops to walk the follow graph (1–3). Each extra hop costs relay bandwidth.
- See [docs/trust-scoring.md](../../docs/trust-scoring.md) for the composite-level formula.
