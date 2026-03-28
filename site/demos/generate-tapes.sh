#!/bin/bash
# generate-tapes.sh -- Creates all VHS tape files from prompt definitions
# Run from site/demos/: ./generate-tapes.sh
# Regenerates all tape files. Safe to re-run (overwrites existing tapes).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p tapes/stories tapes/solo

DEMO_SCRIPT="$SCRIPT_DIR/bray-demo.sh"

# Counter for reporting
COUNT=0

# Generate a tape file
# Usage: tape <type> <name> <height> <sleep_seconds> <prompt>
tape() {
  local type="$1"    # stories or solo
  local name="$2"    # filename without .tape
  local height="$3"  # terminal height in pixels
  local sleep="$4"   # seconds to wait for output
  local prompt="$5"  # the claude -p prompt

  local file="tapes/${type}/${name}.tape"
  ((COUNT++))

  cat > "$file" <<TAPE
Set Shell "zsh"
Set Width 1200
Set Height ${height}
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Padding 20
Set TypingSpeed 40ms

Output gifs/${name}.gif

Hide
Type "export PS1='darren@ForgeSworn.dev:bray \$ '"
Enter
Type "alias claude=${DEMO_SCRIPT}"
Enter
Type "clear"
Enter
Sleep 0.5s
Show

Type "claude -p '${prompt}'"
Enter
Sleep ${sleep}s
TAPE
}


###############################################################################
# STORY TAPES (26) -- multi-tool workflows, taller terminal, longer sleep
###############################################################################

tape stories "01-identity-onboarding" 600 25 \
  "Create a new Nostr identity, derive a persona called demo, switch to it, then check whoami"

tape stories "02-identity-backup" 600 25 \
  "Back up the current identity using Shamir secret sharing with a 2-of-3 threshold, then restore it from 2 shares"

tape stories "03-profile-and-nip05" 600 25 \
  "Set the profile display name to Demo Agent, then look up the NIP-05 address fiatjaf@fiatjaf.com and verify it"

tape stories "04-feed-and-discovery" 600 25 \
  "Check recent notifications, then discover interesting accounts to follow, and follow one of them"

tape stories "05-direct-messaging" 600 25 \
  "Search contacts for someone to message, send them an encrypted DM saying hello from bray demo, then read the DM inbox"

tape stories "06-public-engagement" 600 25 \
  "Post a short note saying hello from bray, then reply to it with a follow-up, and react to it with a thumbs up"

tape stories "07-trust-check" 600 25 \
  "Check the Signet badge for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6, then get their full trust score, then run verify-person"

tape stories "08-attestation-and-vouching" 600 25 \
  "Vouch for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 as a developer, then create a trust attestation, then publish a trust claim"

tape stories "09-professional-verification" 600 25 \
  "List available Signet verifiers, then set a verification policy requiring at least one badge, then check if our identity complies"

tape stories "10-ring-signatures" 600 20 \
  "Create a ring signature proof that one member of a group endorses a message, then verify the ring signature"

tape stories "11-spoken-verification" 600 20 \
  "Generate a spoken verification challenge for an in-person identity check, then verify the token"

tape stories "12-privacy-proofs" 600 25 \
  "Create a privacy commitment for age 25, then prove the age is 18 or older without revealing it, then verify that proof"

tape stories "13-vault-setup" 600 25 \
  "Create a new vault with inner and outer tiers, encrypt a secret message into the vault, then share access with another pubkey"

tape stories "14-relay-management" 600 25 \
  "List current relays, update the relay set to include wss://relay.damus.io and wss://nos.lol, then check relay health"

tape stories "15-relay-discovery" 600 25 \
  "Discover relays used by contacts, search for relays supporting NIP-50 search, then get a relay recommendation"

tape stories "16-content-moderation" 600 25 \
  "Mute a pubkey, create a content label for spam, then apply a moderation filter to the feed"

tape stories "17-marketplace" 600 30 \
  "Discover available marketplace services, inspect the first one, pay for it with a lightning invoice, then call the service endpoint"

tape stories "18-zap-workflow" 600 25 \
  "Check the wallet balance, create a lightning invoice for 100 sats, then send 21 sats to npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape stories "19-decode-and-fetch" 500 20 \
  "Decode the nip19 entity npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 and then fetch their latest event"

tape stories "20-canary-session" 600 25 \
  "Create a canary session for phone-based liveness verification, check the current session status, then verify the session"

tape stories "21-canary-group" 600 25 \
  "Create a canary group for a team liveness check-in, check the current group status, then verify the group"

tape stories "22-canary-beacon" 600 20 \
  "Create a canary beacon for location-based liveness, then check the beacon status"

