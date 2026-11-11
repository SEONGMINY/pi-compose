# One-time, explicit installation (not yet live verified)

While embedded in `pi-compose`, run the installer from the repository root:

```sh
node tools/development-harness/bin/devh.mjs install .
```

The installer generates absolute local paths. The examples below still use `/ABS/development-harness`; replace them with paths on your machine and review the generated configs.

## Project checks

Add `.devh.json` to **the target project**:

```json
{"checks":[["npm","run","check"]]}
```

Only checks chosen by the trusted project owner are run. For packages without npm or missing scripts, the automatic finalization is intentionally unavailable until a suitable adapter/check policy is provided.

## Codex project hook

Create `.codex/hooks.json` in the target project, merging with existing hooks rather than replacing them. Review and trust the hook via `/hooks`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"node /ABS/development-harness/adapters/codex-hook.mjs","timeout":15}]}],
    "PostModelRequest": [{"hooks":[{"type":"command","command":"node /ABS/development-harness/adapters/codex-hook.mjs","timeout":15}]}],
    "Stop": [{"hooks":[{"type":"command","command":"node /ABS/development-harness/adapters/codex-hook.mjs","timeout":15}]}],
    "Interrupt": [{"hooks":[{"type":"command","command":"node /ABS/development-harness/adapters/codex-hook.mjs","timeout":3}]}]
  }
}
```

The `PostModelRequest` source does not guarantee a stable attempt ID, so retries/duplicate events may lead to incomplete or overstated coverage. Inspect before treating usage totals as accurate.

## Pi project extension

Add `adapters/pi-extension.ts` as an **absolute** path in the target project's `.pi/settings.json` `extensions` array (merge existing settings and ensure project trust). Do *not* copy the extension file alone: its relative imports require the full independent package. Then restart Pi or `/reload` in the target project.

## What to expect

Ordinary development requests create Task/Step/Run records. Once an agent settles, an async verification worker runs configured tests; on success it records observed usage and cheap triage. A review candidate remains queued until a future separately validated AI improvement worker is implemented. Real Pi/Codex execution has not been checked in the user's workstation.
