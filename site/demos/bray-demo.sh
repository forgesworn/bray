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

echo "$PROMPT" | claude -p \
  --bare \
  --dangerously-skip-permissions \
  --mcp-config "$SCRIPT_DIR/mcp-demo.json" \
  --system-prompt 'Be concise. No personal details. Do not use markdown bold (**text**) in your responses.' \
  --allowedTools 'mcp__nostr-bray__*' \
  2>/dev/null \
  | sed 's/\*\*\([^*]*\)\*\*/\1/g'
