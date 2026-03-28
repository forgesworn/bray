#!/bin/bash
# postprocess.sh -- Remove wait-for-response dead time from demo GIFs
#
# Pattern: typing -> [long cursor blink wait] -> response -> [trailing idle]
# Result:  typing -> 0.5s pause -> response -> 5s hold on last frame
#
# Usage:
#   ./postprocess.sh                  Process all GIFs in gifs/
#   ./postprocess.sh <name>           Process a single GIF by name
#   ./postprocess.sh --dry-run        Show what would be done without changing files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIFS_DIR="$SCRIPT_DIR/gifs"

DRY_RUN=false
FILTER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) FILTER="$1"; shift ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

if ! command -v gifsicle &>/dev/null; then
  echo -e "${RED}Error: gifsicle not found. Install with: brew install gifsicle${NC}"
  exit 1
fi

# Analyse a GIF and find the first response frame (first large content frame after typing)
# Returns: "typing_end response_start last_frame" or "SKIP" if structure not detected
analyse_gif() {
  local gif="$1"
  local info
  info=$(gifsicle --info "$gif" 2>&1)

  local total_frames
  total_frames=$(echo "$info" | head -1 | grep -o '[0-9]* images' | awk '{print $1}')

  if [[ -z "$total_frames" || "$total_frames" -lt 10 ]]; then
    echo "SKIP"
    return
  fi

  # Extract frame data: frame_num width height x y
  # Frame 0 has no "at X,Y" (full canvas), others do. Filter to only "at" lines.
  local frame_data
  frame_data=$(echo "$info" | grep 'image #' | grep ' at ' | sed 's/.*image #\([0-9]*\) \([0-9]*\)x\([0-9]*\) at \([0-9]*\),\([0-9]*\) .*/\1 \2 \3 \4 \5/')

  # Find typing end: last frame where content appears at y <= 30 (command line area)
  # and the frame has substantial width (not just cursor)
  local typing_end=-1
  while IFS=' ' read -r n w h x y; do
    # Typing frames are at y ~= 24, with progressive x positions
    if [[ "$y" -le 30 && "$w" -gt 20 ]]; then
      typing_end=$n
    fi
  done <<< "$frame_data"

  if [[ "$typing_end" -lt 5 ]]; then
    echo "SKIP"
    return
  fi

  # Find response start: first frame with area > 500 at y > 30 after typing_end
  local response_start=-1
  while IFS=' ' read -r n w h x y; do
    if [[ "$n" -gt "$typing_end" && "$y" -gt 30 && $((w * h)) -gt 500 ]]; then
      response_start=$n
      break
    fi
  done <<< "$frame_data"

  if [[ "$response_start" -lt 0 ]]; then
    echo "SKIP"
    return
  fi

  local last_frame=$((total_frames - 1))
  local wait_frames=$((response_start - typing_end - 1))

  echo "$typing_end $response_start $last_frame $wait_frames"
}

process_gif() {
  local gif="$1"
  local name
  name=$(basename "$gif" .gif)

  local result
  result=$(analyse_gif "$gif")

  if [[ "$result" == "SKIP" ]]; then
    echo -e "  ${DIM}skip${NC}  ${name} (structure not detected)"
    return
  fi

  local typing_end response_start last_frame wait_frames
  read -r typing_end response_start last_frame wait_frames <<< "$result"

  if [[ "$wait_frames" -lt 5 ]]; then
    echo -e "  ${DIM}skip${NC}  ${name} (only ${wait_frames} wait frames)"
    return
  fi

  local delete_from=$((typing_end + 1))
  local delete_to=$((response_start - 1))

  if $DRY_RUN; then
    echo -e "  ${YELLOW}would${NC} ${name}: delete #${delete_from}-${delete_to} (${wait_frames} wait frames)"
    return
  fi

  # Step 1: delete wait frames, then set transition pause and end hold
  # After deletion, response is at typing_end+1. Output all frames with selective delays.
  local tmp1
  tmp1=$(mktemp /tmp/gif-pp-XXXXXX).gif
  gifsicle "$gif" --delete "#${delete_from}-${delete_to}" -o "$tmp1" 2>/dev/null

  local new_total
  new_total=$(gifsicle --info "$tmp1" 2>&1 | head -1 | grep -o '[0-9]* images' | awk '{print $1}')
  local new_last=$((new_total - 1))
  local response_idx=$((typing_end + 1))

  # Output all frames: typing at original speed, transition pause, response at original, 5s hold
  if [[ "$new_last" -gt "$response_idx" ]]; then
    gifsicle "$tmp1" \
      -d4 "#0-${typing_end}" \
      -d50 "#${typing_end}" \
      -d4 "#${response_idx}-$((new_last - 1))" \
      -d500 "#${new_last}" \
      -o "$gif" 2>/dev/null
  else
    gifsicle "$tmp1" \
      -d4 "#0-${typing_end}" \
      -d50 "#${typing_end}" \
      -d500 "#${new_last}" \
      -o "$gif" 2>/dev/null
  fi

  rm -f "$tmp1"

  local new_size
  new_size=$(ls -lh "$gif" | awk '{print $5}')
  echo -e "  ${GREEN}done${NC}  ${name}  ${DIM}(-${wait_frames} frames, ${new_size})${NC}"
}

# Collect GIFs
gifs=()
if [[ -n "$FILTER" ]]; then
  for f in "$GIFS_DIR"/*"${FILTER}"*.gif; do
    [[ -f "$f" ]] && gifs+=("$f")
  done
else
  for f in "$GIFS_DIR"/*.gif; do
    [[ -f "$f" ]] && gifs+=("$f")
  done
fi

if [[ ${#gifs[@]} -eq 0 ]]; then
  echo -e "${RED}No GIFs found matching '${FILTER}'${NC}"
  exit 1
fi

echo -e "${BOLD}Post-processing ${#gifs[@]} GIFs...${NC}\n"

processed=0
skipped=0
for gif in "${gifs[@]}"; do
  result=$(analyse_gif "$gif")
  if [[ "$result" == "SKIP" ]]; then
    ((skipped++))
  else
    ((processed++))
  fi
  process_gif "$gif"
done

echo -e "\n${BOLD}Summary:${NC} ${GREEN}${processed}${NC} processed, ${DIM}${skipped}${NC} skipped"
