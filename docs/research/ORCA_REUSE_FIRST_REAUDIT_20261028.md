# Pi Compose × Orca — 실사용 실패를 기준으로 한 재사용·교체 감사 (2026-10-28)

> **상태: 구현 전 재평가 / 기능 변경 미승인.**
>
> 본 문서는 Orca 공식 docs와 고정 소스 `stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8`, Pi `earendil-works/pi@v1.4.0`, Pi Compose `feat/orca-context-first-work-support-20261028`를 비교한 **확인 가능한 범위의 소스 감사**이다. 전체 저장소의 모든 파일이나 macOS GUI 경로를 실행/검증한 것은 아니다.
>
> 최우선 불변식: **고품질 Main Pi 컨텍스트·정확한 Fork·Pi Extension 유연성 > Orca 기존 기능 보존 > 새 편의 기능.** 따라서 기존 UI 및 세션/Worktree 상태 관리의 대체 구현은 기본적으로 금지. 사용자와 방향을 먼저 결정한 뒤 코드 변경.

## 1. 근본 원인

Pi Compose가 Orca의 Agent/Worktree/Native Chat을 데이터와 동작의 정본으로 다루지 않고, 자체 `OrcaAgentStore` 레코드에 별도 UI/상태/탭 연결을 구성했다. Orca는 같은 Agent/Worktree를 독자적으로 활성화하고 수명주기를 관리한다. 이 **두 관리 체계의 불일치**로 현재 선택 중복·모호한 상태·누락된 메뉴·복구 오류·불필요한 Git Worktree 중복 표시가 발생할 구조가 만들어졌다.

- `PiComposeOutline.tsx`가 일반 React 행과 `+ Agent` 버튼을 직접 렌더링한다. Orca의 `WorktreeCardAgents` / `DashboardAgentRow` 기능(상태, 미읽음, 포커스, 하위 Agent 표시, 보존된 완료 항목 등)을 가져오지 않는다.
- `PiComposeMenu.tsx`는 별도 생성 대화상자, 프로젝트/Worktree 선택과 생성 후 Orca 세션 채택을 재구성한다. 실패 시 Pi Compose와 Orca 상태의 원자성이 없다.
- `src/orca/agent-sessions.mjs`는 자체 `prepared`, `ready`, `connection-error`를 관리하고 별도 `git worktree add`를 실행한다. 이는 Orca의 실제 `working/waiting/done/idle` 및 자체 Worktree 생성·등록·실패 복구와 다른 계층이다.
- `scripts/orca-native-overlay.mjs`는 Orca 사이드바 행 자체에 Pi Compose 구성 요소를 추가하므로 원본 카드 상태·메뉴와 의미가 충돌할 수 있다.

## 2. 요구사항별 '기존 기능 우선' 매트릭스

