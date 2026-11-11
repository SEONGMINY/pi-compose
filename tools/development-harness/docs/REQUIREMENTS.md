# Development Harness — requirements and verification boundaries

## In scope
- Standalone repository/package. No pi-compose application behavior changes.
- Normal Pi / Codex task request triggers Task creation automatically after one-time trusted installation.
- Task > Step > Run, with a stable Task ID and durable run receipts; decomposition is proportional to task structure.
- Before code work: P30/P50/P80 forecast in time and tokens, with data provenance. Never invent numerical forecasts without evidence or explicitly configured uncalibrated priors.
- On completion: task wall-clock time (including idle user time) and summed agent-run + verification active minutes tracked separately, plus token usage with coverage, attempts, checks and deterministic low-cost triage.
- Triage identifies repeated inefficiency and registers improvement review work, *not* direct edits in a hook.
- Improvement is a separate bounded, independently reviewed, worktree-isolated loop. The original development result is delivered first.
- No automation ever pushes remote `main`, bypasses permissions, changes project decisions, or silently modifies pi-compose Main context.

## Not yet achieved in this first implementation
- Reliable automatic semantic acceptance-criteria verification. A successful npm check does not prove a feature's complete requirements.
- Pi/Codex live authenticated end-to-end verification on user's workstation. Hooks require user trust and installation.
- Automatic AI cold-start forecasting with honest calibrated probabilities.
- Complete nested/subagent usage observation or invoice cost reconciliation.
- Automatic model-powered root-cause analysis, safe code modification, and empirically measured net ROI. Only the durable review candidate queue is implemented here.
- Cross-device/cloud synchronization. Worktrees share the same Git common directory on one machine.

## Operational constraints
- One-time opt-in per project: `.devh.json` and trusted hooks / Pi extension. No per-task commands.
- Hooks should fail open for telemetry. Hook errors never block the developer. Persist failures to diagnostics later.
- Hook `Stop` / Pi `agent_settled` means a run stopped, not necessarily that a product feature is complete.
- Missing usage is unknown (not zero); observed hooks cannot claim exhaustive coverage.
- State lock and worker leases require fault recovery. State writes must be atomic and idempotent.
- Task original forecast must remain unchanged after code execution; scope changes are separate events.
- No external services, servers, Docker, database, or long-running orchestrator required.

## Follow-up implementation gates
1. Add explicit AC receipts for each step and a trustworthy, non-model-controlled completion predicate.
2. Add agent-specific real-session telemetry and stable attempt identifiers / deduplication.
3. Reliable worker recovery and crash-safe outbox for long-running AI analysis.
4. Migrate adapted root-cause / cost-aware layer selection from pi-compose Draft PR #29.
5. Separate improvement worker with allowlisted paths, independent verification and guard against self-triggering.
6. Run end-to-end tests in installed Pi @earendil-works 1.4 and current Codex, including interrupted sessions, concurrent worktrees, multiple prompts, retries and privacy.
