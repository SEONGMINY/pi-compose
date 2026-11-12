# Development harness — requirements and current gaps

## Scope authority and JSON state

The single authoritative scope/approved-requirements contract for the current project is [`../contracts/pi-compose-maintenance.json`](../contracts/pi-compose-maintenance.json). It explicitly binds this harness to **pi-compose feature maintenance**, with Pi/Codex as tools, not upstream development targets. The contract is versioned; its SHA-256 is pinned before Task execution and cannot self-approve a later change. The private Git-common Task/Step/Run ledger and scope-gate results are JSON; `devh task ID` produces an inspectable JSON view with criterion evidence. Markdown files describe rationale and limitations but do not hold separate mutable task states.

The gate is conservative: it checks project identity, a narrow set of explicit external-target hints, contract integrity and protected policy Git paths. These signals cannot establish semantic correctness. Uncertain scope or a dirty Git start is recorded as unverified. A changed approved contract/policy or pinned project-local Hook/config file is held for review rather than silently promoted by passing tests. Installation-generated local settings are ignored through the local Git exclude file, not a repository-wide `.gitignore` edit.

## Independent semantic drift guard (JSON state)

The authorized target remains `pi-compose` maintenance, not upstream Pi/Codex or the `pic` runtime. The existing contract JSON is not changed by an agent. When explicitly enabled in local `.devh.json`, a **separate post-delivery queue** captures the original Task goal, Step requirements and an exact, bounded Git patch, then asks a read-only model to identify concrete mismatches. Findings must cite an exact changed line of the claimed file; only such findings may flag `scope-review-required`. Positive findings mean `no-drift-observed`, **not** verified functional acceptance or new user approval. Results, errors, usage coverage and model-call IDs are stored in Task and cost-receipt JSON.

Ordinary developer results are not blocked for this expensive review. Missing approval, too-large/sensitive/untracked-unsupported evidence, model failures, or races leave the review `unverified` and prevent changed-code Tasks from authorizing automatic improvements. The model's own verdict is not authority to change product policy. The queue runs at most once per worker invocation; a failed model attempt backs off, and a changed Task/diff discards stale conclusions. Review is an explicit one-time project opt-in because it sends a code patch to a model.

**Limits:** best-effort per-call 30 s and 6,000 observed tokens; 28 KB / 12 changed files. This is *not* guaranteed billing control or proof of semantic correctness. No real authenticated Pi/Codex E2E is claimed.

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
- Git revision evidence for Task start; post-change impact snapshots comparing accepted Tasks only after confirmed local-main integration. Review/attempt wall costs, including failed attempts, are accounted for directionally. Successful and failed **read-only Pi JSON model calls** record observed review/propose/verify tokens; missing usage and legacy attempts remain unknown. Model calls are kept in a private Git-common receipt ledger without prompts/outputs. See [IMPACT.md](IMPACT.md).

## Not yet proven / gaps

- Actual Pi 1.4/Codex authenticated workstation E2E, Hook acceptance, cross-host restart and nested agent usage reconciliation.
- Full functional AC verification without a project-specific executable contract: general test success is insufficient.
- Automatically calibrated P30/P50/P80 at cold start; numeric priors require history or configured uncalibrated seeds. Optional model planner is not a calibrated numeric forecaster.
- Guaranteed model-attempt deduplication if provider events lack stable IDs. The Pi JSON subprocess has a best-effort observed-token cap per invocation, **not a hard cumulative billing budget** across retries, nested model work or missing streaming usage.
- Unbounded codebase-dependent planning is intentionally omitted; bounded plan generation is optional and must be empirically evaluated.
- Causal net ROI measurement and full two-resource attribution are still missing. Current impact snapshots remain observational; structured Pi receipts close a major *observability* gap but provider invoices, optional planning, external agents, and full overhead still lack complete coverage. The harness must not equate directional median changes with proven savings.

## Security, trust and lifecycle

The implementation must fail open for ordinary developer prompts if telemetry cannot be saved. Never let an `agent_settled` / `Stop` event claim semantic completion. Critical safety gates and tests are excluded from automated edits. Git worktrees isolate changed files from the working tree but **do not sandbox executed project scripts**. A user-approved policy and trusted repository are prerequisites. Persist queue receipts before acknowledgement; retry a crashed or blocked worker without duplicate integration and avoid self-triggering AI improvement loops.