| 실사용 문제 | Orca에서 확인한 기존 경로 | Pi Compose의 필요한 추가 정보/연결 | 기존 실험 코드 판단 |
| --- | --- | --- | --- |
| Work 선택 시 Main/Worktree까지 함께 강조됨 | `worktree-list/rows/item-row.tsx`의 `activeWorktreeId`, `WorktreeCardAgents.tsx`의 포커스 `paneKey`; Agent Dashboard도 포커스 제공 | `Pi session ID → Orca session ID / paneKey / workspace ID` 식별 연결; 컨텍스트 소속과 실제 실행 공간 구분 | 자체 하이라이트 제거, Orca 활성화·선택 모델 사용. 새 CSS 보정은 금지 |
| 사이드바 컨텍스트 그룹핑 | `WorktreeCardAgents.tsx` 및 `agent-row-lineage-model.ts`는 `parentPaneKey` 계층 제공. Orca Worktree 자체도 parent lineage 지원 | Main→Work→Support는 **실제 Pi 대화 상속/작업 관계**이며 Orca parent Worktree와 다름. Work가 다른 Worktree인 경우 cross-worktree 관계 어댑터 필요 | 별도 Main/Work/Support 전체 목록 재렌더링을 대체 대상으로 분류. 기존 `groupBy`(none/status/pr-status/repo)에 context 옵션은 없음 |
| Work 종료·삭제·메뉴·상태 | `WorktreeCardAgents`, `use-worktree-context-menu-model`, Native Chat 탭 메뉴, Session History의 삭제/Resume, Orca Agent Dashboard | 종료할 **Pi 실행**, Chat 탭 닫기, Pi 기록 삭제, Git Worktree 삭제는 독립적인 조작·확인 계약. Main과 미커밋 파일 보호 | 별도 종료/삭제 버튼 구현 금지. 기존 Orca 명령·메뉴로 연결 여부 확인 후 부족한 케이스만 |
| `+` 과다 | Orca 기본 `+` 및 Worktree/프로젝트 생성 진입점 제공 | Main/Work/Support 역할·source Main 선택이 기존 생성 흐름에 들어갈 수 있어야 함 | `PiComposeMenu` 전체 재작성·중복 버튼 제거 검토. 새 진입점 추가를 기본으로 하지 않음 |
| Work 완료인데 Main이 모름 | Orca Agents feed: 턴 종료·대기·응답 프리뷰. Activity thread, Notification, Session History, Orchestration message 및 `worker_done` 존재 | **실제 Work session → 관련 Main** 연결, Work가 보고한 결과/증거 참조. Main 대화에 원본 개발 로그 자동 투입 금지 | 새로운 알림·상태 시스템 금지. 기존 이벤트·세션 데이터에서 얇은 연결이 가능한지 확인 |
| Main에 `연결된 Work · 진짜 구현` 접기/펼치기 | `NativeChatSubagentRun.tsx` (하위 실행 항목), `NativeChatWorkingStatus.tsx` (턴 실행시간·펼치기), `NativeChatToolRun.tsx` (도구 이력 펼치기), `NativeChatTranscriptRow.tsx` (기존 기록 표시) | **다른 Pi 세션**의 결과가 Main transcript에 참조로 표시될 읽기 전용 관계 데이터. UI 열기 ≠ Main 모델 컨텍스트 자동 추가 | UI 자체 재작성 금지. Cross-session 참조·journal projection만 최소 확장 검토 |
| Work/Support 실행 공간 공유·분리 | Orca 정식 Worktree 생성 `src/main/runtime/workspaces/workspace-creation.ts`, Worktree lifecycle·Git Diff·보관 | 사용자가 지정하는 `shared` 또는 `isolated`를 정확한 Orca 작업 공간/실행 호스트와 연결 | 직접 `git worktree add`와 별도 registry는 대체 후보 |
| 닫힌 Native Chat 재열기 | `activate-ai-vault-structured-session.ts`의 refresh→reveal→activation 경로, `agentSession.reveal` RPC | Pi Compose provenance를 원본 Orca session identity에 연결. 중복 채택/다중 writer 방지 | 자체 reopen/복구 반복 구현 제거 검토 |
| Pi Extension·Context Fork | Pi SDK SessionManager 및 Extension 시스템; Orca Pi RPC + history/adoption | 활성 완료 Pi leaf 복제 보증 및 원본/새 session 구분; RPC에서 TUI전용 Extension UI 제약 가시화 | **이 부분이 Pi Compose 핵심 독자 책임**. Fork 증명 부분만 별도 도메인 모듈로 보존 검토 |

## 3. 기존 Orca 기능을 '그대로 쓸 수 있다'고 단정해서는 안 되는 경계

