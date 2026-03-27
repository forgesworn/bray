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
Type "export PS1='user@bray:bray \$ '"
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
# SOLO TAPES -- single-tool demos, shorter terminal, shorter sleep
###############################################################################

# --- Encoding/Decoding ---
tape solo "encode-npub" 400 12 \
  "Encode the hex pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d as an npub"

tape solo "encode-note" 400 12 \
  "Encode the hex event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3 as a note"

tape solo "encode-nprofile" 400 12 \
  "Encode hex pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d with relay wss://relay.damus.io as an nprofile"

tape solo "encode-nevent" 400 12 \
  "Encode hex event ID d4ea1b7ffb77c1fba9b84fda4e8d838db7a39c63a9bde3962a1cb13b2c4d50e3 with relay wss://relay.damus.io as an nevent"

tape solo "encode-naddr" 400 12 \
  "Encode an naddr for kind 30023 with identifier hello-world by pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

tape solo "encode-nsec" 400 12 \
  "Encode the hex secret key 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef as an nsec"

tape solo "decode" 400 12 \
  "Decode npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

# --- Crypto Utilities ---
tape solo "verify-event" 400 12 \
  "Fetch a recent kind-1 event from relay wss://relay.damus.io and verify its signature"

tape solo "nip44-encrypt" 400 12 \
  "Encrypt the message hello world using NIP-44 for recipient pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

tape solo "nip44-decrypt" 400 12 \
  "Show how NIP-44 decryption works by describing what nip44-decrypt does"

tape solo "key-public" 400 12 \
  "Get the public key for the current active identity"

tape solo "key-encrypt" 400 12 \
  "Encrypt the current identity private key with password demopassword using NIP-49"

tape solo "key-decrypt" 400 12 \
  "Describe what key-decrypt does for NIP-49 encrypted keys"

# --- Event Queries ---
tape solo "count" 400 12 \
  "Count kind-1 events from the last hour on relay wss://relay.damus.io"

tape solo "fetch" 400 12 \
  "Fetch the latest kind-0 profile event for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "filter" 400 12 \
  "Build a Nostr filter for kind 1 events with limit 5 from the last 24 hours"

tape solo "social-feed" 400 15 \
  "Show the global social feed with the 5 most recent notes"

# --- NIP Info ---
tape solo "nip-list" 400 12 \
  "List all supported Nostr NIPs"

tape solo "nip-show" 400 12 \
  "Show details about NIP-17 private direct messages"

# --- Identity Utilities ---
tape solo "identity-derive" 400 12 \
  "Derive a child identity with purpose payments from the root key"

tape solo "identity-list" 400 12 \
  "List all derived identities and personas"

tape solo "identity-prove" 400 12 \
  "Generate an identity ownership proof for the active identity"

tape solo "identity-backup" 400 12 \
  "Create a standard backup of the current identity"

tape solo "identity-restore" 400 12 \
  "Describe what identity-restore does for recovering from a backup"

tape solo "identity-migrate" 400 12 \
  "Describe what identity-migrate does for moving to a new key"

tape solo "nip05-relays" 400 12 \
  "Look up the relay list for NIP-05 address fiatjaf@fiatjaf.com"

# --- Identity Workflows ---
tape solo "identity-setup" 500 15 \
  "Run the identity-setup workflow to initialise a new identity"

tape solo "identity-recover" 400 12 \
  "Describe what the identity-recover workflow does"

tape solo "onboard-verified" 500 15 \
  "Run the onboard-verified workflow to set up a verified identity"

# --- Social Utilities ---
tape solo "social-delete" 400 12 \
  "Describe what social-delete does for removing published notes"

tape solo "social-repost" 400 12 \
  "Describe what social-repost does for sharing notes"

tape solo "social-profile-get" 400 15 \
  "Get the profile metadata for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "dm-by-name" 400 12 \
  "Describe what dm-by-name does for sending DMs using display names"

tape solo "dm-conversation" 400 15 \
  "Describe what dm-conversation does for viewing DM threads"

tape solo "feed-by-name" 400 15 \
  "Describe what feed-by-name does for viewing a user feed by display name"

tape solo "profile-by-name" 400 15 \
  "Describe what profile-by-name does for looking up profiles by display name"

