#!/bin/bash
# usage: run.sh <scenario.json> <prompt> [cwd] [extra claude args...]
set -u
ROOT="${CC_WORK:-$(cd "$(dirname "$0")/../../.work" && pwd)}"
SC="$1"; PROMPT="$2"; CWD="${3:-$ROOT/scratch}"; shift 3 || true
cp "$SC" "$ROOT/capture/scenario.json"
export ANTHROPIC_BASE_URL="${CC_MOCK:-http://127.0.0.1:8790}"
export ANTHROPIC_API_KEY=sk-ant-api03-dummy
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_AUTOUPDATE=1
export HOME="$ROOT/home" USERPROFILE="$ROOT/home"
cd "$CWD" || exit 1
timeout 180 "${CC_BIN:-$ROOT/bin/package/claude.exe}" --print "$PROMPT" "$@" 2>&1 | head -60
