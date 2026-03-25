# nostr-bray Usage Guide

This guide walks through the key workflows. All examples use the CLI, but every operation maps 1:1 to an MCP tool.

## Setup

Create a secret key file (recommended over environment variables):

```bash
# Generate a fresh key
node -e "
import { generateSecretKey } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
console.log(nsecEncode(generateSecretKey()));
" > ~/.bray/secret.key
chmod 600 ~/.bray/secret.key
```

Set your relays:

```bash
export NOSTR_SECRET_KEY_FILE=~/.bray/secret.key
export NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol"
```

Verify it works:

```bash
npx nostr-bray whoami
# npub1abc...
```

## Identity Management

### Deriving Personas

Your master secret generates unlimited child identities. Each has its own key pair — cryptographically unlinkable to the master unless you publish a proof.

```bash
# Derive named personas
npx nostr-bray persona work
npx nostr-bray persona personal
npx nostr-bray persona anonymous

# Derive by purpose and index
npx nostr-bray derive signing 0
npx nostr-bray derive messaging 0

# List everything
npx nostr-bray list
```

### Switching Identities

Every tool operates as the "active identity." The CLI doesn't maintain state between invocations, but the MCP server does:

```
identity-switch("work")         → all subsequent tools sign as work persona
social-post("Hello from work!") → signed by work's npub
identity-switch("master")       → back to master
```

### Linkage Proofs

Prove two identities share the same master without revealing the derivation path:

```bash
# Blind proof — proves link, hides how the child was derived
npx nostr-bray prove blind

# Full proof — reveals purpose string and index (use with care)
npx nostr-bray prove full
```

### Key Backup with Shamir

Split your master key into shards. Any 3 of 5 can reconstruct it:

```bash
mkdir -p ~/.bray/shards
npx nostr-bray backup ~/.bray/shards 3 5
```

Shard files are written with 0o600 permissions. Each contains BIP-39 words — readable over the phone, writable on paper.

## Social

### Posting and Replying

Via MCP tools:

```
social-post({ content: "Hello Nostr!" })
social-reply({ content: "Great post!", replyTo: "<event-id>", replyToPubkey: "<hex>" })
social-react({ eventId: "<event-id>", eventPubkey: "<hex>", reaction: "🤙" })
```

Via CLI:

```bash
npx nostr-bray post "Hello Nostr!"
```

### Profile Management

The profile set tool has a safety guard — it warns you if a profile already exists and shows a diff before overwriting:

```
social-profile-set({ name: "My Agent", about: "Powered by nostr-bray" })
# → Warning: Profile already exists. Set confirm: true to overwrite.

social-profile-set({ name: "My Agent", about: "Updated bio", confirm: true })
# → Published
```

### Direct Messages

NIP-17 gift-wrapped DMs are the default — the sender's identity is hidden behind an ephemeral key:

```
dm-send({ recipientPubkeyHex: "<hex>", message: "Secret message" })
dm-read()
```

Legacy NIP-04 requires explicit opt-in:

```
dm-send({ recipientPubkeyHex: "<hex>", message: "Legacy DM", nip04: true })
```

NIP-04 only works if `NIP04_ENABLED=1` is set in the environment.

## Trust & Attestations

### Creating Attestations

Kind 31000 verifiable attestations (NIP-VA):

```
trust-attest({
  type: "identity-verification",
  subject: "<subject-hex-pubkey>",
  summary: "Verified identity in person on 2026-03-24"
})
```

### Ring Signatures

Prove you belong to a group without revealing which member you are:

```
trust-ring-prove({
  ring: ["<pubkey1>", "<pubkey2>", "<your-pubkey>", "<pubkey3>"],
  attestationType: "kyc-verified"
})
```

The verifier sees "someone in this ring signed this" but cannot determine who.

### Spoken Verification

For in-person identity confirmation. Both parties share a secret, then verify via spoken words:

```
trust-spoken-challenge({ secret: "<shared-hex>", context: "meeting-2026-03-24", counter: 1 })
# → { token: "castle" }

trust-spoken-verify({ secret: "<shared-hex>", context: "meeting-2026-03-24", counter: 1, input: "castle" })
# → { valid: true }
```

## Lightning Payments (NWC)

Configure Nostr Wallet Connect by setting `NWC_URI` or `NWC_URI_FILE`:

```bash
export NWC_URI="nostr+walletconnect://<wallet-pubkey>?relay=wss://relay&secret=<hex>"
```

Then use the zap tools:

```
zap-send({ invoice: "lnbc10u1..." })
zap-balance()
zap-make-invoice({ amountMsats: 100000, description: "Payment for service" })
zap-receipts({ limit: 10 })
```

All NWC communication is NIP-44 encrypted. The NWC secret is zeroised from memory after each operation.

## Relay Management

### Per-Identity Relay Lists

Each identity can have its own relay set. This prevents correlation between personas:

```
relay-list()                                    # show current relays
relay-add({ url: "wss://new-relay.com" })       # add a relay
relay-set({ relays: [...], confirm: true })      # publish kind 10002
relay-info({ url: "wss://relay.damus.io" })     # fetch NIP-11 info
```

### Tor Support

Route all connections through Tor:

```bash
export TOR_PROXY="socks5h://127.0.0.1:9050"
export NOSTR_RELAYS="ws://jgqaglhautb4k6e6i2g34jakber2ihhe6yf5pyawmqdoumrn2phdangqd.onion"
```

Clearnet relays are blocked by default when a Tor proxy is configured. Set `ALLOW_CLEARNET_WITH_TOR=1` to override.

## Safety

### Duress Personas

Configure an alternative identity that looks identical to a normal persona switch:

```
safety-configure({ personaName: "emergency" })
safety-activate({ personaName: "emergency" })
```

The activate response is structurally identical to `identity-switch` — an observer cannot distinguish a duress switch from a normal one. The duress persona appears in `identity-list` as a regular identity.

## HTTP Transport

For remote access, start with HTTP transport:

```bash
TRANSPORT=http PORT=3000 npx nostr-bray
# nostr-bray HTTP auth token: <uuid>
# nostr-bray HTTP on 127.0.0.1:3000
```

The bearer token is printed to stderr on startup. Include it in requests:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"whoami"},"id":1}'
```

Rate limited to 100 requests per 60 seconds per IP.