1. **Worktree lineage ≠ Pi context lineage.** Orca Worktree 부모·자식은 Git 작업 공간의 관계이며, Main Pi 세션 Fork 계보가 아니다. `AgentRowLineageTree`도 기존 오케스트레이션의 `parentPaneKey`/터미널 핸들 관계를 기반으로 동작한다. 단순한 Work→Main 연결 메타데이터만으로 모든 UI가 자동 연결된다고 보장할 수 없다.
2. **Turn 종료 ≠ 제품 기능 완료.** Orca Agents feed의 완료는 세션의 턴/상태 종료다. 회원가입 기능의 성공적 완료 보고, 승인, 머지 여부는 별도 근거다. 자동으로 '구현 완료'라고 쓰지 말 것.
3. **Orchestration `worker_done`은 모든 Work에 쓸 수 없다.** 공식 skill의 계약상 Run/Task/Dispatch와 감독 책임을 가진 worker만 유효한 lifecycle 이벤트를 보낸다. 사용자 주도 Fork된 일반 Work에게 이를 강제하면 기존 Work 반복 개발 방식과 충돌한다. 다만 메시지/Activity/작업 보고에 쓰는 기존 표현과 전송 인프라는 재사용 후보.
4. **Native Chat subagent UI ≠ 모든 독립 Work 표시.** `NativeChatSubagentRun`은 provider/journal에서 연결된 하위 실행 상태를 그린다. 별도 Pi 세션인 Work의 내용을 Main에 표시하려면 참조 항목을 journal/화면에 투영하는 최소 연결이 필요하다. UI 컴포넌트를 복제할 필요는 없다.
5. **Session delete ≠ Worktree delete.** Git 파일과 커밋되지 않은 변경을 보존해야 한다. UI에서 '삭제'가 무슨 대상을 파괴하는지 기존 Orca 명령의 실제 효과를 확인하고 분리.
6. **모델 컨텍스트 ≠ 화면 상세 표시.** Work 결과를 접어 볼 수 있다는 것은 Pi Main의 모델 메시지로 모든 결과가 자동 유입된다는 뜻이 아니다. Main이 질문하면 실제 Work 결과를 읽을 수 있는 읽기 전용 Tool은 별도로 검토할 수 있다.
7. **Pi RPC ≠ 모든 Pi TUI Extension UI.** Native Chat 기본 지원과 Pi TUI 경로 유지, 호환성 표시 필요.

## 4. 코드별 유지 / Orca로 대체 / 제거 후보 (아직 변경 승인 아님)

| 기존 Pi Compose 코드 | 분류 | 이유 |
| --- | --- | --- |
| `src/orca/completed-main-fork.mjs` | **유지·검증 후 수선** | Pi Main의 실제 완료 분기 지점 복제는 Orca 기본 사용자 흐름에 없음. 활성 leaf/settled 근거와 정확한 복제 검증 필요 |
| `src/orca/agent-sessions.mjs` | **최소 관계 메타데이터만 유지, 나머지 대체 검토** | Main/Work/Support 의미적 관계는 필요하지만 일반 Agent/Worktree 라이프사이클 복제 금지 |
| `orca-overlay/.../PiComposeOutline.tsx` | **대체 후 제거 후보** | Orca Agent 행/세션 표시/포커스와 충돌하는 2번째 목록 |
| `orca-overlay/.../PiComposeMenu.tsx` | **Orca 기존 생성 플로우로 이관 후보** | 사용자 기대 동작·에러 복구·Worktree 준비 중 UI가 이미 Orca에 있음 |
| `orca-overlay/.../PiComposeNativeChat.ts` | **Orca 정식 세션 adoption/reveal에 흡수 후보** | 세션 ID 연결은 필요하지만 자체 복원 체계를 재구현할 이유 없음 |
| `scripts/orca-native-bridge.mjs` / IPC | **최소 도메인 연결로 축소** | 자체 Agent/Worktree 관리 API를 계속 확장하지 않음 |
| `scripts/orca-native-overlay.mjs` | **정확한 호스트 확장점만 유지** | 후크·대화 참조·제품 메타데이터 연결에 필요한 소수 패치 외 Orca 컴포넌트 직접 덮어쓰기 최소화 |

## 5. 제품 수준으로 복구할 때의 검증 순서

**Phase 0 — 아직 코드 구현 없음**

