# Development harness architecture — operational design

`Pi/Codex -> provider event adapter -> Task/Step/Run ledger -> verified check worker -> cheap triage -> review queue -> read-only AI review -> evidence/cost selection -> candidate queue -> isolated worktree change -> fixed checks -> independent verification -> local-only conditional integration`

## Boundaries

- **Task**: user goal, stable ID, original immutable pre-work forecast, related/rework links, revision log. A later turn does not rewrite an earlier forecast.
- **Step**: verifiable milestone (1–8). Explicit phases may be split; numbered requirements do not imply sequential implementation. Plans can only **append** new steps after execution starts.
- **Run**: provider session+turn; repeated hooks use stable event IDs. Agent request attempts may be missing IDs. Child-agent token use is only attributed when its parent turn and request hooks can be matched, and is never asserted exhaustive.
- **Acceptance**: project owner declares exact `criterion -> npm run SCRIPT` checks in `.devh.json`. Only the worker runs them and issues receipts. Passing the general project suite yields `delivered-unverified`; matching complete Step contracts yield `completed` **by declared contract**, not an assertion about unspecified user expectations. Provider hooks cannot self-attest.
- **Measurement**: wall vs observed agent run+test duration separate; tokens are observed-only/unknown. A source without token evidence is not recorded as 0. Preserve a Git HEAD/cleanliness snapshot at the start of each new Task for evidence-based exposure matching.
- **Review**: evidence-bound AI hypotheses; economics prioritize architecture, then gates, AI instructions, user behavior. Unknown feasibility or time/token cost tradeoffs block automation. Model proposals are never themselves permission to edit.
- **Impact**: after each delivery, evaluate *applied* local-main improvements against accepted Tasks with clean Git ancestry, matching agent/kind/Step count and a pre/post observation window. Persist directional snapshots; no causal or net token ROI claims when coverage is missing. Review and attempt wall durations are partial improvement overhead. Details and limitations are defined in [IMPACT.md](IMPACT.md).
- **Improve**: local Git-common-dir `development-harness/automation-policy.json` defines exact allowed paths, fixed checks and mode. A review/model must be independently verified in a detached worktree. Default `draft` leaves a local branch, and only explicit `local-main` policy allows local fast-forward. No remote push. Critical harness control plane and test files are ineligible for automatic edits.
- **Storage/recovery**: one JSON state snapshot protected by an exclusive file lock, atomic rename and stale PID lock recovery. Review/attempt receipts are stored separately. A failed model review is requeued with backoff, and accepted attempt receipts prevent replay. Git worktrees on the same computer share Git-common state.
- **Execution**: project-local Hook/Extension installation; no new orchestrator, Docker, server or daemon. A detached verification worker runs on Stop/agent_settled; if it dies, later invocations can resume. Separate review/improve work is opt-in per trusted project, and is never part of the synchronous developer turn.

## Honest limitations

No AI planner is invoked automatically: the default planner is conservative and only treats explicit Step/Phase headings as phases. No complete real Pi/Codex E2E was run in this environment. Codex attempt IDs and nested agents are not guaranteed; output tokens can be missing. AC tests verify only their declared commands, not arbitrary semantic user requirements. Cloud work and offline processing are outside scope. AI review token budgets cannot be enforced precisely without provider usage telemetry.

## Improvement AI cost receipts

The independent improvement subprocess runs Pi in **one-shot JSON event mode**. It never executes shell commands, uses only the read-only `read,grep,find,ls` tool allowlist, and disables extensions and MCP. The parser counts terminal assistant and compaction usage once, not cumulative streaming snapshots. All review/proposal/verification attempts, including exceptions, persist time/token receipts linked to the relevant Task, review, and change attempt in Git-common `development-harness/model-calls/`. No raw model content is retained. Missing usage is `null`, not zero. The observed-token per-call limit is best-effort; do not treat it as a guaranteed invoice cap or as a verified overall improvement budget.
