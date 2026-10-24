#!/usr/bin/env bash
# Pi Compose Phase 0: non-destructive environment + isolated Git worktree preflight.
# No package installation, no network requests, no changes outside a temporary directory.
set -euo pipefail

missing=0
check_tool() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'FOUND %-8s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'MISSING %s\n' "$tool"
    missing=1
  fi
}

printf '%s\n' '== Required executables =='
for tool in git node pi workmux tmux; do check_tool "$tool"; done
if command -v node >/dev/null 2>&1; then
  printf 'Node.js %s\n' "$(node --version)"
  if node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || (major===22 && minor>=19) ? 0 : 1)' ; then
    printf '%s\n' 'PASS Pi 1.4.0 Node.js engine requirement (>=22.19.0)'
  else
    printf '%s\n' 'INCOMPATIBLE Node.js <22.19.0 (Pi 1.4.0 requires >=22.19.0)'
    missing=1
  fi
fi

printf '\n%s\n' '== Version information =='
for tool in git pi workmux tmux; do
  if command -v "$tool" >/dev/null 2>&1; then
    case "$tool" in
      git) git --version ;;
      tmux) tmux -V ;;
      *) "$tool" --version ;;
    esac
  fi
done

printf '\n%s\n' '== Isolated Git worktree + change-discovery smoke test =='
if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' 'SKIP Git smoke test (git missing)'
  exit 2
fi

scratch="$(mktemp -d "${TMPDIR:-/tmp}/pi-compose-phase0.XXXXXX")"
cleanup() { rm -rf -- "$scratch"; }
trap cleanup EXIT
repo="$scratch/source"
worktree="$scratch/feature"
mkdir -p "$repo"
git -C "$repo" init -q
printf 'original\n' > "$repo/contract.txt"
git -C "$repo" add contract.txt
git -C "$repo" -c user.name='Pi Compose Test' -c user.email='pi-compose@example.invalid' -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm 'test: seed isolated repo'
base="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" worktree add -q -b feat/phase0 "$worktree" "$base"
# Deliberately create staged, unstaged, and untracked changes in the isolated worktree.
printf 'staged\n' >> "$worktree/contract.txt"
git -C "$worktree" add contract.txt
printf 'unstaged\n' >> "$worktree/contract.txt"
printf 'untracked\n' > "$worktree/new.txt"

git -C "$repo" worktree list --porcelain | grep -Fq "worktree $worktree"
test "$(cat "$repo/contract.txt")" = 'original'
test -z "$(git -C "$repo" status --porcelain)"
git -C "$worktree" diff "$base" --name-only | grep -qx 'contract.txt'
git -C "$worktree" diff --cached --name-only | grep -qx 'contract.txt'
git -C "$worktree" diff --name-only | grep -qx 'contract.txt'
git -C "$worktree" ls-files --others --exclude-standard | grep -qx 'new.txt'
git -C "$worktree" diff --check
git -C "$worktree" diff --cached --check
printf '%s\n' 'PASS Isolated Worktree creation preserves the source checkout'
printf '%s\n' 'PASS Base SHA, staged, unstaged and untracked changes discovered'
printf '%s\n' 'PASS Git diff --check (staged + unstaged)'

printf '\n%s\n' '== Result =='
if (( missing )); then
  printf '%s\n' 'BLOCKED Real Pi/workmux/tmux integration requires missing tools or compatible Node.js.'
  printf '%s\n' 'See docs/validation/phase0-baseline.md for safe manual integration scenarios.'
  exit 2
fi
printf '%s\n' 'READY Prerequisites and isolated Git checks passed; real integration still needs a separate smoke test.'
