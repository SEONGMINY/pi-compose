#!/usr/bin/env bash
# macOS installer for Pi Compose. Re-run the same command to update Pi Compose.
# Does not mutate Pi settings, agent sessions, shell startup files, or existing Pi.
set -euo pipefail

REPOSITORY="https://github.com/SEONGMINY/pi-compose.git"
PACKAGE_URL="git+https://github.com/SEONGMINY/pi-compose.git"

info() { printf '[pico] %s\n' "$*"; }
fail() { printf '[pico] Error: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer currently supports macOS only."

# curl | bash provides no interactive input; never prompt for sudo or rewrite a shell rc.
has git || fail "Git is required. Install Xcode Command Line Tools (xcode-select --install), then retry."
has curl || fail "curl is required."
has awk || fail "awk is required."

node_compatible() {
  has node || return 1
  node -e '
    const parts = process.versions.node.split(".").map(Number);
    process.exit(parts[0] > 22 || (parts[0] === 22 && parts[1] >= 19) ? 0 : 1);
  ' >/dev/null 2>&1
}

# Homebrew already supplies dependency resolution and native macOS packages.
# Do not install Homebrew implicitly or change a Node version-manager configuration.
if ! node_compatible || ! has tmux || ! has workmux; then
  has brew || fail "Homebrew is required to prepare missing Node.js, tmux or workmux. Install Homebrew from https://brew.sh, then rerun this command. No settings were changed."
fi

if ! node_compatible; then
  if has node; then
    info "Found Node.js $(node --version), but Pi Compose requires Node.js >= 22.19.0."
    fail "Select a compatible Node.js with your existing version manager, or upgrade Node.js before retrying. The installer will not replace an existing Node.js."
  fi
  info "Installing Node.js with Homebrew."
  brew install node
  node_compatible || fail "Node.js is still unavailable. Ensure Homebrew's bin directory is on PATH, then rerun."
fi

has npm || fail "npm is not on PATH even though Node.js is present. Check your Node.js installation."

# Do not reinstall or update an existing Pi, regardless of its installation method.
if has pi; then
  info "Existing Pi detected. Leaving Pi and its settings unchanged."
else
  info "Installing the official Pi npm package (Pi not found)."
  npm install -g --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent
  has pi || fail "Pi was installed but is not on PATH. Check npm global bin directory before retrying."
fi

if ! has tmux; then
  info "Installing tmux with Homebrew."
  brew install tmux
fi

if ! has workmux; then
  info "Installing workmux with Homebrew."
  brew install workmux
fi

has tmux || fail "tmux is not available after installation."
has workmux || fail "workmux is not available after installation."

# Pin this installation to one exact Git commit. Do not rely on npm reusing a
# cached main-branch clone when the same installer is run for an update.
info "Resolving the current Pi Compose commit."
revision="$(git ls-remote "$REPOSITORY" HEAD | awk 'NR == 1 { print $1 }')"
case "$revision" in
  ''|*[!0-9a-fA-F]*) fail "Could not resolve a valid Pi Compose commit from GitHub." ;;
esac
[ "$(printf '%s' "$revision" | wc -c | tr -d ' ')" -eq 40 ] || fail "GitHub returned an unexpected commit ID."
short_revision="$(printf '%.12s' "$revision")"

info "Installing Pi Compose at $short_revision with npm."
npm install -g --ignore-scripts --no-audit --no-fund "$PACKAGE_URL#$revision"

# npm owns the global executable symlink. Don't edit PATH or shell rc.
hash -r
has pico || fail "Pi Compose was installed but 'pico' is not on PATH. Check 'npm config get prefix' and its bin directory. Shell settings were not changed."

# The wrapper forwards this to existing Pi; no model login or agent creation.
pico --version >/dev/null || fail "'pico' is installed but could not launch Pi."

info "Pi Compose installed successfully at $short_revision."
info "Open any project directory and run: pico"
info "To update Pi Compose, rerun the same install command."
info "Existing Pi, Pi settings, sessions and optional feature selections were not changed."
