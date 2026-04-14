# DM with NIP-05 lookup

Send a NIP-17 gift-wrapped DM to a recipient identified only by their NIP-05 address.

## 1. Verify the NIP-05 resolves

Optional — `dm-send` resolves NIP-05 itself, but verifying first gives a clearer failure if the record is missing.

```json
{
  "method": "tools/call",
  "params": {
    "name": "nip05-verify",
    "arguments": { "identifier": "alice@example.com" }
  }
}
```

Response:

```json
{ "valid": true, "pubkeyHex": "9e1c...", "npub": "npub1...", "relays": ["wss://..."] }
```

## 2. Send the DM

```json
{
  "method": "tools/call",
  "params": {
    "name": "dm-send",
    "arguments": {
      "to": "alice@example.com",
      "message": "Meeting at 3pm"
    }
  }
}
```

Response:

```json
{
  "recipientPubkey": "9e1c...",
  "transport": "nip-17",
  "published": {
    "success": true,
    "accepted": ["wss://relay.damus.io"],
    "rejected": []
  }
}
```

## Notes

- `to` accepts name, NIP-05, npub, or hex — universal identity resolution.
- NIP-17 (gift wrap) is the default. Pass `nip04: true` only if the recipient requires legacy DMs.
- bray fetches the recipient's NIP-65 relay list and writes to their preferred inbox — no `recipientRelay` hint needed in most cases.