# --- Contacts ---
tape solo "contacts-get" 400 15 \
  "Get the contact list for the active identity"

tape solo "contacts-unfollow" 400 12 \
  "Describe what contacts-unfollow does for removing follows"

# --- Content Management ---
tape solo "label-self" 400 12 \
  "Create a self-label tagging the active identity as a developer"

tape solo "label-read" 400 15 \
  "Read labels applied to npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "label-search" 400 15 \
  "Search for events labelled as spam"

tape solo "label-remove" 400 12 \
  "Describe what label-remove does for deleting labels"

tape solo "list-mute-read" 400 12 \
  "Read the current mute list"

tape solo "list-check-muted" 400 12 \
  "Check if pubkey 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d is muted"

tape solo "list-pin-read" 400 12 \
  "Read the current pinned notes list"

# --- Privacy ---
tape solo "privacy-open" 400 12 \
  "Open and reveal a privacy commitment given the original value and blinding factor"

tape solo "privacy-prove-range" 400 12 \
  "Create a range proof that a committed value is between 0 and 100"

tape solo "privacy-verify-range" 400 12 \
  "Describe what privacy-verify-range does for checking range proofs"

tape solo "privacy-prove-threshold" 400 12 \
  "Create a threshold proof that a committed value exceeds 1000"

tape solo "privacy-verify-threshold" 400 12 \
  "Describe what privacy-verify-threshold does for checking threshold proofs"

tape solo "privacy-publish-proof" 400 12 \
  "Describe what privacy-publish-proof does for publishing proofs to Nostr"

tape solo "privacy-read-proof" 400 12 \
  "Describe what privacy-read-proof does for reading published proofs"

# --- Trust Utilities ---
tape solo "trust-read" 400 15 \
  "Read trust attestations for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "trust-verify" 400 12 \
  "Verify a trust attestation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "trust-revoke" 400 12 \
  "Describe what trust-revoke does for revoking attestations"

tape solo "trust-request" 400 12 \
  "Describe what trust-request does for requesting attestations from others"

tape solo "trust-request-list" 400 12 \
  "List pending trust attestation requests"

tape solo "trust-proof-publish" 400 12 \
  "Describe what trust-proof-publish does for publishing proofs to Nostr"

tape solo "trust-attest-parse" 400 12 \
  "Describe what trust-attest-parse does for parsing attestation events"

tape solo "trust-attest-filter" 400 12 \
  "Describe what trust-attest-filter does for filtering attestations by criteria"

tape solo "trust-attest-temporal" 400 12 \
  "Describe what trust-attest-temporal does for time-bounded attestations"

tape solo "trust-attest-chain" 400 12 \
  "Describe what trust-attest-chain does for creating attestation chains"

tape solo "trust-attest-check-revoked" 400 12 \
  "Describe what trust-attest-check-revoked does for checking revocation status"

tape solo "trust-ring-lsag-sign" 400 12 \
  "Describe what trust-ring-lsag-sign does for linkable ring signatures"

tape solo "trust-ring-lsag-verify" 400 12 \
  "Describe what trust-ring-lsag-verify does for verifying linkable ring signatures"

tape solo "trust-ring-key-image" 400 12 \
  "Describe what trust-ring-key-image does for computing key images"

tape solo "trust-spoken-directional" 400 12 \
  "Generate a directional spoken verification token for a meeting"

tape solo "trust-spoken-encode" 400 12 \
  "Encode a verification challenge as spoken words"

# --- Signet ---
tape solo "signet-credentials" 400 15 \
  "List Signet credentials for the active identity"

tape solo "signet-challenge" 400 12 \
  "Generate a Signet verification challenge"

# --- Relay Utilities ---
tape solo "relay-add" 400 12 \
  "Add relay wss://relay.snort.social to the relay list"

tape solo "relay-query" 400 15 \
  "Query relay wss://relay.damus.io for the 3 most recent kind-1 events"

tape solo "relay-compare" 400 15 \
  "Compare relays wss://relay.damus.io and wss://nos.lol for features and performance"

tape solo "relay-diversity" 400 15 \
  "Analyse relay diversity for the current relay set"

# --- Safety ---
tape solo "safety-configure" 400 12 \
  "Show the current safety configuration settings"

