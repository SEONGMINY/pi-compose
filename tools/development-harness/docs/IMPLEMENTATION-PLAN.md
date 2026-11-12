# Development harness implementation status

## Current JSON contract gate (2026-11-11)

- Machine-readable approved scope: [`../contracts/pi-compose-maintenance.json`](../contracts/pi-compose-maintenance.json).
- New Task pins scope identity/version/hash before implementation. `devh contract` and `devh task ID` expose current contract and individual Task evidence as JSON.
- Worker records `scopeGate` independently of functional acceptance. Contract/policy edits prevent automatic completed status and auto-improvement; running candidate and direct improve paths recheck scope.
- Installer excludes only the generated local config/Hook files through Git's private exclude, and the Task records their digests to detect hidden setting changes. Existing installations need one additional `devh install .` to apply that local exclude policy.
- Unit/synthetic Git tests cover policy modification, contract drift, approved path protection, missing/dirty baselines, candidate blocking and JSON view. These do **not** verify authenticated workstation Hooks or complete semantic requirements.

## Implemented in current iteration

1. **Step acceptance evidence**: project-owner exact criterion/check bindings, worker-issued command/exit receipts, immutable plan extensions, no model-originated self-attestation. Generic project checks alone do not mark a task semantically complete.
2. **Task/Step boundaries**: conservative continuation detector, new-target detection, parent/rework relation, immutable pre-work forecast, scope-change history. Numbered requirements alone do not force Step creation.
3. **Provider adapters**: Pi custom-run guard, stable message timestamp ID fallback, Codex agent-specific attempt pairing and outcome reporting, explicit SessionEnd installation, recursive improvement-run exclusion. Synthetic Codex end-to-end and event contracts tested.
4. **Durable work**: retryable verification queue, stale worker recovery, review-model backoff, acknowledgement only after persisted receipts, accepted improvements not repeated.
5. **Improvement loop**: evidence validation, cost-aware layer selection and worktree change engine adapted from Draft PR #29. Generated candidates create an improvement queue item; optional automatic execution requires local explicit allowlist policy and passes fixed checks/independent model verification. Local-main requires explicit opt-in and can only fast-forward locally.
6. **Directional impact feedback**: record pre-work Git revisions, separate review and change attempt wall costs, and compare only clean/ancestry-confirmed accepted tasks after local integration. Refresh durable impact snapshots on post-task workers, expose `devh impact`, pass a bounded non-causal summary into the next independent review. Prevent automatic edits to impact/forecast/worker control code. [Method](IMPACT.md).

## Independent requirements-to-Diff audit iteration

- Added `src/semantic.mjs`: bounded, read-only Task/Step/approved-contract versus Git patch review, with exact changed-line citations, JSON verdict validation and `scope-review-required` for evidenced drift.
- Independent `semantic` queue runs after project tests; backoff/recovery, stale-diff detection, original-Worktree attribution and review cost receipts are stored. Disabled or incomplete semantic evidence never enables automatic edits of changed code. Reopening a Task resets stale scope/semantic evidence.
- Explicit one-time local `.devh.json` `semanticReview.enabled` is required to send code to Pi; no global hooks or product runtime changes. A model's `no-drift-observed` never means feature acceptance or approved policy change.
- Remaining: authenticated Pi/Codex runtime E2E, complete semantic acceptance, privacy review, measured end-to-end cost benefit and quantitative model-review accuracy on real maintenance Tasks.

## Still open — do not claim production complete

- Semantic completeness beyond declared contracts; actual product behavior may require user validation. No automatic comprehensive functional AC generation.
- Bounded autonomous model planner with real project-code dependencies; this iteration provides schema/guardrails, not live adaptive model planning.
- Real authenticated Pi 1.4/Codex on the user's machine, Hook trust and concurrent process E2E. Our environment has neither installed provider binary.
- Stable provider model-request IDs, subagent coverage and deduplicated actual provider invoices, plus global budget accounting for review agents.
- Cross-device synchronization and always-on processing while the host is offline, intentionally out of scope.
- **Verified net ROI and regression outcomes** from truly comparable real tasks. Directional impact snapshots now exist, but task difficulty, tokens spent by analysis agents, external resource use, test failures and rework still prevent a causal two-resource verdict.

## Verification to finish deployment

1. Review/approve project-local Pi and Codex Hooks in the actual workstation (one-time).
2. Run one small real feature + follow-up + failed acceptance, inspect report and queue provenance.
3. Exercise duplicate/out-of-order Hook, parallel worktrees, app shutdown/restart and missing tokens.
4. Confirm local improvement policy path and independent verifier on a disposable repo, then restrict auto-main paths.
5. Compare real forecasts and actual costs across repeated comparable tasks; do not treat P30/P50/P80 as calibrated probabilities until evidence supports that.

## 2026-11-11 improvement-cost iteration

- Added a reusable, read-only `pi --mode json` model runner for improvement analysis, patch proposal and independent verification. It parses authoritative `message_end` and `compaction_end` usage, avoids cumulative `message_update` double counts, treats model recovery correctly and enforces a best-effort observed-token cap per invocation.
- Saves per-attempt success/failure **model-call receipts** with task/review/attempt links, wall time, observed tokens and coverage. No raw prompts or model responses are persisted.
- Existing impact evaluation now includes tracked analysis failures and blocked changes in the observed cost ledger; incomplete calls cannot become a complete model token estimate. It still makes **no causal or net ROI claims**.
- Next: validate real authenticated Pi JSON mode (specific installed version), actual Pi/Codex Hook integration and nested usage on a trusted workstation. Add cumulative budget and workload-matched, prospective evaluation before asserting realized savings.
