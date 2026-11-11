# Development Harness (embedded prototype)

A standalone developer-maintenance harness. Target: **a developer uses Pi or Codex normally** and the harness records a Task (with Steps and Runs), pre-development forecast, observed execution, then queues relevant improvement reviews after completion. This is *not* a `pic` runtime feature; installation is explicit and separate from normal `pic` usage.

**Status: pre-release implementation / integration not yet verified with real Pi and Codex.** This package is currently embedded under `tools/development-harness/` in `pi-compose` and is designed for later extraction to its own repository. Source baseline research: [pi-compose Draft PR #29](https://github.com/SEONGMINY/pi-compose/pull/29), [mofit-ios task-create](https://github.com/vibemafiaclub/mofit-ios/blob/main/prompts/task-create.md). This package is being integrated into the pi-compose main branch.

## Important semantics
- One **Task** = user's development goal; one or more **Steps** = verifiable milestones; **Runs** = actual agent turns/retries. Steps do not necessarily imply new sessions or commits.
- Multi-line explicit numbered/bulleted requests may be split deterministically. Otherwise a single Step prevents excessive planning overhead. More sophisticated AI planning is a future bounded adapter with schema validation.
- A Hook `Stop` does not prove feature completion. Project-defined trusted checks must pass; otherwise Task stays `awaiting-verification`. Even passing checks proves only those checks, **not** the complete functional acceptance criteria.
- Automatic P30/P50/P80 is empirical once ≥8 same agent/category measurements of both minutes and tokens are available. Cold start only uses a configured, clearly *uncalibrated* prior. Otherwise numerical forecasts remain missing rather than fabricated.
- Time: `wallMinutes` includes pauses between prompts, while `activeMinutes` sums observed agent runs and verification checks (parallel runs may overlap); forecasts and P80 triage use active time. Token totals are observed lower-bound/incomplete when provider events are not guaranteed. No tokens are inferred from character counts.
- The queue stores `review` candidates for a separate improvement loop; **no AI-driven code modification, local-main merge or remote push is active in this initial package**.

## Try locally (simulation only)

```sh
node --version                       # Node.js 22+
npm test
npm run check

# In a throwaway project with .devh.json:
node tools/development-harness/bin/devh.mjs report
```

One-time project configuration is in `examples/.devh.json`. Its numbers are **illustrative seeds, not measured or calibrated estimates**; replace them with genuine project priors, or omit `forecastSeed` and accept unknown until enough history exists.

## One-time setup for a trusted target project

```sh
node tools/development-harness/bin/devh.mjs install .
```

When run from the pi-compose root, this creates project-local hooks / Pi extension configuration only when those files are absent. If they already exist, it writes merge-example files instead of overwriting them. Review the generated files, configure a meaningful `.devh.json` check and explicitly approve hooks in Codex `/hooks` and Pi project trust. This is a setup step, not a per-task command.

## Codex integration

Codex can load `.codex/hooks.json` with `UserPromptSubmit`, `PostModelRequest`, `Stop`, and `Interrupt`. After the initial trust review (`/hooks`), commands can point to this package's absolute `adapters/codex-hook.mjs` path. Hook payload is JSON on stdin. The adapter writes worktree-shared state into Git common-dir `development-harness/` and triggers a detached verification worker after `Stop`. Session termination or OS shutdown can still interrupt that worker; the next `process` call recovers stale verification jobs. **Do not install globally** without intending to track other projects. See `docs/INSTALLATION.md` for sample config.

## Pi integration

Pi auto-discovers trusted project extensions under `.pi/extensions/` or via project `.pi/settings.json` `extensions` absolute path. Load this package's `adapters/pi-extension.ts`, which hooks `before_agent_start`, `message_end`, `agent_settled`. It does not use `agent_end` as a completion signal because automatic retries can follow. See `docs/INSTALLATION.md`.

## Data

`git rev-parse --git-common-dir`/`development-harness/state.json` is per local repository and shared across its worktrees; chmod 0600. This path can be sensitive because it contains prompts summaries, usage and verification output. Do not commit it. Local repo initialization is the only input, no server/database.

## Limitations and roadmap

See `docs/REQUIREMENTS.md`. The first functional step is deterministic telemetry/triage. The next step is robust per-Step acceptance evidence and real Pi/Codex integration verification before claiming zero-touch end-to-end functionality.
