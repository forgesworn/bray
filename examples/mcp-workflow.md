# MCP Workflow Examples

These examples show what an AI agent can do with nostr-bray via MCP tools.

## Identity Management

```
# See who I am
identity_list

# Create a work persona
identity_derive_persona({ name: "work" })

# Switch to it
identity_switch({ target: "work" })

# Set a profile
social_profile_set({ name: "Work Account", about: "Professional identity" })

# Post as work persona
social_post({ content: "Hello from my work identity!" })

# Switch back
identity_switch({ target: "master" })

# Prove the link without revealing how
identity_prove({ mode: "blind" })
```

## Social Interaction

```
# Post a note
social_post({ content: "gm nostr" })

# Reply to someone
social_reply({ content: "Great post!", replyTo: "<event-id>", replyToPubkey: "<hex>" })

# React
social_react({ eventId: "<event-id>", eventPubkey: "<hex>", reaction: "🤙" })

# Repost
social_repost({ eventId: "<event-id>", eventPubkey: "<hex>" })

# Check notifications
social_notifications({ limit: 20 })

# Read feed
social_feed({ limit: 10 })
```

## Encrypted DMs

```
# Send a NIP-17 gift-wrapped DM (default, most private)
dm_send({ recipientPubkeyHex: "<hex>", message: "Secret message" })

# Read DMs
dm_read()
```

## Contacts

```
# See who someone follows
contacts_get({ pubkeyHex: "<hex>" })

# Follow someone
contacts_follow({ pubkeyHex: "<hex>", petname: "alice" })

# Unfollow
contacts_unfollow({ pubkeyHex: "<hex>" })
```

## Trust & Attestations

```
# Create an attestation
trust_attest({ type: "identity-verification", subject: "<hex>", summary: "Verified in person" })

# Read attestations about someone
trust_read({ subject: "<hex>" })

# Anonymous group membership proof
trust_ring_prove({
  ring: ["<pk1>", "<pk2>", "<your-pk>", "<pk3>"],
  attestationType: "kyc-verified"
})
```

## Lightning Payments (NWC)

```
# Check wallet
zap_balance()

# Pay an invoice
zap_send({ invoice: "lnbc10u1..." })

# Create an invoice
zap_make_invoice({ amountMsats: 100000, description: "Coffee" })

# Check receipts
zap_receipts({ limit: 5 })
```

## Media (Blossom)

```
# Upload a file
blossom_upload({ server: "https://blossom.example.com", filePath: "/path/to/image.png" })

# List your uploads
blossom_list({ server: "https://blossom.example.com", pubkeyHex: "<hex>" })
```

## Groups (NIP-29)

```
# Check group info
group_info({ relay: "wss://groups.relay.com", groupId: "my-group" })

# Read chat
group_chat({ groupId: "my-group", limit: 20 })

# Send a message
group_send({ groupId: "my-group", content: "Hello group!" })
```

## Utility

```
# Decode any nip19 entity
decode({ input: "npub1..." })

# Encode a pubkey
encode_npub({ hex: "<64-char-hex>" })

# Verify an event
verify_event({ event: { ... } })

# Browse NIPs
nip_list()
nip_show({ number: 17 })

# Encrypt for someone
nip44_encrypt({ recipientPubkeyHex: "<hex>", plaintext: "secret" })
```
