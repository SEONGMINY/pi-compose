# Architecture

`Pi/Codex lifecycle events -> provider adapter -> core Task/Step/Run store -> worktree-shared durable state -> verification queue -> cheap triage -> separate improvement review queue`

The adapter does not own planning, forecasting, state transitions, or analysis. It only translates provider inputs into a stable event contract.

- **Task**: user goal; `running`, `awaiting-verification`, `delivered-unverified`, `completed` (reserved for independently proven semantic acceptance), `verification-failed`, `interrupted`. A provider run's stop and passing project checks are both insufficient evidence of semantic completion. Task boundary inference is conservative and preserves its basis.
- **Step**: verifiable unit; deterministic initial decomposition only for explicit Step/Phase headings, not arbitrary numbered requirements. More detailed AI plans require strict schema and immutable revision trail.
- **Run**: actual agent turn. Provider-specific identity and observed usage. Old Run events resolve by Run ID even after a new Task becomes active. Codex model attempts pair Pre/Post hooks best-effort without a provider attempt ID. One Task can have many Runs and Steps.
- **Queue**: a check task is triggered after the final run; asynchronous worker ensures developer output is not delayed; durable queue survives process restarts (with a stale-run recovery policy).
- **Review**: anomalies and repeated waste become candidates. No immediate AI model call per task, no direct self-improvement from a Hook.
- **Storage**: JSON snapshot protected by exclusive file lock; atomic rename writes. Worktree-common `.git` directory is shared; remote/cloud sync is out of scope.

In-flight verification uses a Task revision snapshot; if another Run changes the Task, the old verdict is discarded. The Queue is durable and resumes on a later invocation.

Important missing behavior: approved project scope tracking, step-level AC attestations, stronger completion detection, crash recovery of locks and direct user fixes of failed work. Validate before claiming fully automatic.
