# MCP Workflow Examples

These examples show what an AI agent can do with nostr-bray via MCP tools.

## Identity Management

```
# See who I am
identity-list

# Create a work persona
identity-derive-persona({ name: "work" })

# Switch to it
identity-switch({ target: "work" })

# Set a profile
social-profile-set({ name: "Work Account", about: "Professional identity" })

# Post as work persona
social-post({ content: "Hello from my work identity!" })

# Switch back
identity-switch({ target: "master" })

# Prove the link without revealing how
identity-prove({ mode: "blind" })
```

## Social Interaction

```
# Post a note
social-post({ content: "gm nostr" })

# Reply to someone
social-reply({ content: "Great post!", replyTo: "<event-id>", replyToPubkey: "<hex>" })

# React
social-react({ eventId: "<event-id>", eventPubkey: "<hex>", reaction: "🤙" })

# Repost
social-repost({ eventId: "<event-id>", eventPubkey: "<hex>" })

# Check notifications
social-notifications({ limit: 20 })

# Read feed
social-feed({ limit: 10 })
```

## Encrypted DMs

```
# Send a NIP-17 gift-wrapped DM (default, most private)
dm-send({ to: "<npub-or-hex-or-nip05>", message: "Secret message" })

# Read DMs
dm-read()
```

## Contacts

```
# See who someone follows
contacts-get({ pubkeyHex: "<hex>" })

# Follow someone
contacts-follow({ pubkeyHex: "<hex>", petname: "alice" })

# Unfollow
contacts-unfollow({ pubkeyHex: "<hex>" })
```

## Trust & Attestations

```
# Create an attestation
trust-attest({ type: "identity-verification", subject: "<hex>", summary: "Verified in person" })

# Read attestations about someone
trust-read({ subject: "<hex>" })

# Anonymous group membership proof
trust-ring-prove({
  ring: ["<pk1>", "<pk2>", "<your-pk>", "<pk3>"],
  attestationType: "kyc-verified"
})
```

## Lightning Payments (NWC)

```
# Check wallet
zap-balance()

# Pay an invoice
zap-send({ invoice: "lnbc10u1..." })

# Create an invoice
zap-make-invoice({ amountMsats: 100000, description: "Coffee" })

# Check receipts
zap-receipts({ limit: 5 })
```

## Media (Blossom)

```
# Upload a file
blossom-upload({ server: "https://blossom.example.com", filePath: "/path/to/image.png" })

# List your uploads
blossom-list({ server: "https://blossom.example.com", pubkeyHex: "<hex>" })
```

## Groups (NIP-29)

```
# Check group info
group-info({ relay: "wss://groups.relay.com", groupId: "my-group" })

# Read chat
group-chat({ groupId: "my-group", limit: 20 })

# Send a message
group-send({ groupId: "my-group", content: "Hello group!" })
```

## Utility

```
# Decode any nip19 entity
decode({ input: "npub1..." })

# Encode a pubkey
encode-npub({ hex: "<64-char-hex>" })

# Verify an event
verify-event({ event: { ... } })

# Browse NIPs
nip-list()
nip-show({ number: 17 })

# Encrypt for someone
nip44-encrypt({ recipientPubkeyHex: "<hex>", plaintext: "secret" })
```
