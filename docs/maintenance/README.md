# Pi Compose maintenance telemetry — first vertical slice (Draft)

This is an **internal development tool** for maintaining pi-compose. It does not
run when a product user invokes `pic` and does not change Main/Work/Support UX.

## Scope implemented

- Record an immutable task-scoped P30/P50/P80 forecast immediately before work.
- Capture elapsed wall/runner time and only **new** usage in explicit Pi JSONL
  session files. Recognize assistant, usage and compaction entries. Existing
  session usage before task start is excluded.
- Retain failed/cancelled task outcomes and distinguish unknown tokens from zero.
- Deterministically triage every untriaged finished task. Keep suspicious tasks
  in a root-cause review queue, without claiming a statistical or causal verdict.
- Show cohort calibration fractions (P30/P50/P80 coverage); mark fewer than 20
  completed comparable tasks as indicative only.

## Quick start

```bash
node maintenance/cli.mjs start \
  --title 'Fix Work handoff regression' --kind bug \
  --time 20,40,90 --tokens 10000,25000,60000 \
  --session /absolute/path/to/existing-or-future/pi-session.jsonl

# After implementation, pass the returned id:
node maintenance/cli.mjs finish --id TASK_UUID --state completed
node maintenance/cli.mjs analyze
node maintenance/cli.mjs list
```

Or instrument a single command, including its process elapsed time:

```bash
node maintenance/cli.mjs run \
  --title 'Run regression checks' --kind verification \
  --time 1,3,8 --tokens 0,0,0 \
  -- npm run check
```

All commands support `--data-dir DIR` (default `.maintenance`). Paths provided
via `--session` must refer to the Pi JSONL files relevant to this task; a
not-yet-created session file can be supplied at start and must exist at finish.
For an additional session created mid-task, use `--session PATH` on `finish`.

## Data meaning and limits

- Time forecast values are **minutes**, token values are cumulative usage across
  explicitly registered sessions, not context-window size or billing dollars.
- Predictions are authored by the task agent/user: this slice *records* them.
  It does not claim to generate calibrated forecasts without historical data.
- `finish` records wall time; `run` additionally records monotonic elapsed
  command time. Neither measures active thinking/typing time; waiting is not
  excluded. Data explicitly calls this out via `activeMs: null`.
- Token coverage is limited to registered Pi JSONL files. ChatGPT conversations,
  unregistered subagents, terminal commands and external processes are **not**
  inferred. No session means `tokens: null`, not `0`.
- Each Pi file's original byte prefix is hashed so modified/replaced histories
  cannot silently corrupt task accounting. Concurrent writes at finish may
  require a retry.
- Single-task P80 overrun is not proof a forecast is incorrect. Low-sample
  calibration is informational, not a statistically meaningful guarantee.
- Reports named `analysis` are **deterministic triage only**. Root causes remain
  `undetermined`; AI causal analysis and autonomous code improvement are not yet
  implemented. The queue exposes pending cases for the next phase.

## Storage and trust boundary

Data lives in `.maintenance/` (ignored by Git), one task/analysis JSON file per
id with atomic replacement and an exclusive completion lock. Never commit raw
Pi transcripts or credentials. Existing project policies and product UX are not
changed; no auto-writing to Main is introduced in this draft.

## Next phases (not yet implemented)

1. Evidence-linked AI root-cause analysis from the pending queue, grouped by
   recurrent failure signatures; distinguish observed facts from hypotheses.
2. Evaluate architecture -> gate -> AI instructions -> user behavior in order.
3. Execute improvements in isolation, require independent test + contract
   verification, and enforce explicit allowlists before any automatic Main
   integration; provide revert/impact monitoring.
4. Generate calibrated forecasts from homogeneous past tasks and evaluate net
   ROI including prediction, analysis and improvement overhead.

The first project-level forecast made before this implementation was P30
14 h / 250k tokens; P50 25 h / 450k; P80 55 h / 1M, covering **all phases**.
This prototype does not falsely record a measured completion for that forecast.

## Second slice: evidence-linked AI retrospective (Draft)

The `analyze` command remains model-free: it scans **all completed tasks** for
statistics and deterministically flags outliers, failures, and cancellations.
A single P80 exceedance is a signal to investigate, not proof of miscalibration.

The new `review` command groups pending anomalies by task type and observed
signal, with at most four related tasks per model call. Preview without any
model cost:

```bash
node maintenance/cli.mjs review --dry-run
node maintenance/cli.mjs review --max-batches 1
node maintenance/cli.mjs improvements
```

`review` runs an **ephemeral Pi `--print` process** with only
`read,grep,find,ls` and no extensions or MCP. It never edits project code.
It passes a bounded task summary rather than full Pi transcripts. It validates
reported task values and quoted source-file lines before saving the model's
output under `.maintenance/reviews/`. Failed or ungrounded output cannot be
stored as a review; the task remains pending. Review runs are serialized and
idempotent across re-runs. Each review stores its wall duration; Pi's `--print`
without a stored session does **not** provide reliably attributable token usage,
so AI review tokens remain **unmeasured**, not `0`.

The model must assess the four intervention layers in priority order:
architecture → gate → AI instructions → user behavior. An unknown higher layer
blocks lower-layer selection. Findings remain **hypotheses**, not causal proof.
Current-file citations are checked against the current checkout, but may not
represent source as it existed when the original task ran. An actionable
candidate also requires a matching repository code citation.

The `improvements` command lists *unapproved proposals only*. This stage does
**not** allow AI-written changes, automatically execute tests, open PRs, or
merge into Main. A future execution stage must implement isolation, explicit
path allowlists, immutable check receipts, independent verification, stale-base
checks and a reversible integration method; these security controls must not
be inferred from a model's recommendation. `review` requires a local installed
and authenticated `pi` executable. It has not yet been exercised against live
Pi 1.4.0 sessions on macOS.
