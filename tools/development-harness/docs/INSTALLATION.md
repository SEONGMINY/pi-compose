# Trusted one-time installation (not yet verified on the user's machine)

The implementation currently lives at `tools/development-harness/` in pi-compose. It is **not** a `pic` runtime feature; project-local Pi/Codex Hooks are installed separately after explicit project trust.

## First-time setup in a trusted clone

```sh
cd /path/to/pi-compose
node tools/development-harness/bin/devh.mjs install .
```

The installer creates `.devh.json`, `.codex/hooks.json` and `.pi/settings.json` only if absent. Existing settings are never overwritten: review the corresponding `*.merge-example.json` and merge deliberately. The generated Hook and Extension paths refer to the source package in the local checkout. On a new workstation, rerun installer or update those paths. Trust the project Hooks through Codex `/hooks` and Pi project trust, then restart your agents.

The default project config from install includes `npm run check` if present and enables automated review/improvement **eligibility**, but improvement never edits code without an explicit local policy. Remove an auto flag to opt out:

```json
{
  "checks": [["npm","run","check"]],
  "planning": {"mode":"deterministic"},
  "improvement": {"autoReview":true,"autoImprove":true}
}
```

For an opt-in bounded model planner on **complex** requests, set `planning.mode` to `bounded-pi` and optionally `timeoutMs` between 1000 and 10000. It spawns read-only Pi without extensions/MCP, has a strict output schema, and falls back to a single Step on error. This extra model request has *unmeasured token overhead* and requires working Pi authentication. Leave deterministic mode selected until real-world evaluation.

## Declared Step acceptance (optional)

Add exact Step ID, criterion text and the repository-owned test script to `.devh.json`:

```json
{
  "checks": [["npm","run","check"]],
  "acceptanceContracts": {
    "delivery": [{"criterion":"API contract matches fixtures","command":["npm","run","test:contract"]}]
  }
}
```

The acceptance contract must match the Step's recorded AC *exactly*. Otherwise a general check passing only records `delivered-unverified`. A declared check proves only what that script tests. Models cannot sign their own checks. Do not treat `completed` by a declared contract as proof of unspecified functional behavior.

## Local, explicit improvement allowlist

The old PR #29's policy is adapted to **Git-common-dir** `development-harness/automation-policy.json`, shared by worktrees on this machine and not committed with code. Example location on a normal repo: `.git/development-harness/automation-policy.json`.

```json
{"schemaVersion":1,"mode":"draft","allowedPaths":["src/existing.mjs"],"checks":["project"],"allowAutoMain":false}
```

Replace the path with a real, narrowly chosen file. `draft` only saves a verified local attempt branch. `local-main` requires explicit `allowAutoMain:true`; it will fast-forward a clean, unchanged local main only after source-drift checks, fixed project checks, and independent model verification. Never pushes remotely. Protected harness control files, test files and unapproved paths cannot be edited automatically. **Project npm scripts execute on the host; a worktree is not a security sandbox.** Use only fully trusted project scripts and accounts.

## What to expect

A normal development prompt records Task/Step/Run and pre-work forecast. At agent settled/Stop a detached worker runs configured project checks, emits independent Step receipts when declared, triages cheaply and registers reviews. When enabled, a read-only Pi agent reviews the queue and an isolated improvement is attempted only under an existing approved policy. Interrupted workers are resumed at the next agent-triggered process invocation.

There is **no automatic cross-device sync, daemon, fully validated semantic acceptance, or real Pi/Codex E2E claim** yet. Token coverage remains partial if provider events lack stable IDs or nested agent telemetry.