tape stories "23-follow-sets" 600 25 \
  "Create a follow set called developers, add a pubkey to it, then read the follow set members"

tape stories "24-bookmarks" 600 25 \
  "Pin a note by event ID, bookmark another note, then read the bookmarks list"

tape stories "25-blossom-files" 600 25 \
  "Upload a text file to Blossom, list stored blobs, then mirror a blob to a second server"

tape stories "26-relay-operator" 600 25 \
  "Get relay info for wss://relay.damus.io, count events matching a filter, then authenticate with the relay"


###############################################################################
# SOLO TAPES -- single-tool demos, shorter terminal
# Sleep 25s gives Claude enough time to respond; postprocess.sh trims the wait.
# Every prompt MUST call the real tool. No "describe what X does" cop-outs.
###############################################################################

# --- Encoding/Decoding ---
tape solo "encode-npub" 400 25 \
  "Encode the hex pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d as an npub"

tape solo "encode-note" 400 25 \
  "Encode the hex event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3 as a note"

tape solo "encode-nprofile" 400 25 \
  "Encode hex pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d with relay wss://relay.damus.io as an nprofile"

tape solo "encode-nevent" 400 25 \
  "Encode hex event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3 with relay wss://relay.damus.io as an nevent"

tape solo "encode-naddr" 400 25 \
  "Encode an naddr for kind 30023 with identifier hello-world by pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

tape solo "encode-nsec" 400 25 \
  "Encode the hex secret key 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef as an nsec"

tape solo "decode" 400 25 \
  "Decode npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

# --- Crypto Utilities ---
tape solo "verify-event" 400 25 \
  "Fetch a recent kind-1 event from relay wss://relay.damus.io and verify its signature"

tape solo "nip44-encrypt" 400 25 \
  "Encrypt the message hello world using NIP-44 for recipient pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

tape solo "nip44-decrypt" 500 25 \
  "Encrypt the message secret demo message using NIP-44 for our own pubkey, then decrypt the ciphertext back"

tape solo "key-public" 400 25 \
  "Use the key-public tool to get the public key for the current active identity"

tape solo "key-encrypt" 400 25 \
  "Encrypt the current identity private key with password demopassword using NIP-49"

tape solo "key-decrypt" 500 25 \
  "Encrypt a test key with NIP-49 using password demo123, then decrypt it back with the same password"

# --- Event Queries ---
tape solo "count" 400 25 \
  "Count kind-1 events from the last hour on relay wss://relay.damus.io"

tape solo "fetch" 400 25 \
  "Fetch the latest kind-0 profile event for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "filter" 400 25 \
  "Build a Nostr filter for kind 1 events with limit 5 from the last 24 hours"

tape solo "social-feed" 400 25 \
  "Use the social-feed tool to fetch the 5 most recent global notes"

# --- NIP Info ---
tape solo "nip-list" 400 25 \
  "Use the nip-list tool to list all supported Nostr NIPs"

tape solo "nip-show" 400 25 \
  "Use the nip-show tool to look up NIP-17 private direct messages"

# --- Identity Utilities ---
tape solo "identity-derive" 400 25 \
  "Derive a child identity with purpose payments from the root key"

tape solo "identity-list" 400 25 \
  "List all derived identities and personas"

tape solo "identity-prove" 400 25 \
  "Generate an identity ownership proof for the active identity"

tape solo "identity-backup" 400 25 \
  "Create a standard backup of the current identity including profile and contacts"

tape solo "identity-restore" 500 25 \
  "Back up the current identity profile, then restore it from that backup"

tape solo "identity-migrate" 400 25 \
  "Generate a NIP-41 key migration event from the current identity to a new target pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

tape solo "nip05-relays" 400 25 \
  "Look up the relay list for NIP-05 address fiatjaf@fiatjaf.com"

# --- Identity Workflows ---
tape solo "identity-setup" 500 25 \
  "Run the identity-setup workflow to initialise a new identity"

tape solo "identity-recover" 500 25 \
  "Run identity-recover to check recovery options for the active identity"

tape solo "onboard-verified" 500 25 \
  "Run the onboard-verified workflow to set up a verified identity"

# --- Social Utilities ---
tape solo "social-delete" 500 25 \
  "Post a note saying test message for cleanup, then delete it"

tape solo "social-repost" 400 25 \
  "Fetch the latest note from npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 and repost it"

tape solo "social-profile-get" 400 25 \
  "Use the social-profile-get tool to fetch the profile for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "dm-by-name" 400 25 \
  "Send a DM to fiatjaf saying hello from the bray demo"