tape solo "safety-activate" 400 12 \
  "Describe what safety-activate does for enabling safety protections"

tape solo "canary-group-join" 400 12 \
  "Describe what canary-group-join does for joining a liveness group"

tape solo "canary-group-members" 400 12 \
  "Describe what canary-group-members does for listing group participants"

tape solo "canary-duress-signal" 400 12 \
  "Describe what canary-duress-signal does for sending a silent duress alert"

tape solo "canary-duress-detect" 400 12 \
  "Describe what canary-duress-detect does for monitoring duress signals"

# --- Vault Utilities ---
tape solo "vault-read" 400 12 \
  "Read the contents of the current vault"

tape solo "vault-read-shared" 400 12 \
  "Describe what vault-read-shared does for reading shared vault content"

tape solo "vault-revoke" 400 12 \
  "Describe what vault-revoke does for revoking vault access"

tape solo "vault-members" 400 12 \
  "List members with access to the current vault"

tape solo "vault-config" 400 12 \
  "Show the current vault configuration"

tape solo "vault-rotate" 400 12 \
  "Describe what vault-rotate does for rotating vault keys"

# --- Marketplace Utilities ---
tape solo "marketplace-search" 400 15 \
  "Search for marketplace services offering translation"

tape solo "marketplace-reputation" 400 15 \
  "Check the marketplace reputation for npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

tape solo "marketplace-compare" 400 15 \
  "Compare two marketplace services side by side"

tape solo "marketplace-probe" 400 15 \
  "Probe a marketplace service endpoint for availability"

tape solo "marketplace-announce" 400 12 \
  "Describe what marketplace-announce does for publishing service listings"

tape solo "marketplace-update" 400 12 \
  "Describe what marketplace-update does for modifying service listings"

tape solo "marketplace-retire" 400 12 \
  "Describe what marketplace-retire does for removing service listings"

tape solo "marketplace-credentials-clear" 400 12 \
  "Clear cached marketplace credentials"

# --- Zap Utilities ---
tape solo "zap-decode" 400 12 \
  "Decode a lightning invoice to show its amount and destination"

tape solo "zap-lookup-invoice" 400 12 \
  "Look up the status of a lightning invoice"

tape solo "zap-list-transactions" 400 15 \
  "List recent lightning transactions"

tape solo "zap-receipts" 400 15 \
  "Check for zap receipts on a recent note"

# --- Blossom ---
tape solo "blossom-check" 400 12 \
  "Check if a blob exists on the default Blossom server"

tape solo "blossom-delete" 400 12 \
  "Describe what blossom-delete does for removing blobs"

tape solo "blossom-discover" 400 15 \
  "Discover Blossom servers used by contacts"

tape solo "blossom-verify" 400 12 \
  "Verify the integrity of a stored blob"

tape solo "blossom-repair" 400 12 \
  "Describe what blossom-repair does for fixing missing blobs"

tape solo "blossom-usage" 400 12 \
  "Check storage usage on the default Blossom server"

tape solo "blossom-servers" 400 12 \
  "Get or set the Blossom server list"

# --- Groups ---
tape solo "group-info" 400 15 \
  "Get information about a NIP-29 group on a relay"

tape solo "group-chat" 400 15 \
  "View recent messages in a NIP-29 group"

tape solo "group-send" 400 12 \
  "Describe what group-send does for posting to NIP-29 groups"

tape solo "group-members" 400 15 \
  "List members of a NIP-29 group"

# --- NIP Publishing ---
tape solo "nip-publish" 400 12 \
  "Describe what nip-publish does for broadcasting raw Nostr events"

tape solo "nip-read" 400 12 \
  "Describe what nip-read does for reading raw Nostr events by ID"

# --- Misc ---
tape solo "tombstone" 400 12 \
  "Describe what the tombstone tool does for marking content as deleted"

tape solo "search-actions" 400 12 \
  "Search for available actions related to identity management"

tape solo "execute-action" 400 12 \
  "Describe what execute-action does for running discovered actions"


###############################################################################
echo ""
echo "Generated $COUNT tape files."
echo "  Stories: $(ls tapes/stories/*.tape 2>/dev/null | wc -l | tr -d ' ')"
echo "  Solo:    $(ls tapes/solo/*.tape 2>/dev/null | wc -l | tr -d ' ')"
