# Pi Compose — Reference-led product contract (2026-10-27)

## Product boundary

The product is a Pi-native **conversation-first development harness**. Its differentiator is not an agent dashboard: the user discusses requirements, alternatives, why a decision was made, and hard prohibitions in Main; explicitly forks that *exact* Pi session into a coding agent with a separate checkout; keeps Main unchanged for the next discussion; returns to the actual changes and original conversation. Context preservation means preserving the Pi session lineage, **not** claiming model comprehension of all prior context.

The default user journey is **Discuss → Delegate → Continue Main → Jump to Agent → Review actual Git changes → Return to Main → Resume saved conversations**. Choosing Context, Workspace and branch is not a mandatory first-use ritual. Those dimensions remain independent under Advanced.

## Source observations vs design decisions

| User problem | Verified reference and observed behavior | Pi Compose decision | Why different | Acceptance |
|---|---|---|---|---|
| Launch is buried behind options | Kiro [`/spawn`](https://kiro.dev/docs/cli/reference/slash-commands/) takes a task and launches a user-directed parallel session; `Ctrl+G` opens Crew Monitor | Start from Main conversation. An explicit user request or discoverable task action delegates the task, defaulting to **current Pi Fork + Worktree**, with one final confirmation | Exact current Main Pi session context is the differentiator; Kiro `/spawn` does not establish this contract | No repeated Context/Workspace/source/branch questions on the default path; confirmation names exact source |
| Worktrees and task context feel disconnected | Orca [Worktrees](https://www.onorca.dev/docs/model/worktrees): Create → Work → Review → Ship, one task and agent per isolated checkout | Each Compose task connects original Pi session, launched child, exact Git checkout and terminal target | Worktree is default, **not mandatory**. Fork+Shared and Independent+Worktree must remain possible | Branch and session identity checked; no main mutation or implicit merge |
| Agent status looks complete too early | Orca [launch implementation](https://github.com/stablyai/orca/blob/main/src/main/agent-launch/agent-launch-prompt-delivery.ts) separates submitted/handoff/unconfirmed; Orca status has `unverifiable` and `unconfirmed` states | Distinguish dispatch, exact target, Pi-linked, verified parent session and initial prompt observation when available; never equate with implementation done | Pi exposes session events, but model understanding is not provable by metadata | Missing observations display Unknown, not Done; safe retry never blindly duplicates a spawn |
| Too many navigation commands | Kiro [Terminal UI](https://kiro.dev/docs/cli/terminal-ui/) separates ongoing chat, task observation and saved conversations; Orca [Jump Palette](https://www.onorca.dev/docs/model/quick-open) jumps to exact worktrees | A small Pi-native work selector; current Main, exact child, saved chats. Pi's own `/resume` owns broader session discovery | TUI overlay is available without a permanent sidebar or a new layout engine | Main → child → Main; existing sessions resume without starting a new agent |
| Handoff required to see a result | Orca [Review AI diff](https://www.onorca.dev/docs/recipes/review-ai-diff): inspect worktree diff, send feedback, inspect again | Offer **Git review** directly for a verified checkout, with the recorded base ref, untracked warnings, limited text output; optional Handoff/Verify for semantic evidence | Native Git/pager replaces bespoke Diff renderer; meaningful contracts remain in Main | Worktree changes reviewable even without a Handoff; missing base reported explicitly |
| Users cannot tell what failed | Orca [Worktrees](https://www.onorca.dev/docs/model/worktrees) preserves failed workspace with Retry; launch implementation treats unknown dispatch as not safe to duplicate | Stage-level diagnostics, clear recovery, inspect existing worktree/session before a retry; no auto-delete | Avoid introducing a new asynchronous orchestration daemon or DB | Failure does not erase Main/session/checkout; concrete diagnostic stage and next action |

**Observed reference behavior** is supported by the linked docs/source. The rationale for the vendors' own internal UI decisions is **not known** unless explicitly documented. Our product decisions above are reasoned adaptations, not claims about their proprietary experiments.

## Platform ownership and constraints

- Pi: models, history, SessionManager, native fork, native session selection, transcript, Extension APIs.
- workmux: default Git Worktree+tmux setup and Pi integration; other existing tools may provide terminals and Git diff.
- Git: actual checked-out files, branches, patch and untracked status.
- Compose: explicit intent, selected Main identity, execution verification **to the extent observable**, exact Main↔Child↔Worktree↔tmux links and safe actions.
- No autonomous merge, branch deletion, destructive cleanup, model status inference from terminal existence, or copying a summary as a substitute for the Pi Fork.
- Shared and Independent are **advanced alternatives**, not banned combinations.
- Existing task records remain readable. No new session DB is introduced.

## Status semantics

1. Planned: read-only verified input; no new resources.
2. Dispatched: external command accepted, but Pi existence unproven.
3. Target-linked: unique tmux/workmux target observed.
4. Pi-linked: child Pi JSONL + exact target matches.
5. Context-linked: child's `parentSession` matches the approved source *when inspectable*.
6. Prompt received / work begun: separately observed Pi events and user confirmation; **not inferred** from subprocess success.
7. Reviewable: Git worktree and recorded base ref can be inspected; work may not be finished.
8. Complete / verified: explicit user or agent claims and a separate verification scope, not idle or a status dot.

## End-to-end acceptance scenarios

A. Main with a saved Pi session → explicit delegation → confirm default Fork+Worktree → new Child with exact parent session and full user instruction → Main continues.

B. Select exact Child terminal without spawning it again → return to exact originating Main window. Closing a pane must not infer that a task was completed.

C. Old Pi chats searched through native SessionManager / `/resume` with correct cwd scope; exact saved file reopened without creating an unrelated agent.

D. Failed preflight/dispatch/target linkage retains the original Main, user task and existing resources; retry requires inspection rather than blind duplication.

E. Review actual Git changed/untracked paths and a bounded diff without Handoff; distinguish the agent claim from verified changes; no automatic merge.

## Execution / evaluation

Static/type checks and scoped unit tests can validate input, routes and diff scoping. Real Pi provider login, model prompt consumption, workmux Pi Fork, Ghostty/tmux switching and model compliance **must be run on macOS** and reported separately. Do not count dispatch as successful development.
