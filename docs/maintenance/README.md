# Pi Compose — Internal maintenance harness

This is a tool for developing and maintaining **pi-compose itself**, not an extension used by `pic` customers. It adds no Docker, server, database, or product-side Agent UI.

**Implementation state:** Draft PR #29. Unit tests and disposable Git repository tests do **not** prove authenticated Pi model calls or macOS end-to-end behavior.

## Forecast and measurement

```sh
# Read historical evidence without invoking a model
node maintenance/cli.mjs forecast --kind bug --environment pi

# Cold start: supply explicit P30/P50/P80 in minutes and tokens
node maintenance/cli.mjs start --title 'Handoff fix' --kind bug --environment pi \
  --time 20,40,90 --tokens 10000,25000,60000 --session /path/to/pi.jsonl

# With >=8 comparable observed samples in BOTH dimensions
node maintenance/cli.mjs start --title 'Another fix' --kind bug --environment pi \
  --historical --session /path/to/pi.jsonl

node maintenance/cli.mjs finish --id TASK_UUID
node maintenance/cli.mjs analyze
```

The historical estimate uses **nearest-rank quantiles** from completed tasks with the **same task type, environment and elapsed-time accounting basis**. Time and tokens are estimated separately. No estimate is generated when comparable data is insufficient. These are empirical suggestions, **not statistically calibrated 30/50/80 completion probabilities**.

All original forecasts and their provenance are saved at task start. Token observations cover **registered Pi sessions and explicitly reported external runs only** and can underestimate true work. Missing usage is `unknown`, not zero. ChatGPT, Codex and Claude usage may be recorded with `usage-add`, which requires a source reference but does not independently verify provider claims. The task duration recorded by ordinary `start`/`finish` includes waiting; `run` measures monotonic command time. Historical `run` predictions use the `runner-monotonic` basis.

```sh
node maintenance/cli.mjs forecast --kind verification --environment pi \
  --elapsed-basis runner-monotonic
node maintenance/cli.mjs usage-add --id TASK_UUID --provider chatgpt \
  --run-id unique-run-001 --total-tokens 1234 --reference 'provider usage export'
```

Data is stored locally in the Git-ignored `.maintenance/` folder. Pi session prefixes are hashed to avoid silently attributing older usage to current work. Unregistered subagents, absent exports and human active time cannot currently be measured.

## Retrospective and improvement selection

```sh
node maintenance/cli.mjs analyze
node maintenance/cli.mjs review --dry-run
node maintenance/cli.mjs review --max-batches 1
node maintenance/cli.mjs improvements
```

Every finished task is classified by deterministic code; selected anomalous/repeated cases are grouped (up to four per model invocation). Read-only Pi generates **hypotheses**, not factual causal claims, and evidence must match task records or repository lines. Review AI token usage remains **unmeasured** without an attributable provider usage record.

Intervention priority is **architecture → gate → AI instructions → user behavior**. A feasible higher layer remains preferred, except when its forecast implementation cost is **at least three times** projected total savings in **both** minutes and tokens. Unknown feasibility, insufficient economic confidence, and mixed resource tradeoffs block automated selection. The 3× threshold is a *provisional policy*, not proven ROI.

## Docker-free improvement execution

Create a trusted, local, Git-ignored policy file at `.maintenance/automation-policy.json`:

```json
{
  "schemaVersion": 1,
  "mode": "draft",
  "allowedPaths": ["src/example.ts"],
  "checks": ["project"],
  "allowAutoMain": false
}
```

```sh
node maintenance/cli.mjs improve --id REVIEW_UUID \
  --policy .maintenance/automation-policy.json --dry-run
node maintenance/cli.mjs improve --id REVIEW_UUID \
  --policy .maintenance/automation-policy.json
node maintenance/cli.mjs impact
```

The runner requires a **clean local `main` checkout** containing this harness. While PR #29 remains Draft, that is a **deployment blocker** for running it directly from `main`. Do not call it live or merge the Draft solely because unit tests pass.

The AI proposes read-only, bounded exact-string changes; the runner applies only exact-path allowlisted edits in a temporary Git Worktree. Checks are fixed to Node maintenance tests or full project `npm run check`. A new Worktree does not include `node_modules`, so when required the runner prepares dependencies using `npm install --no-package-lock --ignore-scripts --no-audit --no-fund`, then executes the project check. This uses the host, not a container; with no committed lockfile dependency installation may not be fully reproducible.

A separate read-only Pi verifier checks the actual Diff and reported tests. Any failed check, source drift, dirty Main, unexpected changed path or verification concern blocks integration. `mode: draft` leaves a named attempt branch; `mode: local-main` with `allowAutoMain: true` enables **local Main fast-forward only**. No remote push, force merge or automatic GitHub PR merge is performed. A blocked improvement returns a nonzero CLI exit code.

The full-project check exposed three pre-existing TypeScript narrowing/nullability
errors in `src/overview.ts`. This Draft also contains a type-only correction;
no Overview runtime behavior or product contract was intentionally changed.

`impact` offers directional before/after cohort comparisons, **not proven causal savings or net ROI**.

## Remaining verification and uncertainty

- Real authenticated Pi model calls and macOS maintenance E2E have not been run.
- Comparable historical samples are needed before probability calibration is meaningful.
- Task-time Git revisions, scope changes, QA loops and review-model token costs are not fully instrumented.
- Local Project check is exercised by CI; user workstation environments may differ.
- Automatic remote `main` push is deliberately excluded.
