# Five end-to-end development scenarios

[← README](../README.md) · [Installation](SETUP.md)

**Prerequisite:** install the PR #3 build, run `pic`, approve the recommended initial setup (or `pic setup` later), authenticate Pi with `/login`, and select `/model`. Handoff/Verify must be enabled in `pi config` for the corresponding slash commands. Workmux's Pi Hook must be configured for Dashboard agent statuses.

## 1. Fork a Main API design into a separate Worktree

**Situation:** Main has already discussed a user profile API. The current `name` field must not be removed because old clients depend on it.

In the project directory:

```bash
cd ~/projects/member-api
pic
```

In **Main Pi**:

```text
Add displayName while keeping the existing name field backward-compatible.
Old clients use name; never delete or repurpose it.
Discuss migration and response shape before implementation.
```

When the actual design is agreed:

```text
Delegate the profile API implementation to a new developer Agent.
Fork this Pi conversation and use a new Git Worktree.
Keep the agreed reasons and prohibitions intact.
```

Or directly:

```text
/compose launch Implement profile displayName and preserve name compatibility
```

Select **Fork existing Pi session → Current Pi session → Git Worktree → new branch**. Review the full instruction and exact Fork source in Pi's confirmation. **Approve** to create the Agent and Worktree; **cancel** leaves them uncreated.

Stay in Main and discuss another feature. Use `/compose` → choose the profile Agent → **actual delegated instruction** to check what you asked for, or **open existing Agent** to discuss implementation. Verify the Child Pi actually received the original discussion; a successful process launch alone does not prove Fork context fidelity. Return by selecting the **exact Main** entry in `/compose`.

## 2. Delegate independent code exploration or tests

**Situation:** You need an architecture overview or a test pass, but the work does not depend on a long Main conversation.

In Main:

```text
Start an Independent Agent to inspect the repository's OAuth callback implementation.
Do not change source code. Use the shared directory and report findings only.
```

Or:

```text
/compose launch Inspect OAuth callback paths and summarize findings without edits
```

Choose **Independent new session**: no Main history is needed, so it avoids inheriting unrelated reasoning. Choose **Shared directory** for a read-only exploration or a low-risk test job. This still launches a separate Pi process, so avoid concurrent file edits in Shared. For file-changing or potentially destructive work, choose **Git Worktree** to isolate the checkout.

Confirm and execute. Later, use `/compose` for the exact Agent or `/compose monitor` for the workmux-managed subset. **Independent does not mean auto-merge or automatic report insertion into Main.** Request a concise result or explicitly send a handoff where appropriate.

## 3. Switch between profile and payment discussions

**Situation:** The profile implementation is running; you want to discuss payments and later review the profile work.

In the profile Main, delegate work as in scenario 1. Continue the active Pi conversation with payment questions, or start a separate **saved payment conversation** through Pi's normal session commands. Name sessions descriptively where supported by Pi.

To return to an earlier feature discussion in the **same checkout**:

```text
/compose sessions
/compose sessions 프로필
```

This searches Pi's saved project conversations and **switches conversation inside the current Pi process**. It does not start an Agent, reopen tmux or claim an old conversation is live elsewhere. To visit a running implementation Agent, use **`/compose`**, not sessions.

Example of the difference:
- `/compose` → '프로필 표시명 구현' → **existing Agent window**, or **read Handoff**.
- `/compose sessions 결제` → select the existing Pi **payment discussion**, not a workmux running pane.

Existing `/compose back` and Pi's `/resume` are available as advanced alternatives. Never choose a matching title alone when the exact session ID is ambiguous.

## 4. See different products' work without creating a new project manager

**Situation:** The front-end application and the payment SDK are separate Git repositories.

From separate terminal windows:

```bash
cd ~/projects/frontend && pic
# different terminal
cd ~/projects/payment-sdk && pic
```

Each bare `pic` manages its own project-scoped tmux session. Within Pi, **`/compose monitor`** opens workmux's Dashboard, which can show Hook-registered agents across projects. You can inspect recent terminal output and Git changes or jump to a registered Agent there.

For a workmux state Hook, approve `workmux setup` during the first-time `pic` setup, or run `pic setup`. Without Hook registration, the Agents view may be empty. Shared Directory Pi processes not managed by workmux can still be reached via each project's `/compose` and ordinary tmux sessions.

**Responsibility:** Pi Compose knows the exact Main↔Agent relationship *inside a project*; workmux/tmux owns cross-project switching and observations. Do not interpret workmux's recently finished response as a completed product feature.

## 5. Handoff → Verify → Main decision (not automatic merge)

**Situation:** The delegated profile Agent reports that the code is ready.

In the **implementation Agent**:

```text
/compose-handoff
```

The Agent prepares a report describing what it actually implemented, preserved constraints and WHY, Git HEAD, changed paths, checks actually performed, and remaining risks. A developer report is a **claim**, not an independent acceptance check.

For a meaningful diff scope, perform an **explicit** independent verification if desired:

```text
/compose-verify main
```

The verifier is a new read-only Pi call (user approval required). It inspects Git changes and relevant contracts, reports incomplete evidence if changes were truncated, and does not edit code. A branch named `main` must exist to use that example base ref; otherwise supply the actual base ref or omit it and acknowledge the narrower scope.

Back in **Main**:

```text
/compose
```

Choose the exact Agent → **인계·검토 결과 확인**. When the Worktree+branch or actual Child Pi session identity was verified, you can read the recorded results **without switching to the Agent terminal**. Shared Directory reports can be tied to an exact Pi conversation but not assigned exclusive ownership of concurrent Git edits.

You now decide whether requirements were met, which tests should still run, and when to integrate code. **Handoff, Verify and Git merge are three separate actions**. Pi Compose neither merges branches nor deletes Worktrees automatically.

---

## Important boundaries

- A tmux window existing ≠ Pi model currently working.
- A workmux Hook marking a turn done ≠ implementation finished.
- A successful Fork command ≠ verified inheritance of every instruction.
- A Handoff report ≠ independent review; a review ≠ user-approved integration.
- An already-running Pi process is not automatically duplicated when selecting it.
- macOS/Ghostty rendering, Pi authentication and the entire model-mediated flow still require actual user-environment verification. See [manual verification](validation/task-hub-ux.md).