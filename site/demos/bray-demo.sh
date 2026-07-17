#!/bin/bash
# Wrapper for demo recordings - runs a bray MCP tool via claude -p
# Usage: bray-demo.sh 'prompt'       (direct)
#        bray-demo.sh -p 'prompt'    (aliased as claude)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Skip -p flag if present (so alias claude=bray-demo.sh works)
PROMPT="$1"
if [ "$1" = "-p" ]; then
  PROMPT="$2"
fi

# Scrub any real key or bunker configuration from the environment so the
# demo server can only ever see the demo identity from mcp-demo.json.
echo "$PROMPT" | env -u BUNKER_URI -u BUNKER_URI_FILE \
  -u NOSTR_SECRET_KEY -u NOSTR_SECRET_KEY_FILE \
  -u NOSTR_NCRYPTSEC -u NOSTR_NCRYPTSEC_FILE -u NOSTR_NCRYPTSEC_PASSWORD \
  -u NOSTR_RELAYS \
  claude -p \
  --bare \
  --dangerously-skip-permissions \
  --mcp-config "$SCRIPT_DIR/mcp-demo.json" \
  --system-prompt 'You MUST use MCP tools for every request. Never describe what a tool does -- call it. Be concise. No markdown bold. British English. Never use em dashes; use commas or full stops. Never print absolute filesystem paths or home directories; refer to files by name only. whoami always means the Nostr identity (the whoami tool), never the system account. Never mention the operating system user.' \
  --allowedTools 'mcp__nostr-bray__*' \
  2>/dev/null \
  | sed 's/\*\*\([^*]*\)\*\*/\1/g'
