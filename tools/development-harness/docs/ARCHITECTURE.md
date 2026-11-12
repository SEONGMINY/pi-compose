# Development harness architecture — operational design

`Pi/Codex -> provider event adapter -> Task/Step/Run ledger -> verified check worker -> cheap triage -> review queue -> read-only AI review -> evidence/cost selection -> candidate queue -> isolated worktree change -> fixed checks -> independent verification -> local-only conditional integration`

## Requirements / scope gate

`contracts/pi-compose-maintenance.json` is the single versioned, user-confirmed scope contract. At Task start `captureScope` stores its id, revision, SHA-256 and structural assessment in the JSON Task record. After trusted checks `assessTaskScope` reads the current contract and Git baseline, records a separate `scopeGate` JSON result, and prevents `completed` or automated improvement if an approved policy/contract changed. The installer ignores only known local adapter/config files via Git `info/exclude`, and the Task snapshots their SHA-256 at start; hidden settings edits still trigger scope review. This is a structural gate, **not** full semantic review or user approval. Previously queued candidates and direct `improve` invocations must also respect blocked/stale scope.

The Task JSON report derives Step criterion/evidence views from `steps` plus worker receipts without duplicating writable requirement state. Worktree-shared private `state.json` remains the canonical runtime store. Future models may propose scope changes but cannot grant approval by changing JSON.

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

## Separate semantic requirements-to-Diff gate

`verify project checks → structural scope gate → semantic queue (opt-in) → bounded independent read-only model → evidence validator → Task JSON status`. The developer result is delivered first. Only work recorded in the Task's original Worktree may be evaluated; the diff and approved contract must remain unchanged through the audit. A changed or protected policy yields `scope-review-required` and cannot be self-approved by a model. Tasks with code changes and missing semantic evidence may be delivered, but cannot authorize automated improvement. The cost ledger stores a `scope-review` model-call receipt with unknown usage represented as null. No raw prompts or raw model responses are kept in the durable ledger. See README for one-time configuration and size/privacy limits.

## Improvement AI cost receipts

The independent improvement subprocess runs Pi in **one-shot JSON event mode**. It never executes shell commands, uses only the read-only `read,grep,find,ls` tool allowlist, and disables extensions and MCP. The parser counts terminal assistant and compaction usage once, not cumulative streaming snapshots. All review/proposal/verification attempts, including exceptions, persist time/token receipts linked to the relevant Task, review, and change attempt in Git-common `development-harness/model-calls/`. No raw model content is retained. Missing usage is `null`, not zero. The observed-token per-call limit is best-effort; do not treat it as a guaranteed invoice cap or as a verified overall improvement budget.