tape solo "dm-conversation" 400 25 \
  "Read the DM conversation history with npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "feed-by-name" 400 25 \
  "Show the recent feed for fiatjaf"

tape solo "profile-by-name" 400 25 \
  "Look up the profile for fiatjaf by name"

# --- Contacts ---
tape solo "contacts-get" 400 25 \
  "Use the contacts-get tool to fetch the contact list for the active identity"

tape solo "contacts-unfollow" 500 25 \
  "Follow npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 then unfollow them"

# --- Content Management ---
tape solo "label-self" 400 25 \
  "Create a self-label tagging the active identity as a developer"

tape solo "label-read" 400 25 \
  "Read labels applied to npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "label-search" 400 25 \
  "Search for events labelled as spam"

tape solo "label-remove" 500 25 \
  "Create a label tagging a test event as review-needed, then remove that label"

tape solo "list-mute-read" 400 25 \
  "Use the list-mute-read tool to read the current mute list"

tape solo "list-check-muted" 400 25 \
  "Check if pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d is muted"

tape solo "list-pin-read" 400 25 \
  "Use the list-pin-read tool to read the current pinned notes"

# --- Privacy ---
tape solo "privacy-open" 400 25 \
  "Create a privacy commitment for value 42, then open it to reveal the original value"

tape solo "privacy-prove-range" 400 25 \
  "Create a commitment for value 42 and prove it is between 0 and 100"

tape solo "privacy-verify-range" 500 25 \
  "Create a commitment for value 42, prove it is between 0 and 100, then verify the proof"

tape solo "privacy-prove-threshold" 400 25 \
  "Create a commitment for value 500 and prove it exceeds 100"

tape solo "privacy-verify-threshold" 500 25 \
  "Create a commitment for value 500, prove it exceeds 100, then verify the proof"

tape solo "privacy-publish-proof" 500 25 \
  "Create a commitment for value 30, prove it is in range 0-50, then publish the proof to Nostr"

tape solo "privacy-read-proof" 400 25 \
  "Read published privacy proofs for the active identity"

# --- Trust Utilities ---
tape solo "trust-read" 400 25 \
  "Read trust attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "trust-verify" 400 25 \
  "Verify trust attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "trust-revoke" 500 25 \
  "Create a trust attestation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 as a tester, then revoke it"

tape solo "trust-request" 400 25 \
  "Send a trust attestation request to npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 asking for a developer attestation"

tape solo "trust-request-list" 400 25 \
  "List pending trust attestation requests for the active identity"

tape solo "trust-proof-publish" 500 25 \
  "Create a trust attestation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 and publish the proof to Nostr"

tape solo "trust-attest-parse" 400 25 \
  "Fetch trust attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 and parse their contents"

tape solo "trust-attest-filter" 400 25 \
  "Filter trust attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 by type developer"

tape solo "trust-attest-temporal" 400 25 \
  "Create a trust attestation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 that expires in 30 days"

tape solo "trust-attest-chain" 400 25 \
  "Build an attestation chain starting from the active identity through npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "trust-attest-check-revoked" 400 25 \
  "Check if any attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 have been revoked"

tape solo "trust-ring-lsag-sign" 400 25 \
  "Create a linkable ring signature over the message bray demo with a 3-member ring"

tape solo "trust-ring-lsag-verify" 500 25 \
  "Create a linkable ring signature over a message, then verify it"

tape solo "trust-ring-key-image" 400 25 \
  "Compute the key image for the active identity"

tape solo "trust-spoken-directional" 400 25 \
  "Generate a directional spoken verification token for a meeting"

tape solo "trust-spoken-encode" 400 25 \
  "Encode a verification challenge as spoken words"

# --- Signet ---
tape solo "signet-credentials" 400 25 \
  "List Signet credentials for the active identity"

tape solo "signet-challenge" 400 25 \
  "Generate a Signet verification challenge"

# --- Relay Utilities ---
tape solo "relay-add" 400 25 \
  "Add relay wss://relay.snort.social to the relay list"

tape solo "relay-query" 400 25 \
  "Query relay wss://relay.damus.io for the 3 most recent kind-1 events"

tape solo "relay-compare" 400 25 \
  "Compare relays wss://relay.damus.io and wss://nos.lol for features and performance"

tape solo "relay-diversity" 400 25 \
  "Analyse relay diversity for the current relay set"

# --- Safety ---
tape solo "safety-configure" 400 25 \
  "Use the safety-configure tool to show the current safety settings"

tape solo "safety-activate" 400 25 \
  "Activate safety protections with the duress word pineapple"

tape solo "canary-group-join" 500 25 \
  "Create a canary group called demo-team, then join it with the active identity"

