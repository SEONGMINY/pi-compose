# Development harness — requirements and current gaps

## Target workflow

The user only requests development normally in Pi or Codex. The harness automatically (1) identifies a development Task, (2) decomposes it into verifiable Steps only where worthwhile, (3) predicts P30/P50/P80 before implementation, (4) observes Run time/token usage and failures, (5) records independent completion evidence, (6) immediately performs cheap triage, and (7) queues expensive review and worktree improvement separately from the developer result. No per-task manual command is allowed.

Maintain time and token as distinct resources. Forecast provenance and original estimates must remain immutable. All unresolved observations are `unknown` rather than zero. The improvement layer priority is architecture → deterministic gate → AI instructions → human behavior. Compare future savings against the total cost of improvement and verification; avoid changes with negative expected net savings. Do not change unapproved project contracts or the Pi Compose product Main context.

## Implemented with local tests

- Task → Step → Run, replayable identities, conservative topic boundaries, linked follow-ups and append-only scope extension.
- Small tasks remain one Step. Complex task planning can use a *bounded optional* read-only Pi subprocess with strict schema and fallback; not exercised against a real provider.
- Project-owner checks and exact Step AC bindings produce independent exit-code receipts. Without complete declared contracts the status is `delivered-unverified` rather than semantic completion.
- Pi and Codex adapters collect events; Codex attempt pairing uses available `agent_id` and reports uncorrelated requests as incomplete.
- Cheap post-run analysis, durable review and improvement queues, evidence-linked hypotheses, economics and allowlisted worktree change proposal with independent verifier and project checks.
- Automatic review/auto-improve eligible by trusted configuration; code modifications still require a separately approved local Git-common-dir policy. No remote push, no Docker, no server.

## Not yet proven / gaps

- Actual Pi 1.4/Codex authenticated workstation E2E, Hook acceptance, cross-host restart and nested agent usage reconciliation.
- Full functional AC verification without a project-specific executable contract: general test success is insufficient.
- Automatically calibrated P30/P50/P80 at cold start; numeric priors require history or configured uncalibrated seeds. Optional model planner is not a calibrated numeric forecaster.
- Guaranteed model-attempt deduplication if provider events lack stable IDs, and a hard cumulative token budget for AI root-cause analysis.
- Unbounded codebase-dependent planning is intentionally omitted; bounded plan generation is optional and must be empirically evaluated.
- Causal net ROI measurement across comparable post-change tasks; current analyses offer hypotheses and directional estimates only.

## Security, trust and lifecycle

The implementation must fail open for ordinary developer prompts if telemetry cannot be saved. Never let an `agent_settled` / `Stop` event claim semantic completion. Critical safety gates and tests are excluded from automated edits. Git worktrees isolate changed files from the working tree but **do not sandbox executed project scripts**. A user-approved policy and trusted repository are prerequisites. Persist queue receipts before acknowledgement; retry a crashed or blocked worker without duplicate integration and avoid self-triggering AI improvement loops.
