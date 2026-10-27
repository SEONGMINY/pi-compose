# Reference-led Pi Compose redesign — implementation and verification record

Date: 2026-10-27
Branch: `feat/reference-led-core` (branched from PR #3; independent new Draft PR should target `feat/task-hub-ghostty`).
Source of truth: [reference-led contract](../REFERENCE_LED_DESIGN.md). This document records work performed and remaining acceptance gates. **An unexecuted test is not a PASS.**

## Reference and implementation trace

| Reference observation | Code | Actual behavior implemented | Status |
|---|---|---|---|
| Kiro `/spawn` takes a task without requiring every configuration choice | `src/delegation-defaults.ts`, `extensions/compose.ts` | Current exact Pi session Fork + Worktree + suggested branch is the default. Pi confirms before spawning; advanced choices still independent | SOURCE REVIEWED; MACOS NOT_RUN |
| Orca task → isolated Worktree → review | `src/launch.ts`, `src/task-index.ts`, `src/review.ts`, `extensions/task-hub.ts` | Record the approved Git base, inspect the matching Worktree/branch, display status + diff without Handoff | SOURCE REVIEWED; ACTUAL GIT REVIEW NOT_RUN |
| Orca differentiates terminal dispatch and prompt consumption | `src/diagnostics.mjs`, `extensions/task-hub.ts` | Separate dispatch, Child Pi session link, `parentSession` match, observed agent run | SOURCE REVIEWED; MODEL PROMPT PROCESSING NOT_RUN |
| Kiro Crew Monitor and Orca Jump Palette keep running agents separate from saved chats | `extensions/task-hub.ts`, `extensions/work-return.ts` | Native Pi select opens exact Child or originating Main; Pi SessionManager is used for old conversations | SOURCE REVIEWED; TMUX NAVIGATION NOT_RUN |
| Pi official session and `--fork`; workmux source-root limitation | `src/launch.ts`, `src/task-index.ts`, `extensions/task-hub.ts` | For subdir source use Git Worktree creation and exact `pi --fork <source file>` in tmux; for repo-root source keep workmux | SOURCE REVIEWED; REAL FORK NOT_RUN |

Reference sources:
- [Kiro CLI slash commands](https://kiro.dev/docs/cli/reference/slash-commands/); [Kiro Terminal UI](https://kiro.dev/docs/cli/terminal-ui/)
- [Orca Worktrees](https://www.onorca.dev/docs/model/worktrees); [Orca Jump Palette](https://www.onorca.dev/docs/model/quick-open)
- [Orca prompt delivery source](https://github.com/stablyai/orca/blob/main/src/main/agent-launch/agent-launch-prompt-delivery.ts)
- [Pi sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md); [Pi session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md); [workmux add](https://workmux.dev/reference/commands/add/).

## Verification carried out

- PASS — latest PR #2/#3 branch metadata inspected before branching. No force push, reset, merge or branch deletion.
- PASS — docs/PRD, TRD, ARCHITECTURE, earlier domain stories, current Launch, Task Hub, TaskRecord, navigation, diagnostic code reviewed for design constraints.
- PASS — official Kiro and Orca docs reviewed; Orca prompt-delivery implementation and Pi official session docs read.
- PASS — source consistency check confirms default launch, advanced settings, exact parentSession linkage, Git review, child navigation and diagnostic events are wired in source.
- PASS — Node 22.16.0 is available in the analysis container, Git available, but **does not satisfy project Node >=22.19.0**, and no Pi/workmux/tmux binaries or project node_modules are installed in the analysis container.
- NOT_RUN — full `npm run typecheck` (project dependencies unavailable).
- NOT_RUN — all new/changed Unit Tests (no full checkout with dependencies in the execution environment).
- NOT_RUN — GitHub Actions and end-to-end tests, intentionally not invoked.
- NOT_RUN — macOS authenticated Pi prompt processing, original Main context reasoning, tmux/workmux/Ghostty, UI discovery and all acceptance A–G.

Do not present source inspections or newly written test files as proof the code passes tests. This branch stays Draft until the verified runtime checks are performed.

## New unit tests added / updated (not executed)

- `test/delegation-defaults.test.ts`: branch suggestion, default launch and independent options.
- `test/review.test.ts`: actual local Git repo diff/branch guard and legacy base warning.
- `test/compose.test.ts`: a quick slash delegation goes straight to approval; nested directory source plans Git + exact Pi --fork without invoking new processes at planning time.
- `test/task-hub.test.ts`: native fallback task identity with and without live tmux window.
- Existing session finder, diagnostics and Handoff tests are retained; old code paths may require extra test updates in CI.

## Safety and recovery review

- Cancel approval: no Worktree or Agent should exist.
- Plan failure: read-only Git preflight and source JSONL inspection; no resource changes.
- Native nested Fork: first Git Worktree creation, then tmux Pi spawn. If Git preparation succeeds and tmux spawn fails, Worktree remains intact for user inspection. This is intentional **no implicit cleanup** behavior.
- Native Fork status: Pi Session ID and `parentSession` are verified separately. `agent_start`/settled only prove an observed model run, not original prompt comprehension.
- Git diff is read-only and scoped to exact checked-out branch. Untracked files appear in status but their body is not part of tracked diff. Large output is truncated.
- Existing legacy TaskRecord data can still be read; missing base SHA results in a clearly marked limited HEAD review.

## macOS handoff

```bash
# Use a disposable repository to verify these behaviors
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/feat/reference-led-core/scripts/install.sh \
  | PIC_COMPOSE_REF=feat/reference-led-core bash
pic doctor
cd ~/projects/my-app
pic
```

1. In Pi, `/login` and `/model`; discuss explicit forbidden changes in Main.
2. `/compose` → current conversation Fork + Worktree → task → inspect one confirmation → approve.
3. Check actual Child Pi session and whether `parentSession` points to the approved Main, whether a Pi turn starts and receives the instruction; do **not** infer model comprehension from the log.
4. `/compose` switch to exact agent and Main, then inspect the actual new Git changes without Handoff.
5. `/compose sessions` to a prior saved session and back using Pi's own session facilities.
6. Repeat from a nested directory. Force a Git/tmux failure and verify no resource is deleted and no unconfirmed claim is shown.
7. Export `pic diagnostics export --days 1` and inspect `launch.agent_linked`, `launch.context_linked`, `launch.agent_started` separately.

## Known limitations

- For large patches, the execution adapter captures a bounded amount of stdout; reviewers should open the Git pager for the authoritative full diff. Do not treat truncated inline output as a complete code review.
- Legacy tasks without source path/base SHA cannot retroactively prove Fork parent or compare all commits since original creation.
- The reference product UX is supported by cited documentation and source; their internal design rationale and effectiveness data are not public here. Pi Compose UX gains still require actual human use testing.
- A full macOS acceptance run has **not** been conducted and therefore the product is **not certified as ready for production development**.
