# Development Harness (standalone prototype)

A standalone developer-maintenance harness. Target: **a developer uses Pi or Codex normally** and the harness records a Task (with Steps and Runs), pre-development forecast, observed execution, then queues relevant improvement reviews after completion. This is *not* a pi-compose runtime feature.

**Status: pre-release implementation; synthetic and local Git tests only, not authenticated Pi/Codex E2E.** Currently embedded in pi-compose under `tools/development-harness/`; extraction is deferred by user decision. Source baseline research: [pi-compose Draft PR #29](https://github.com/SEONGMINY/pi-compose/pull/29), [mofit-ios task-create](https://github.com/vibemafiaclub/mofit-ios/blob/main/prompts/task-create.md). The existing embedded package is on pi-compose `main`; changes in this iteration are implemented and tested separately before merge.

## Important semantics
- One **Task** = user's development goal; one or more **Steps** = verifiable milestones; **Runs** = actual agent turns/retries. Steps do not necessarily imply new sessions or commits.
- Numbered/bulleted *requirements* are not treated as separate implementation Steps. Only explicitly named `Step N` / `Phase N` / `N단계` lines split deterministically; otherwise a single Step prevents excessive planning overhead. More sophisticated AI planning is a future bounded adapter with schema validation.
- A Hook `Stop` does not prove feature completion. Project-defined trusted checks must pass; otherwise Task stays `awaiting-verification`. General project checks record `delivered-unverified`; **only exact project-owner Step acceptance contracts** produce `completed` by declared checks. Unspecified functional requirements remain unverified.
- Automatic P30/P50/P80 uses observed technical-delivery outcomes once ≥8 comparable time and token samples are available; these are **not** calibrated completion probabilities. Cold start only uses a configured, clearly *uncalibrated* prior. Otherwise numerical forecasts remain missing rather than fabricated.
- Time: `wallMinutes` includes pauses between prompts, while `activeMinutes` sums observed agent runs and verification checks (parallel runs may overlap); forecasts and P80 triage use active time. Token totals are observed lower-bound/incomplete when provider events are not guaranteed. No tokens are inferred from character counts.
- A completed/failed delivery is triaged cheaply. Evidence-checked `review` candidates can be analyzed with a read-only Pi model and queued for a separate worktree improvement. **Automated edits require a local, explicitly approved allowlist policy and independent verification. No remote push.**

## Try locally (simulation only)

```sh
node --version                       # Node.js 22+
npm test
npm run check

# In a throwaway project with .devh.json:
node /path/to/development-harness/bin/devh.mjs report
```

One-time project configuration is in `examples/.devh.json`. Its numbers are **illustrative seeds, not measured or calibrated estimates**; replace them with genuine project priors, or omit `forecastSeed` and accept unknown until enough history exists.

## One-time setup for a trusted target project

```sh
node /ABS/development-harness/bin/devh.mjs install /ABS/target-project
```

This creates project-local hooks / Pi extension configuration only when those files are absent. If they already exist, it writes merge-example files instead of overwriting them. Review the generated files, configure a meaningful `.devh.json` check and explicitly approve hooks in Codex `/hooks` and Pi project trust. This is a setup step, not a per-task command.

## Codex integration

Codex can load `.codex/hooks.json` with `UserPromptSubmit`, `PreModelRequest`, `PostModelRequest`, `Stop`, `Interrupt`, and `SessionEnd`. After the initial trust review (`/hooks`), commands can point to this package's absolute `adapters/codex-hook.mjs` path. Hook payload is JSON on stdin. The adapter writes worktree-shared state into Git common-dir `development-harness/` and triggers a detached verification worker after `Stop`. Session termination or OS shutdown can still interrupt that worker; the next `process` call recovers stale verification jobs. **Do not install globally** without intending to track other projects. See `docs/INSTALLATION.md` for sample config.

## Pi integration

Pi auto-discovers trusted project extensions under `.pi/extensions/` or via project `.pi/settings.json` `extensions` absolute path. Load this package's `adapters/pi-extension.ts`, which hooks `before_agent_start`, `message_end`, `agent_settled`. It does not use `agent_end` as a completion signal because automatic retries can follow. See `docs/INSTALLATION.md`.

## Data

`git rev-parse --git-common-dir`/`development-harness/state.json` is per local repository and shared across its worktrees; chmod 0600. This path can be sensitive because it contains prompts summaries, usage and verification output. Do not commit it. Local repo initialization is the only input, no server/database.

## Step acceptance & improvement settings

Project owners can declare an exact Step acceptance contract in `.devh.json` (never inferred from model claims):

```json
{
  "checks": [["npm","run","check"]],
  "acceptanceContracts": {
    "delivery": [{"criterion":"The configured API contract is validated","command":["npm","run","contract-check"]}]
  },
  "improvement": {"autoReview": true, "autoImprove": true}
}
```

Only a **matching** Step AC and trusted command receipt marks a declared-contract completion. Otherwise project checks passing yields `delivered-unverified`. The project owner must decide what its checks actually prove. Model output alone is never a substitute.

After initial trusted Hook setup, both `autoReview` and `autoImprove` are automatic when eligible; **no commands per task**. Auto review still requires a working authenticated local Pi model. Auto improve does nothing without an owner-approved local policy in Git-common-dir `development-harness/automation-policy.json`:

```json
{"schemaVersion":1,"mode":"draft","allowedPaths":["src/example.mjs"],"checks":["project"],"allowAutoMain":false}
```

The above is an **illustrative placeholder** and must be replaced with real, existing permitted files before activation. `draft` makes a locally verified attempt branch; `local-main` additionally requires explicit `allowAutoMain: true` and an unchanged clean local `main`. The review agent uses read-only tools, a bounded review batch and retries failures with backoff. Lack of measured provider tokens remains a limitation to hard cost caps.

## Limitations and roadmap

See `docs/REQUIREMENTS.md`. Declarative Step acceptance receipts and the separate improvement queue are implemented. **Real Pi/Codex integration, automatic AI plan generation, full semantic acceptance and bounded measured AI costs remain unverified or incomplete.**
