# ADR 0008 — One-time, consent-based Pi Compose setup

- Status: **Accepted for PR #3** (2026-10-26)
- Supersedes only the *startup behavior* of [ADR 0005](0005-pic-entry-and-pi-settings.md) and the *post-install onboarding* of [ADR 0006](0006-github-installer.md).
- Preserves: Pi as the source of truth, user-controlled changes, no custom plugin registry, no silent changes to other agents, no Git/worktree/session mutations.

## Problem

The existing installation prepared `pic` and its CLI dependencies but required users to discover `pic navigation enable`, `pic features`, and `workmux setup` separately. The feature set shipped but the happy path did not.

Pi's package manager supports local packages and per-resource filters. `pi install` writes to Pi's own global settings, and `pi config` can disable a previously installed package resource. `workmux setup` may change **other agent settings** in addition to Pi Hook configuration.

## Decision: single Recommended configuration, no template picker

1. The official `scripts/install.sh` resolves **main** by default and can explicitly resolve a development branch with `PIC_COMPOSE_REF`. The guarded branch installer and direct Git SHA npm installs supply the same `pic` executable. npm `postinstall` is **not used** (direct install uses `--ignore-scripts`).
2. The first **bare interactive** `pic` call checks existing Pi package declarations and workmux Pi status Hook read-only. If setup is missing, explain the scope and offer **one consent prompt**. Noninteractive Pi flags/CLI invocations never prompt.
3. After user consent, install only missing Navigation and Handoff/Verify packages using Pi's official `pi install`. Existing user/global **or project-only** packages and their customized resource filters are left untouched. Project-only resources may not automatically exist in a separate Git Worktree; users can explicitly choose a global install if needed. No scripts modify Pi's JSON config directly.
4. `workmux setup` is offered with **its own opt-in** and is run interactively only after user confirmation. The user still chooses actions inside workmux. It may configure other detected agents; never run it silently.
5. Only **one small onboarding acknowledgement** is stored in `<Pi agent dir>/compose/onboarding-v1.json (default ~/.pi/agent/compose/onboarding-v1.json)` (scoped to the Pi user environment) to avoid prompting on every launch. This is **not** the registry for installed features. Pi settings and the workmux Hook itself are inspected each time `pic doctor` or `pic setup` runs. If declined, the user can opt in later with `pic setup`. Updates do not reset this acknowledgement.
6. `pic doctor` performs read-only diagnostics. `pic setup` can safely reconcile missing pieces on demand, without overwriting existing enabled/disabled resource selections. `pic config`, `pic navigation disable` and `pi remove` remain the opt-out paths.
7. A failed install step reports exactly which step failed. Already successfully installed packages are left in place; `pic setup` retries missing stages. A status Hook cannot be guaranteed just because the `workmux setup` process exits successfully: its presence is re-inspected.
8. Interactive `pic` continues even when optional initial setup could not be completed; core launch does not require optional Extensions. `/reload` is needed for **Pi processes already running** when global extensions are changed; new Pi processes read the current settings automatically.

## Why not presets?

Recommended/Minimal/Custom would make a small personal Harness feel like a separate product settings manager. One recommended default plus Pi's existing `pi config` is cheaper to explain and maintain. For a minimal installation, decline first-run setup and use the base Launch; opt in later without changing the original choice silently.

## Safety and limitations

- The package detector identifies locally configured Pi packages by **exact resolved path**. Pi's resource filters may be more complex than simple package membership; `pic doctor` reports custom filters and directs users to `pi config`, not a false active guarantee.
- The workmux Hook detector checks a known Pi Extension file or explicit resource declaration; it cannot independently prove the Hook executed or is currently sending status.
- The one-time acknowledgement is only a prompt preference. It does not override Pi's settings or force previously disabled components back on after updates. The user's separate `pic setup` command is always available.
- A first-run setup is not executed for headless launches or `pic --print`; run `pic setup` interactively for those environments.
- No automatic upgrade to Pi, workmux or tmux is performed beyond the *existing* macOS install script's handling of missing binaries.

See [Setup and diagnostics](../SETUP.md) and [full task scenarios](../SCENARIOS.md).