# Verification record — 2026-11-11 iteration

- Base: current pi-compose `main` after PR #31 (`7f51b6d4`), with 26 existing harness tests passing.
- New work: contract-level AC receipts; scope-change append-only plan; source-specific provider attempt matching; durable review/automatic improvement candidate queues; PR #29 review/change engine adapted with local policy and safety gates.
- `npm run check` in nested package: 46/46 local tests passing at latest local integration. The exact final count is reported in the final CI result.
- Synthetic tests confirm accepted/failed/mismatched Step checks, immutable original plan, Codex parent/subagent attribution, review receipt + backoff, time/token economic gates, rejected verifier, detached worktree draft, and empty policy deferral.
- Working mock does not prove live authenticated Pi / Codex compatibility. Neither `pi` nor `codex` was installed in the test container. Node Syntax Check for `.ts` is not a Pi extension runtime check.
- The task of building these changes was recorded through the harness as a development Task in a local Git state directory. Since this chat host exposes no model token usage to the package, its actual tokens remain unknown. The configured initial forecast is explicitly uncalibrated.
- No real cloud/host background process, automatic remote push, or unsupervised contract change was performed.
