#!/bin/bash
# record.sh -- Orchestrator for bray GIF demo recordings
# Usage:
#   ./record.sh                 Record all demos (skip existing GIFs)
#   ./record.sh --force         Re-record everything
#   ./record.sh --stories       Record only story demos
#   ./record.sh --solo          Record only solo demos
#   ./record.sh <name>          Record a single demo by name (partial match)
#   ./record.sh --list          List all tapes with recording status
#   ./record.sh --optimise      Optimise existing GIFs with gifsicle
#   ./record.sh --postprocess   Post-process GIFs (remove wait, add 5s hold)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TAPES_DIR="tapes"
GIFS_DIR="gifs"
FORCE=false
FILTER=""
MODE="all"  # all, stories, solo, single, list, optimise

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)   FORCE=true; shift ;;
    --stories) MODE="stories"; shift ;;
    --solo)    MODE="solo"; shift ;;
    --list)    MODE="list"; shift ;;
    --optimise|--optimize) MODE="optimise"; shift ;;
    --postprocess) MODE="postprocess"; shift ;;
    --help|-h)
      head -8 "$0" | tail -7 | sed 's/^# //'
      exit 0
      ;;
    *)
      MODE="single"
      FILTER="$1"
      shift
      ;;
  esac
done

# Colours
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# Check dependencies
check_deps() {
  if ! command -v vhs &>/dev/null; then
    echo -e "${RED}Error: vhs not found. Install with: brew install vhs${NC}"
    exit 1
  fi
}

# Collect tape files based on mode
collect_tapes() {
  local tapes=()
  case "$MODE" in
    all|list)
      tapes+=($(find "$TAPES_DIR/stories" -name '*.tape' 2>/dev/null | sort))
      tapes+=($(find "$TAPES_DIR/solo" -name '*.tape' 2>/dev/null | sort))
      ;;
    stories)
      tapes+=($(find "$TAPES_DIR/stories" -name '*.tape' 2>/dev/null | sort))
      ;;
    solo)
      tapes+=($(find "$TAPES_DIR/solo" -name '*.tape' 2>/dev/null | sort))
      ;;
    single)
      tapes+=($(find "$TAPES_DIR" -name "*${FILTER}*.tape" 2>/dev/null | sort))
      ;;
  esac
  echo "${tapes[@]+"${tapes[@]}"}"
}

# Extract GIF name from tape path: tapes/stories/01-foo.tape -> 01-foo
tape_to_name() {
  basename "$1" .tape
}

# Check if GIF exists for a tape
gif_exists() {
  local name
  name=$(tape_to_name "$1")
  [[ -f "$GIFS_DIR/${name}.gif" ]]
}

# List mode
list_tapes() {
  local tapes
  tapes=($(collect_tapes))
  local total=${#tapes[@]}
  local recorded=0

  echo -e "${BOLD}Demo tapes: ${total} total${NC}\n"

  for tape in "${tapes[@]}"; do
    local name
    name=$(tape_to_name "$tape")
    if gif_exists "$tape"; then
      local size
      size=$(ls -lh "$GIFS_DIR/${name}.gif" | awk '{print $5}')
      echo -e "  ${GREEN}recorded${NC}  ${name}  ${DIM}(${size})${NC}"
      ((recorded++))
    else
      echo -e "  ${YELLOW}pending${NC}   ${name}"
    fi
  done

  echo -e "\n${GREEN}${recorded}${NC} recorded, ${YELLOW}$((total - recorded))${NC} pending"
}

# Optimise GIFs with gifsicle
optimise_gifs() {
  if ! command -v gifsicle &>/dev/null; then
    echo -e "${RED}Error: gifsicle not found. Install with: brew install gifsicle${NC}"
    exit 1
  fi

  local gifs=($(find "$GIFS_DIR" -name '*.gif' | sort))
  local total=${#gifs[@]}
  local i=0

  echo -e "${BOLD}Optimising ${total} GIFs...${NC}\n"

  for gif in "${gifs[@]}"; do
    ((i++))
    local name
    name=$(basename "$gif")
    local before
    before=$(stat -f%z "$gif")

    gifsicle --batch -O3 --lossy=80 "$gif" 2>/dev/null

    local after
    after=$(stat -f%z "$gif")
    local saved=$(( (before - after) * 100 / before ))
    echo -e "  [${i}/${total}] ${name}  ${DIM}${saved}% smaller${NC}"
  done
}

# Record a single tape
record_tape() {
  local tape="$1"
  local name
  name=$(tape_to_name "$tape")

  echo -e "  ${BOLD}Recording:${NC} ${name}"

  # Run VHS (it reads Output directive from the tape)
  if vhs "$tape" 2>/dev/null; then
    if [[ -f "$GIFS_DIR/${name}.gif" ]]; then
      # Post-process: remove wait frames, add 5s hold
      "$SCRIPT_DIR/postprocess.sh" "$name" 2>/dev/null
      local size
      size=$(ls -lh "$GIFS_DIR/${name}.gif" | awk '{print $5}')
      echo -e "  ${GREEN}Done${NC} ${DIM}(${size})${NC}"
      return 0
    else
      echo -e "  ${RED}GIF not found after recording${NC}"
      return 1
    fi
  else
    echo -e "  ${RED}VHS failed${NC}"
    return 1
  fi
}

# Main recording loop
record_all() {
  check_deps
  mkdir -p "$GIFS_DIR"

  local tapes
  tapes=($(collect_tapes))
  local total=${#tapes[@]}

  if [[ $total -eq 0 ]]; then
    echo -e "${YELLOW}No tapes found matching criteria.${NC}"
    exit 1
  fi

  local recorded=0
  local skipped=0
  local failed=0
  local i=0

  echo -e "${BOLD}Recording ${total} demos...${NC}\n"

  for tape in "${tapes[@]}"; do
    ((i++))
    local name
    name=$(tape_to_name "$tape")

    if ! $FORCE && gif_exists "$tape"; then
      echo -e "  ${DIM}[${i}/${total}] Skip: ${name} (already recorded)${NC}"
      ((skipped++))
      continue
    fi

    echo -e "\n  [${i}/${total}]"
    if record_tape "$tape"; then
      ((recorded++))
    else
      ((failed++))
    fi
  done

  echo -e "\n${BOLD}Summary:${NC}"
  echo -e "  ${GREEN}${recorded}${NC} recorded, ${DIM}${skipped}${NC} skipped, ${RED}${failed}${NC} failed"
}

# Dispatch
case "$MODE" in
  list)        list_tapes ;;
  optimise)    optimise_gifs ;;
  postprocess) "$SCRIPT_DIR/postprocess.sh" "$FILTER" ;;
  *)           record_all ;;
esac
