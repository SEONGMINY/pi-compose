# One-time installation and setup — verification record

Branch: `feat/task-hub-ghostty`, PR #3. Date: 2026-10-26 (KST).

## Verified in this change

- Reviewed `scripts/install.sh`, `bin/pic.mjs`, Pi package declarations and official Pi package manager implementation.
- Both official main and guarded PR #3 installation resolve a Git commit and call `npm install -g --ignore-scripts`. No npm postinstall writes Pi settings.
- First bare interactive `pic` checks existing global and project Pi package paths before automatically preparing missing first-party packages. The workmux Hook requires separate permission. `pic --version`, direct Pi options, noninteractive calls and `pic doctor` do not request setup.
- External Hook opt-outs and previous onboarding choices are remembered. Already registered Pi package resources (including customized filters) are preserved. Project-only package declarations are not silently promoted to global scope.
- `workmux setup` is opened only after a separate opt-in and remains the official interactive configuration interface. Hook file detection is not claimed as proof of an actively reporting Agent.
- Static V8 parse of the new `bin/setup.mjs` and revised `bin/pic.mjs`: PASS after stripping module imports for static parsing, **not running them in an installed Pi environment**.
- Isolated local sample setup-status logic: PASS for missing package detection, existing configured/custom resources, workmux Hook presence and no modifications to an existing Pi settings file.
- New `test/setup.test.ts` source covers global package filters, malformed settings and project-only package detection. **Not run in the GitHub project checkout**.

## Not run (do not mark accepted)

**GitHub Actions and E2E were explicitly prohibited and not executed.** The following manual checks also remain unverified because this session cannot install the remote GitHub npm dependency into the user's actual macOS/Pi/workmux environment.

| Manual scenario | Expected behavior | Current status |
| --- | --- | --- |
| New macOS user runs main installer | Dependency checks preserved; after PR merge first `pic` auto-configures missing core packages | NOT_RUN |
| New macOS user runs PR #3 guarded installer | Explicit branch SHA resolved; missing binaries protected by installer | NOT_RUN |
| Direct Git SHA npm install | `--ignore-scripts` succeeds with prerequisites already installed; first `pic` auto-configures core | NOT_RUN |
| First `pic` | Missing Navigation and Handoff/Verify installed automatically via Pi, no package approval prompt or duplicates | NOT_RUN |
| First `pic`, decline external workmux Hook | Internal core packages installed; Hook remains absent; second `pic` does not prompt repeatedly | NOT_RUN |
| Partial Pi packages, user resource exclusions | Existing packages and per-resource settings unchanged | NOT_RUN |
| Custom `PI_CODING_AGENT_DIR` | Consent and setting scans use selected Pi profile | NOT_RUN |
| Project-only `.pi/settings.json` | Local source not duplicated globally; Worktree scope limitation shown | NOT_RUN |
| Workmux Hook opt-in | `workmux setup` own confirmation is displayed, user can select Pi only | NOT_RUN |
| Workmux Hook opt-out | No hook setup, `/compose monitor` still opens but status may be empty | NOT_RUN |
| Existing Child Pi after feature install | `/reload` or restart loads globally enabled Navigation/Handoff | NOT_RUN |
| Update after manual opt-out | No automatic re-enable or repeated initial prompt | NOT_RUN |
| Setup interrupted after Navigation install | Retry installs only missing Handoff/Verify and/or Hook | NOT_RUN |
| Simultaneous first run in two terminals | Concurrent setup is not yet guaranteed serialized; do not run setup in parallel | NOT_RUN |
| Another `pic` binary exists | Guarded installer aborts without overwriting unrelated command | NOT_RUN |

## How to manually verify

1. Back up relevant `~/.pi/agent/settings.json` and any modified workmux config. Do not experiment on an unsaved Worktree.
2. Use a dedicated disposable Pi agent directory (Pi supports `PI_CODING_AGENT_DIR`) and temporary Git repository for fresh install tests. Verify `pic doctor` before and after setup.
3. Run the **guarded PR #3 installer** from [SETUP](../SETUP.md). Confirm versions and existing CLI preservation.
4. Run `pic`, accept recommended Pi Packages; inspect `pi list` and `pi config`. If workmux Hook is chosen, inspect its interactive choices before accepting.
5. Start a *new* Worktree Agent and check `/compose` and `/compose-handoff` command registration. Existing Child Pi should require `/reload`.
6. Use `pi config` to disable Verify, run the installer again, and confirm it is not re-enabled.
7. Test `pic setup` after declining or partial setup. Use `pic doctor` to inspect missing vs customized resources.
8. Finally perform the actual Main → Fork/Independent → Agent → workmux Dashboard → Handoff/Verify → Main workflow described in [SCENARIOS](../SCENARIOS.md).

A passing static parse or package declaration inspection is **not a substitute** for these real terminal and model-backed checks.
