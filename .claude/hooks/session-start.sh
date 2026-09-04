#!/bin/bash
# SessionStart hook: installs everything this app needs to run in a
# Claude Code on the web session — the system packages behind narration
# (espeak-ng) and subtitle rendering (a CJK font), plus npm dependencies.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

apt_packages_present() {
  command -v espeak-ng >/dev/null 2>&1 || return 1
  # Capture fc-list's output first (rather than piping it live into grep -q)
  # so grep exiting early can't SIGPIPE fc-list under `set -o pipefail`.
  local fonts
  fonts=$(fc-list 2>/dev/null || true)
  grep -qi "noto sans cjk" <<< "$fonts"
}

if ! apt_packages_present; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends espeak-ng fonts-noto-cjk
fi

npm install --no-audit --no-fund
