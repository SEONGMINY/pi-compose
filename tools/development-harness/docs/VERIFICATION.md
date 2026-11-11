# Verification report — 2026-11-11

- Package: `development-harness` (independent local repo candidate).
- Node runtime used: v22.16.0 (project package.json supports Node >=22).
- `npm run check`: passed. 16 unit/integration-mock tests succeeded; 0 failures.
- `node --experimental-strip-types --check adapters/pi-extension.ts`: syntax check passed. Does **not** verify Pi runtime event integration.
- Codex adapter: subprocess reads hook-shaped JSON on stdin, writes Task/Run record, and `Stop` starts detached Worker; synthetic end-to-end success. Not live Codex.
- Git Worktree: two separate checkouts share one store, verified in a disposable Git repository.
- Missing/partial usage: no fabricated tokens, verifications fail closed for semantic claims; observed coverage explicitly limited.
- Project policy: on one-time install, existing Codex hook or Pi settings files are not overwritten. Proposed merged configurations are written as separate files.
- No authenticated Pi/Codex run, actual P30 probability calibration, AI root-cause model invocation, automated improvement code modification, or remote repository creation was performed.

## Known design gaps
- Passing npm checks does not prove a feature's full Acceptance Criteria; Step status explicitly notes semantic evidence is unverified.
- Automatic forecasting has no numbers at cold start unless an explicitly configured uncalibrated prior exists.
- Provider request events without stable IDs may be overcounted or omitted; usage totals cannot be claimed exhaustive.
- Simple explicit-item decomposition only; bounded model-based planning and dependency interpretation remain.
- Worktree-shared JSON is not synced across machines.
- Detached Worker can be cancelled by environment shutdown; persistent pending queue recovers during a later `process` invocation.

## Follow-up hardening (2026-11-11, local verification)

- A passing project check is reported as `delivered-unverified`, not `completed`.
  Checks never establish the user's complete semantic acceptance criteria by themselves.
- An ambiguous subsequent prompt creates a separate Task rather than silently
  merging unrelated work. Explicit continuation/rework language can reuse an
  unfinished or technically delivered Task; this remains a heuristic and is
  marked with `boundaryBasis` and `relation`.
- Old runs are addressed by Run ID even when another Task becomes active;
  changes during checks discard stale verdicts and leave a retryable queue.
- Numbered *requirements* no longer automatically become sequential Steps;
  only explicit `Step N` / `Phase N` / `N단계` headings are split.
- Codex model-request token accounting uses best-effort `PreModelRequest` / 
  `PostModelRequest` pairing rather than undocumented `request_id` fields.
  If callbacks are missing or reordered, usage remains uncertain.
- Historical samples can include technically delivered work; their provenance
  states that feature AC acceptance is unverified and tokens are lower bounds.
- Local checks: `npm run check`, **26 tests passed** (baseline 16 + 10 new tests).
  No user workstation Pi/Codex authenticated E2E or full pi-compose macOS test.
