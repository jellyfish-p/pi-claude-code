#!/usr/bin/env bash
# Compatibility: run.sh <scenario.json> <prompt> [cwd] [extra claude args...]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if (( $# < 2 )); then
  echo 'usage: run.sh <scenario.json> <prompt> [cwd] [extra claude args...]' >&2
  exit 1
fi
SCENARIO="$1"; PROMPT="$2"; shift 2
ARGS=(--scenario "$SCENARIO" --prompt "$PROMPT")
if (( $# > 0 )) && [[ "$1" != --* ]]; then ARGS+=(--cwd "$1"); shift; fi
if [[ -n "${CC_OUT:-}" ]]; then ARGS+=(--out "$CC_OUT"); fi
for ARG in "$@"; do ARGS+=("--arg=$ARG"); done
exec node "$SCRIPT_DIR/capture.mjs" "${ARGS[@]}"