tape solo "canary-group-members" 500 25 \
  "Create a canary group called demo-squad and list its members"

tape solo "canary-duress-signal" 400 25 \
  "Send a test duress signal from the active identity"

tape solo "canary-duress-detect" 400 25 \
  "Check for duress signals from npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

# --- Vault Utilities ---
tape solo "vault-read" 400 25 \
  "Use the vault-read tool to read the contents of the default vault"

tape solo "vault-read-shared" 500 25 \
  "Create a vault, encrypt a message, share it with npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6, then read the shared content"

tape solo "vault-revoke" 500 25 \
  "Create a vault, share it with npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6, then revoke their access"

tape solo "vault-members" 400 25 \
  "List members with access to the default vault"

tape solo "vault-config" 400 25 \
  "Use the vault-config tool to show the current vault configuration"

tape solo "vault-rotate" 500 25 \
  "Create a vault and rotate its encryption keys to a new epoch"

# --- Marketplace Utilities ---
tape solo "marketplace-search" 400 25 \
  "Search for marketplace services offering translation"

tape solo "marketplace-reputation" 400 25 \
  "Check the marketplace reputation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "marketplace-compare" 400 25 \
  "Search for marketplace services and compare the first two side by side"

tape solo "marketplace-probe" 400 25 \
  "Probe a marketplace service endpoint for availability"

tape solo "marketplace-announce" 400 25 \
  "Announce a new marketplace service offering translation for 100 sats per request"

tape solo "marketplace-update" 500 25 \
  "Announce a test service offering demo-api, then update its description to say improved demo"

tape solo "marketplace-retire" 500 25 \
  "Announce a temporary test service, then retire it"

tape solo "marketplace-credentials-clear" 400 25 \
  "Clear cached marketplace credentials"

# --- Zap Utilities ---
tape solo "zap-balance" 400 25 \
  "Switch to the demo persona and check the wallet balance"

tape solo "zap-send" 500 25 \
  "Switch to the demo persona, check the wallet balance, then create a lightning invoice for 21 sats"

tape solo "zap-make-invoice" 400 25 \
  "Switch to the demo persona and create a lightning invoice for 100 sats"

tape solo "zap-decode" 400 25 \
  "Create a lightning invoice for 50 sats and then decode it"

tape solo "zap-lookup-invoice" 400 25 \
  "Create a lightning invoice for 100 sats and look up its status"

tape solo "zap-list-transactions" 400 25 \
  "List recent lightning transactions"

tape solo "zap-receipts" 400 25 \
  "Check for zap receipts on npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

# --- Blossom ---
tape solo "blossom-check" 400 25 \
  "Use the blossom-check tool to check if any blobs exist for the active identity"

tape solo "blossom-delete" 500 25 \
  "Upload a test blob to Blossom, then delete it"

tape solo "blossom-discover" 400 25 \
  "Discover Blossom servers used by contacts"

tape solo "blossom-verify" 400 25 \
  "List blobs on Blossom and verify their integrity"

tape solo "blossom-repair" 400 25 \
  "Check for missing or corrupted blobs and attempt repair"

tape solo "blossom-usage" 400 25 \
  "Check storage usage on Blossom servers"

tape solo "blossom-servers" 400 25 \
  "Use the blossom-servers tool to get the current Blossom server list"

# --- Groups ---
tape solo "group-info" 400 25 \
  "Get information about a NIP-29 group on wss://groups.fiatjaf.com"

tape solo "group-chat" 400 25 \
  "View recent messages in a NIP-29 group on wss://groups.fiatjaf.com"

tape solo "group-send" 400 25 \
  "Send a message saying hello from bray demo to a NIP-29 group"

tape solo "group-members" 400 25 \
  "List members of a NIP-29 group on wss://groups.fiatjaf.com"

# --- NIP Publishing ---
tape solo "nip-publish" 400 25 \
  "Publish a kind-1 event with content hello from bray demo to wss://relay.damus.io"

tape solo "nip-read" 400 25 \
  "Read the most recent kind-1 event from npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 on wss://relay.damus.io"

# --- Misc ---
tape solo "tombstone" 400 25 \
  "Create a tombstone deletion event for event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3"

tape solo "search-actions" 400 25 \
  "Search for available actions related to identity management"

tape solo "execute-action" 500 25 \
  "Search for actions related to relay, then execute the first one found"


###############################################################################
echo ""
echo "Generated $COUNT tape files."
echo "  Stories: $(ls tapes/stories/*.tape 2>/dev/null | wc -l | tr -d ' ')"
echo "  Solo:    $(ls tapes/solo/*.tape 2>/dev/null | wc -l | tr -d ' ')"
