# Five end-to-end development scenarios

[← README](../README.md) · [Installation](SETUP.md)

**Prerequisite:** install the PR #3 build, run `pic`, allow the automatic Pi Compose core setup to complete (or use `pic setup` to retry missing packages), authenticate Pi with `/login`, and select `/model`. Handoff/Verify must be enabled in `pi config` for the corresponding slash commands. Workmux's Pi Hook must be configured for Dashboard agent statuses.

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

Or start without memorizing a command: type **`/compose`** and choose **`+ 새 Agent에게 작업 위임`**. Alternatively:

```text
/compose launch Implement profile displayName and preserve name compatibility
```

**Before launch:** the existing Main Pi session should have been created in the Git repository root if you choose **Fork + Worktree**. The current workmux integration cannot discover arbitrary nested-cwd Pi sessions by ID. If the preview fails with a source cwd mismatch, use **Fork + Shared** or choose a saved Pi session whose cwd matches the repository root; do not delete the original conversation.

Choose **Fork existing Pi session → Git Worktree → Current Pi session → new branch** (the actual wizard order). Review the full instruction and exact Fork source in Pi's confirmation. **Approve** to create the Agent and Worktree; **cancel** leaves them uncreated.

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

To return to an earlier feature discussion in the **same Pi working directory**:

```text
/compose sessions
/compose sessions 프로필
```

This searches Pi's saved project conversations and **switches conversation inside the current Pi process**. It does not start an Agent, reopen tmux or claim an old conversation is live elsewhere. To visit a running implementation Agent, use **`/compose`**, not sessions.

Example of the difference:
- `/compose` → '프로필 표시명 구현' → **existing Agent window**, or **read Handoff**.
- `/compose sessions 결제` → select the existing Pi **payment discussion**, not a workmux running pane.

Existing `/compose back` and Pi's `/resume` are available as alternatives. Pi stores sessions by working directory; use the Pi `/resume` picker and its available session-scope options for conversations recorded from other directories. A saved conversation is not the same thing as a still-running tmux window. Never choose a matching title alone when the exact session ID is ambiguous.

## 4. See different products' work without creating a new project manager

**Situation:** The front-end application and the payment SDK are separate Git repositories.

From separate terminal windows:

```bash
cd ~/projects/frontend && pic
# different terminal
cd ~/projects/payment-sdk && pic
```

Each bare `pic` manages its own project-scoped tmux session. Within Pi, **`/compose monitor`** opens workmux's Dashboard, which can show Hook-registered agents across projects. You can inspect recent terminal output and Git changes or jump to a registered Agent there.

For a workmux state Hook, approve the separate external workmux Hook prompt during first `pic` setup, or run `pic setup`. Without Hook registration, the Agents view may be empty. Shared Directory Pi processes not managed by workmux can still be reached via each project's `/compose` and ordinary tmux sessions.

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
## 실사용 수정본 재확인 — 필수 수동 흐름

**모든 항목은 사용자의 macOS에서 미검증 상태입니다.** 코드 반영과 실제 작동을 구분합니다.

1. `pic doctor`로 Pi, tmux, workmux 및 Extensions를 점검하고 `pic`으로 로그인/모델을 확인합니다.
2. Main에서 요구사항과 이유를 논의한 뒤 `/compose` 첫 작업으로 **+ 새 Agent에게 작업 위임**을 선택합니다.
3. **Fork existing Pi session → Git Worktree → Current Pi session → 새 브랜치**와 실제 작업 지시를 확인하고 승인합니다.
4. `실행 요청 전달`은 Child Pi 실행 준비 완료가 아닙니다. `/compose` → 작업 → **기존 Agent 화면으로 이동**해 Fork된 대화와 개발 지시를 실제로 확인합니다.
5. Agent에서 구현을 계속하고 `/compose`의 **Main으로 돌아가기**로 복귀합니다. 원본 Main의 실제 창과 연결이 확인되지 않으면 임의로 새 Pi를 생성하지 않습니다.
6. `/compose sessions`로 현재 폴더의 이전 대화를 고르고, 기존 Pi 프로세스에서 전환되는지 확인합니다. 해당 폴더에서 검색되지 않으면 Pi `/resume`을 확인합니다.
7. Worktree/세션 오류를 재현했다면 실패 메시지의 **plan / dispatch / target** 단계, `git worktree list`, `pic doctor`를 확인하고 `pic diagnostics export --days 1`을 내보냅니다. 성공 기록만으로 개발 작업 완료라고 판단하지 않습니다.
