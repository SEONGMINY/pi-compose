# Next implementation gates (not yet completed)

1. **Trustworthy task completion**: AC receipts scoped per Step, validated by a non-model verifier. Distinguish run stop, checks pass and semantically completed feature. Add human corrections and linked rework without falsely grouping unrelated prompts.
2. **Automatic cold-start numerical forecasts**: budget a short no-write estimate before implementation, record its model and token costs, preserve uncertainty. Historical estimates require verified source coverage and empirical calibration.
3. **Provider adapters E2E**: install in actual Pi `@earendil-works/pi-coding-agent` and Codex; verify lifecycle differences, subagents, retries, missing token data, hook trust, exact stable identities and interruption handling. Synthetic event tests are not live compatibility guarantees.
4. **Resilient event journal**: upgrade JSON snapshot to append-only evidence/audit for crashing processes, session reuse, concurrent hooks, out-of-order provider attempts and cross-machine alignment; guarantee per-run idempotence with stable provider IDs.
5. **Task decomposition**: bounded model-generated plan with evidence-linked dependencies and executable, verifiable AC. Do not force a new agent session per Step. Add scope-change versioning without overwriting initial forecasts.
6. **Improvement loop**: port root-cause evidence validation and architecture → gate → AI instructions → user behavior ranking from pi-compose Draft PR #29 to an engine-neutral module; run from a separate durable queue, not the agent Stop Hook. Evaluate net time and token return including analysis and verification overhead. Guard recursion and enforce resource caps.
7. **Safe code improvement**: project-specific allowlists, Worktree isolation, independent verifier, no remote main push or unapproved contract edits. Only a controlled local-main fast-forward after freshness/integration checks.
8. **Deployment**: extract this embedded package into a separate remote repository in a future task and review whether to retire or split old pi-compose Draft PR #29. Never merge Draft #29 automatically.

## Explicitly out of scope
Context Hub, MCP knowledge services, personal architectural philosophy, pi-compose `pic` runtime UX, arbitrary new-agent orchestrators, Docker, servers and always-on databases.
