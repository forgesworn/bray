#!/bin/bash
# postprocess.sh -- Trim demo GIFs for a smooth viewing experience
#
# What it does:
#   1. Trim trailing idle frames after the response ends (keep 2s buffer)
#   2. Compress any wait gap between typing and response
#   3. Set 0.3s transition after Enter, 5s hold on last frame
#
# Usage:
#   ./postprocess.sh                  Process all GIFs in gifs/
#   ./postprocess.sh <name>           Process a single GIF by name
#   ./postprocess.sh --dry-run        Show what would be done

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
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

if ! command -v gifsicle &>/dev/null; then
  echo -e "\033[0;31mError: gifsicle not found. Install with: brew install gifsicle\033[0m"
  exit 1
fi

process_gif() {
  local gif="$1"
  local name
  name=$(basename "$gif" .gif)

  local info
  info=$(gifsicle --info "$gif" 2>&1)

  local total
  total=$(echo "$info" | head -1 | grep -o '[0-9]* images' | awk '{print $1}')

  if [[ -z "$total" ]] || [[ "$total" -lt 20 ]]; then
    echo -e "  ${DIM}skip${NC}  ${name} (too few frames)"
    return 0
  fi

  # Parse frames with positions
  local frame_data
  frame_data=$(echo "$info" | grep 'image #' | grep ' at ' | \
    sed 's/.*image #\([0-9]*\) \([0-9]*\)x\([0-9]*\) at \([0-9]*\),\([0-9]*\) .*/\1 \2 \3 \4 \5/' || true)

  if [[ -z "$frame_data" ]]; then
    echo -e "  ${DIM}skip${NC}  ${name} (no frame data)"
    return 0
  fi

  # Find Enter frame: biggest frame at y<=30
  local enter_frame
  enter_frame=$(echo "$frame_data" | awk '$5 <= 30 && $2*$3 > 5000 {last=$1} END {print last+0}')

  # Find last content frame: last frame with area > 400
  local last_content
  last_content=$(echo "$frame_data" | awk '$2*$3 > 400 {last=$1} END {print last+0}')

  # Find first response frame after Enter
  local first_response
  first_response=$(echo "$frame_data" | awk -v ef="$enter_frame" '$1 > ef && $5 > 30 && $2*$3 > 50 {print $1; exit}')
  first_response=${first_response:-0}

  if [[ "$enter_frame" -lt 5 ]] || [[ "$last_content" -lt "$enter_frame" ]]; then
    echo -e "  ${DIM}skip${NC}  ${name} (structure not detected)"
    return 0
  fi

  # Calculate trims
  local wait_gap=0
  if [[ "$first_response" -gt 0 ]]; then
    wait_gap=$((first_response - enter_frame - 1))
  fi

  local keep_until=$((last_content + 50))
  if [[ "$keep_until" -ge "$((total - 1))" ]]; then
    keep_until=$((total - 1))
  fi
  local trailing_cut=$((total - 1 - keep_until))

  # Even if nothing to trim, still set delays for transition + hold
  local needs_trim=false
  if [[ "$wait_gap" -gt 10 ]] || [[ "$trailing_cut" -gt 10 ]]; then
    needs_trim=true
  fi

  if $DRY_RUN; then
    echo -e "  \033[0;33mwould\033[0m ${name}: cut ${trailing_cut} trailing, ${wait_gap} wait (frames: enter=#${enter_frame} resp=#${first_response} last=#${last_content}/${total})"
    return 0
  fi

  local tmp
  tmp=$(mktemp).gif

  # Step 1: delete wait gap if > 10 frames
  local shift=0
  if $needs_trim && [[ "$wait_gap" -gt 10 ]] && [[ "$first_response" -gt 0 ]]; then
    local gap_start=$((enter_frame + 1))
    local gap_end=$((first_response - 1))
    gifsicle "$gif" --delete "#${gap_start}-${gap_end}" -o "$tmp" 2>/dev/null || true
    shift=$((gap_end - gap_start + 1))
    cp "$tmp" "$gif"
    total=$((total - shift))
    last_content=$((last_content - shift))
    keep_until=$((last_content + 50))
    if [[ "$keep_until" -ge "$((total - 1))" ]]; then
      keep_until=$((total - 1))
    fi
  fi

  # Step 2: trim trailing idle
  if $needs_trim && [[ "$keep_until" -lt "$((total - 2))" ]]; then
    local del_start=$((keep_until + 1))
    local del_end=$((total - 1))
    gifsicle "$gif" --delete "#${del_start}-${del_end}" -o "$tmp" 2>/dev/null || true
    cp "$tmp" "$gif"
  fi

  # Step 3: set delays
  local new_total
  new_total=$(gifsicle --info "$gif" 2>&1 | head -1 | grep -o '[0-9]* images' | awk '{print $1}')
  local new_last=$((new_total - 1))

  if [[ "$enter_frame" -ge "$new_total" ]]; then
    enter_frame=$((new_total - 2))
  fi
  local ef_next=$((enter_frame + 1))
  if [[ "$ef_next" -gt "$((new_last - 1))" ]]; then
    ef_next=$((new_last - 1))
  fi

  if [[ "$new_last" -gt "$ef_next" ]]; then
    gifsicle "$gif" \
      -d4 "#0-${enter_frame}" \
      -d30 "#${enter_frame}" \
      -d4 "#${ef_next}-$((new_last - 1))" \
      -d500 "#${new_last}" \
      -o "$tmp" 2>/dev/null || true
    mv "$tmp" "$gif"
  fi

  rm -f "$tmp"

  local new_size
  new_size=$(ls -lh "$gif" | awk '{print $5}')
  echo -e "  ${GREEN}done${NC}  ${name}  ${DIM}(${new_size})${NC}"
  return 0
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
  echo "No GIFs found matching '${FILTER}'"
  exit 1
fi

echo -e "${BOLD}Post-processing ${#gifs[@]} GIFs...${NC}"
echo ""

for gif in "${gifs[@]}"; do
  process_gif "$gif"
done

echo ""
