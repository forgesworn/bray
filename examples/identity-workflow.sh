#!/usr/bin/env bash
# Identity management workflow using the nostr-bray CLI.
#
# Prerequisites:
#   export NOSTR_SECRET_KEY="nsec1..."
#   export NOSTR_RELAYS="wss://relay.damus.io"

set -euo pipefail

echo "=== Who am I? ==="
npx nostr-bray whoami

echo ""
echo "=== List identities (just master) ==="
npx nostr-bray list

echo ""
echo "=== Derive a work persona ==="
npx nostr-bray persona work

echo ""
echo "=== Derive a personal persona ==="
npx nostr-bray persona personal

echo ""
echo "=== List all identities ==="
npx nostr-bray list

echo ""
echo "=== Create a blind linkage proof (proves child belongs to master, hides derivation path) ==="
npx nostr-bray prove blind

echo ""
echo "=== Derive a purpose-based identity ==="
npx nostr-bray derive signing 0

echo ""
echo "=== Post a note as master ==="
npx nostr-bray post "Hello from nostr-bray CLI!"

echo ""
echo "=== Shamir backup (3-of-5 shards) ==="
mkdir -p /tmp/bray-shards
npx nostr-bray backup /tmp/bray-shards 3 5
echo "Shards written to /tmp/bray-shards/"
ls -la /tmp/bray-shards/
