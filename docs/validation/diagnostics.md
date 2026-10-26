# UX diagnostics — implementation and manual verification

Branch: \`feat/task-hub-ghostty\`. **GitHub Actions and E2E were not executed** as requested.

## Static/synthetic checks

- Shared event module \`src/diagnostics.mjs\` evaluated in isolated V8 without filesystem dependencies: **PASS** for event allowlist and synthetic metric computation.
- Synthetic path/prompt/token fields fed to \`safeData\`: **PASS**, omitted from serialized measurement.
- Synthetic flow \`launch.started → launch.approval → launch.finished\`, \`navigation.opened → navigation.finished(no_selection)\`, \`switch.started → switch.finished(failure)\`: aggregation calculated correctly.
- Test source added in \`test/diagnostics.test.mjs\` for file permissions, event persistence, JSON report generation, disabled collection, clearing, synthetic metrics. The new test file has not been executed in the actual Pi Compose repository environment.
- App-specific code paths are instrumented in \`extensions/compose.ts\`, \`extensions/task-hub.ts\`, \`extensions/work-return.ts\`, Child Navigation, optional Handoff and Verify, and \`bin/setup.mjs\`. Code-level insertion does not prove each event was emitted at runtime.

## Test cases to run on macOS (not yet executed)

| Scenario | Observed result expected | Status |
| --- | --- | --- |
| Install PR #3 with existing Pi user settings | Navigation/Handoff/Verify prepared automatically if not explicitly disabled | NOT_RUN |
| First bare \`pic\` after clean install | Core setup without package prompts; notice about local diagnostics | NOT_RUN |
| workmux Hook missing | Separate permission to run official \`workmux setup --hooks\`, no shared config changes until consent | NOT_RUN |
| Previously excluded Pi resource | Re-run must not re-enable previous user exclusion | NOT_RUN |
| Cancel Fork Worktree delegation | \`launch.started\`, \`launch.approval cancelled\`, \`launch.finished cancelled\`; no new Agent/Worktree | NOT_RUN |
| Approve Fork Worktree delegation | Launch dispatch success; Child Pi session link reported only when verified | NOT_RUN |
| Open /compose then Esc | \`navigation.opened\`, no-selection \`navigation.finished cancelled\` | NOT_RUN |
| Select Agent/return to Main | \`navigation.selected\`, \`switch.started\`, \`switch.finished\` with accepted tmux outcome | NOT_RUN |
| Open result without Handoff | \`result.unavailable\`; does not imply full result was read | NOT_RUN |
| Save Pi session and resume | \`sessions.opened\`, \`switch.started\`, \`switch.finished\`, \`sessions.finished\` | NOT_RUN |
| Perform Handoff → Verify | \`handoff.finished\`, \`verify.finished\` only after actual attempt; no Git auto merge | NOT_RUN |
| Export once | One 0600 JSON report includes ordered events, summary metrics and known limitations | NOT_RUN |
| Disable diagnostics | Subsequent event count remains unchanged | NOT_RUN |
| Purge diagnostics | Removes local native event files and default exports; external chosen exports remain | NOT_RUN |
| Narrow terminal and Korean instruction | No overlapping text, confirms and picker readable | NOT_RUN |
| Pi internal command unknown to Compose | Must be documented as unobserved; never count non-discovery as observed | NOT_RUN |

## Interpret outcomes safely

\`launch.finished(success)\` means the **launch command returned**. It does not prove the Child Pi model became ready.

\`switch.finished(success)\` means the tmux/Pi operation returned success. It does not establish that the user visually recognized the target.

\`result.opened\` means the modal opened; not that the user reviewed or agreed with its contents.

No real-user telemetry exists in this commit. Until the user runs Pi Compose, exports a report and supplies it, any usability hypothesis remains unconfirmed.

Run \`pic diagnostics export\` and upload the generated file for a first evidence-based UX investigation.
