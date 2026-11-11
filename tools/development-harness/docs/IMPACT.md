# Post-change impact evidence (directional, not causal)

## Why it exists

The success criterion for the development harness is **less developer time and fewer model tokens without increased failures or rework**. Creating a review, patch or verified draft is an intermediate output, **not an improvement result**. The user should develop normally; data collection and refresh happen in the detached post-task worker, with no per-task command.

## Evidence lineage

1. On a new Task, capture its original `source.head`, `source.clean`, and `source.provenance` **before development**. Existing Task forecasts are unchanged. A dirty/unavailable Git snapshot does not prove which improvement code was applied.
2. A read-only review saves `modelWallMs`, `reviewWallMs` and `modelTokens:null` when provider usage is not observable. Each attempted change saves `totalWallMs`, optional stage durations, and `modelTokens:null`. Include failed attempts as improvement effort. Wall durations are a **lower bound** on the complete operating cost; time outside the measured stages, including impact evaluation itself, is not yet attributed.
3. `verified-draft` is not an applied improvement. Only `integrated-local` attempts with a saved commit can contribute an impact evaluation. No remote push is allowed.
4. Compare technically accepted (`completed` by declared AC) Tasks with the same agent, kind and Step count. The related original Task can be a failure; it identifies the affected type, not a successful baseline. Baseline Tasks must finish **before** improvement starts. Post Tasks must start **after** integration, from a **clean Git HEAD that includes the improvement commit** (`git merge-base --is-ancestor`). Exclude Tasks straddling the change, missing Git evidence or started after another recorded integrated change.
5. At least three baseline and three post-change Tasks are required even to display a `directional-observation`. Token analysis additionally requires three observed-provider samples per side with no missing usage events. Provider-reported counts may still be lower bounds.
6. Calculate the separate before/after medians for observed active minutes and tokens. Show an explicitly labeled `directionalTimeBalanceMinutes` only when enough matched time evidence and known review/attempt wall durations exist. **Do not call this realized savings, proven causality, positive net ROI, or calibrated P30/P50/P80.** Net token and combined-resource ROI stay `null` until overhead telemetry and stronger attribution are implemented.
7. Persist one replaceable `impact/<attemptId>.json` snapshot per improvement attempt in Git-common state. This is *evidence*, not executable policy. Subsequent read-only reviews may see a bounded summary, explicitly marked observational and non-causal. Never auto-rewrite the improvement allowlist or production contracts from a favorable trend.

## Reading the results

From a trusted project with the harness installed:

```sh
node /ABS/path/to/pi-compose/tools/development-harness/bin/devh.mjs impact
```

Normal Pi/Codex Stop/agent-settled automatically starts the verification worker, which then refreshes the impact snapshots after delivery and the separate improvement attempt. `devh impact` is for inspection/debugging, **not required per development Task**.

Statuses:

- `not-applied`: draft or blocked attempt, no confirmed integration
- `unverifiable-exposure`: commit or repository evidence missing
- `incomparable-source-tasks`: related source Tasks cannot define one comparable workload type
- `insufficient-comparable-tasks`: insufficient clean before/after accepted Tasks
- `incomplete-token-coverage`: enough accepted time samples, too little provider token evidence
- `directional-observation`: enough observed samples for a provisional comparison, **not** proof of causality or net savings

## Limitations / next verification work

- **Workload equivalence is not proven by agent+kind+Step count.** Task difficulty, prompts, models, temperature, test scope, hardware, retries and background work can change. A matched workload benchmark or prospective controlled comparison is needed for stronger causal claims.
- A clean Git HEAD does not prove that the model ran identical source, dependencies or configuration throughout the Task. Manual/cherry-picked deployment of a draft is not recorded as `integrated-local`.
- Automatic collection of **review/proposal/verification model tokens**, subagent costs and provider invoices is incomplete. Missing coverage stays unknown; aggregate net token savings must remain unknown.
- The improvement loop currently has no empirically calibrated comparison and no independently verified Pi/Codex end-to-end run on the developer's workstation.
- Host termination can stop detached workers; the existing durable queue recovers on a later process invocation, not while the computer is powered off.
- An accidental/unauthorized automatic modification to the scoring or orchestration implementation would invalidate these comparisons. The core measurement and worker modules are excluded from automatic edit allowlists.

These constraints are deliberate: **one credible inconclusive result is better than a fictional efficiency gain.**