1. Orca의 Agent/Session/Worktree 정본 식별자, 각 UI 컴포넌트/상태/액션 호출 흐름을 그린다.
2. Pi Compose의 source Main, Work, Support 의미적 관계를 정본 Orca session ID와 연결하는 **최소 metadata contract** 도출.
3. Main과 Work가 서로 다른 Git Worktree에서 실행될 때도 Agent 정보가 올바르게 표시되는지 코드로 검증.
4. Main의 `연결된 Work · 이름` 내역은 Work의 실제 **session journal**을 참조할지, Orca의 기존 orchestration message 모델을 사용할지 비교하고, 원본 수정/복제/자동전송 없이 펼칠 수 있는 인터페이스 조사.
5. 각 작업에 `Orca 기존 동작 → 추가해야 할 필드/조건 → 사용자 흐름 → 실패/정리 정책 → 실제 검증 방법`을 문서화한다. **기존 동작을 쓰지 않을 경우 이유를 명시**한다.

**Phase 1 — 사용자와 검토 후**

- Native Chat/Orca 정본 session + Pi lineage 연결을 먼저 정상화한다.
- 기존 Worktree/Agent UI를 사용하면서 context view만 필요한 최소 범위로 확장한다.
- 완료 알림·요약은 Orca의 Agents feed/Native Chat을 기본 사용하고, Work→Main 연결된 Work 항목만 읽기 전용으로 표시한다.
- 변경 범위로 인해 없어진 Orca 메뉴/상태/재개 흐름이 없는지 실사용 시나리오로 확인한다.

## 6. 결정이 필요한 것은 구현 기술이 아닌 사용자 행동

이미 합의한 아래 정책을 수정하지 않는다.
- Main에 고품질 요구사항/근거 축적; Work는 **진짜 Pi Fork**, Support는 독립 세션.
- Main은 Orca Worktree에 표시되되 Pi 세션은 Worktree 삭제와 분리해 보존.
- Work/Support 모두 같은 현재 폴더 또는 다른 Worktree를 선택 가능.
- Main→Work 초기 자동 개발 지시 금지; Work에서 반복 개발·사용자 리뷰가 기본.
- 자동 테스트·검증 Gate, 자동 머지, 자동 전체 개발 로그 Main 삽입 금지.
- Support→Work 입력 초안 전달은 사용자가 결정.

현재 남은 UX 확인은 'Orca 기본 계층 표시를 context 관계로 표현하기 위해 어느 정도 원본 구조 확장이 필요한지'와 'Work 마지막 완료 보고를 Main의 대화 내 접는 항목으로 보이게 하는 데 필요한 journal 연결'이다. **아직 새 상태 머신/새 Agent 목록/새 우클릭 메뉴를 만드는 근거는 없다.**

## 7. 소스 근거 (고정 commit)

- [Orca Agents & Sessions](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/model/agents-sessions.mdx)
- [Orca Agents feed](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/activity.mdx)
- [Orca Worktrees](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/model/worktrees.mdx)
- [Orca Native Chat](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/agents/native-chat.mdx)
- [Orca sidebar Agent rows](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/WorktreeCardAgents.tsx)
- [Orca Agent lineage](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/agent-row-lineage-model.ts)
- [Orca Worktree row activation](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/worktree-list/rows/item-row.tsx)
- [Orca Context Menu](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/use-worktree-context-menu-model.tsx)
- [Orca Worktree creation](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/workspaces/workspace-creation.ts)
- [Orca session reveal](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/lib/activate-ai-vault-structured-session.ts)
- [Orca Session history actions](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/right-sidebar/SessionRowTrailingActions.tsx)
- [Orca turn expandable detail](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatWorkingStatus.tsx)
- [Orca tool detail](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatToolRun.tsx)
- [Orca native subagent disclosure](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatSubagentRun.tsx)
- [Orca orchestration contract](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/skill-guides/orchestration.md)
- [Pi v1.4.0 Extensions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md)
- [기존 승인된 Pi Compose 결정](./ORCA_PI_COMPOSE_PRODUCT_DECISIONS_20261028.md)
