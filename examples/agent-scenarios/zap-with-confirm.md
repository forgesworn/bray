# Zap with preview-then-confirm

Preview a Lightning invoice before paying it. Real sats — bray enforces a two-step flow so agents can't one-shot a payment by mistake.

## 1. Preview (confirm omitted or false)

```json
{
  "method": "tools/call",
  "params": {
    "name": "zap-send",
    "arguments": { "invoice": "lnbc100n1p..." }
  }
}
```

Response:

```json
{
  "preview": true,
  "amountMsat": 10000,
  "amountSat": 10,
  "description": "Coffee",
  "paymentHash": "abc...",
  "expiresAt": 1766400000,
  "hint": "Re-send with confirm: true to pay"
}
```

## 2. Confirm

```json
{
  "method": "tools/call",
  "params": {
    "name": "zap-send",
    "arguments": { "invoice": "lnbc100n1p...", "confirm": true }
  }
}
```

Response:

```json
{
  "preview": false,
  "paymentHash": "abc...",
  "preimage": "def...",
  "amountSat": 10,
  "feesPaidSat": 0
}
```

## Notes

- Default `confirm: false` is a safety guard — preview is always free.
- Wallet is the active identity's NWC connection (`zap-wallet-set` to attach).
- Balance check: `zap-balance`. Invoice decode without paying: `zap-decode`.
