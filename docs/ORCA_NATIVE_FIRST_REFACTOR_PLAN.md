# Pi Compose × Orca — Native-first 리팩터링 실행 계약

> 작성일: 2026-10-28 · 기준 Orca `stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8` · Pi `v1.4.0`
>
> **상태: 설계 및 1차 위험 제거. 전체 리팩터링/실사용 완료 아님.**
> 브랜치 `refactor/orca-native-first-20261028`에 기존 사용자 검증 브랜치의 변경을 보존하고, Orca 기본 `+` 가로채기를 제거하는 작은 코드를 반영함. 원래 `feat/orca-context-first-work-support-20261028`는 수정하지 않음.
>
> 제품 우선순위: **Main Pi 고품질 컨텍스트 / 정확한 활성 완료 지점 Fork / Pi Extension 자유 > Orca 검증된 UX·런타임 재사용 > 새로운 UI·상태 시스템.**

## 1. 가장 중요한 결론: 동일한 Agent를 두 번 관리하지 않는다

| 소유권 | 정본(수정·실행·상태를 책임지는 곳) | Pi Compose가 별도로 기록할 것 |
| --- | --- | --- |
| Pi 원본/포크 대화와 메시지 | Pi SDK의 session 파일·provider session ID | `mainProviderSessionId`, Fork 출처 `sourceSessionId/sourceEntryId`, 검증 근거 |
| Orca Chat/터미널 탭/재개/포커스 | Orca structured agent session, native tab, session history | **실제 Orca session ID 참조**. 새 탭 상태 머신·자체 포커스는 없음 |
| Working/Waiting/Done/Idle/알림 | Orca Agent Status / Agents feed / Dashboard | **별도 `prepared/ready/done`를 실제 활동 상태처럼 표시하지 않음** |
| Worktree 생성/등록/삭제/스냅샷 | Orca `createManagedWorktree`, Worktree lineage, Git UI | 선택한 실행 공간 ref와 Main context ref만 연결 |
| Agent 트리/확장/선택 | Orca `WorktreeCardAgents`·`DashboardAgentRow`·`agent-row-lineage` | Main/Work/Support **의미적 관계**를 native rows에 투영 |
| 실행 도구·파일 읽기·추론 표시 | Orca Native Chat turn/tool/subagent transcript | Work의 실제 session transcript를 **읽기 전용 참조**하는 연결 정보 |
| 메시지/초안 | Orca structured Chat journal·draft store | Support→Work 사용자가 요청한 미전송 초안 목적지만 선택 |

**중요:** `Main`은 Pi의 설계 세션이다. `Work`는 **새 Pi 세션으로 생성된 실제 Fork**. `Support`는 원본 컨텍스트를 상속하지 않는 별도 세션이다. `Orca Worktree parent`나 기존 `orchestration.parentPaneKey`를 Pi Fork의 증거로 쓰면 안 된다.

## 2. 기존 Orca → 필요한 최소 변경의 정확한 대조

### 2.1 선택, 상태, 종료/삭제, 재열기, 메뉴

- `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx`: 이미 `useFocusedAgentPaneKey`, `DashboardAgentRow`, 읽지 않은 메시지, child disclosure, 실제 status, 활성화 및 오래된 Agent 행 정리를 모두 사용한다.
- `src/renderer/src/components/dashboard/DashboardAgentRow.tsx` 및 `DashboardAgentRowTrailingControls.tsx`: 행 전체 선택, 상태, trailing actions, 계층 펼침을 제공한다.
- `src/renderer/src/components/sidebar/worktree-list/rows/item-row.tsx`: 바깥 하이라이트는 **Git Worktree 활성 상태**로서, Agent 하이라이트와 의미가 다르다. Work 선택 시 두 가지를 모두 Agent 선택처럼 꾸미지 않는다.
- `src/renderer/src/lib/activate-ai-vault-structured-session.ts`의 `revealStructuredSession`: 재열기 기존 계약 사용. 파일에서 자체 `resume`/새 세션 생성/활성화 과정을 다시 만들지 않는다.
- Orca 기존 Chat 탭 메뉴, session history 및 Worktree context menu의 **정확한 액션 효과**를 재사용한다. Agent 행의 `Dismiss`는 상태 행을 숨길 뿐 프로세스 중지나 Pi 기록 삭제와 다르다. 탭 닫기/세션 종료/Pi 기록 제거/Worktree 삭제는 각각 확인해야 한다.

**최소 확장:** 저장된 context link에 Orca의 `sessionId`와 실제 실행 `workspaceId`를 연결해 기존 활성화/상태/메뉴 대상이 정확한 하나의 세션을 가리키게 한다. 기존 컴포넌트를 복사하거나 두 번째 Agent row를 렌더링하지 않는다.

### 2.2 Main/Work/Support 컨텍스트 계층 표시

- Orca `agent-row-lineage-model.ts`는 `parentPaneKey` / parent terminal handle을 쓰는 실제 Agent 관계 표시를 지원한다.
- Orca `WorktreeCardAgents`는 **특정 Worktree 안의 Agent**만 선택한다. Main과 Work가 서로 다른 Worktree일 때 기존 데이터를 그대로 부모 Worktree에 넘기면 소속/상태가 틀릴 수 있다.
- Orca `WORKSPACE_GROUP_BY_CHOICES`는 `none/status/pr-status/repo`; 이는 Worktree 그룹 선택이고 Pi 컨텍스트 그룹이 아니다.

**최소 확장:** 동일 프로젝트의 **실제 Orca Agent row**를 session ID 기준으로 합친 *읽기 전용 context projection*. 기존 `DashboardAgentRow`를 그대로 사용하고 활성화·메뉴·상태 동작은 원래 Worktree/session에 라우팅. `Main → Work → 연결된 Support` 관계는 Pi metadata에서 온다. `Main이 Worktree에 여러 개`인 경우도 표현한다. `parentPaneKey`를 가짜로 쓰거나, Orca Worktree lineage를 바꾸지 않는다.

### 2.3 Main의 접히는 Work 결과 보고

**원하는 UX (새 알림 화면 아님):**

```text
Main 대화
  요구사항/설계 논의...
  ▸ 연결된 Work · 진짜 구현
    회원가입 기능 구현을 완료했습니다.
    [펼침]
       Work가 실제 작성한 결과 보고
       실행 기록(명령/읽은 파일/추론 등, host에 존재하는 범위)
       관련 Git 변경과 출처
```

- Orca 기존 `NativeChatSubagentRun` / `NativeChatSubagentEntries`는 하위 Agent의 상태·펼치기를 그린다.
- `NativeChatWorkingStatus`, `NativeChatToolRun`, `NativeChatTranscriptRow`는 실행 시간·파일·명령·추론을 그린다.
- 다만 이들은 **동일 provider/journal에 연결된 하위 Agent나 해당 대화의 Tool Run**을 전제한다. 독립된 Pi Fork Work의 기록이 Main journal에 자동 포함된다는 뜻이 아니다.

**추가 구현은 오직 교차 세션 참조:**
1. `mainOrcaSessionId, workOrcaSessionId, workPiSessionId, workTurnId, reportedAt`를 동일 host가 검증한 **읽기 전용 참조**로 둔다.
2. Work의 **실제 완료 응답**을 인용한다. 응답이 단순 턴 종료라면 '구현 완료'라고 단정하지 않는다.
3. Main 화면에는 외부 Work 결과 **접기 항목만 투영**한다. 클릭하면 Orca 기존 transcript/detail renderer를 활용해 원본 데이터가 있는 경우만 상세 표기한다. 클릭해도 **대화 전환·자동 모델 메시지 전송은 하지 않는다**.
4. Main 모델이 직접 결과를 질문받았을 때는 표시된 UI를 '기억'할 수 없으므로, 필요한 결과만 읽을 수 있는 **읽기 전용 Pi tool**은 별도 최소 범위로 검토한다.
5. 기존 Orca `worker_done`는 Run/Task/Dispatch 감독하에 있는 worker의 실제 lifecycle 신호다. 모든 일반 Work에 강제하거나 Pi turn 종료를 `worker_done`으로 위장하지 않는다.

### 2.4 Orca Worktree 생성·삭제

- 기존 `src/main/runtime/workspaces/workspace-creation.ts`의 `createManagedWorktree`가 생성·metadata·lineage·setup·UI activation·실패 복구를 묶어서 관리한다.
- 현재 Pi Compose `src/orca/agent-sessions.mjs`의 `git worktree add -b ...`는 Orca 등록/에러/정리와 분리되므로 **대체 대상**이다.
- 현재와 별도 Worktree 두 선택지는 그대로 유지한다. 별도 Worktree의 코드 기준 HEAD·미커밋 변경 처리 및 실제 cwd는 Orca와 Pi 양쪽에서 일치시켜야 한다.
- Worktree 삭제는 Git 파일을 없앨 수 있다. Main과 Work의 Pi 세션 파일은 사용자 동의 없이 삭제하지 않는다.

### 2.5 Pi Extension / Native Chat

- Orca는 Pi RPC Native Chat을 지원하지만 모든 TUI 전용 Extension UI를 RPC에서 지원하는 것은 아니다.
- Native Chat 기본 제공 및 Pi TUI 진입 경로를 **기능적으로 함께 유지**. 단순한 모양 통일 때문에 Pi Extension을 제한하지 않는다.
- 활성 leaf 미확정 / 미완성 JSONL / 기존 Main 동시 실행은 반드시 실패를 명시하고 원본을 보존한다. source Main의 완료 응답뿐 아니라 **활성 Pi branch·fork 지점** 검증 필요.

## 3. 기존 코드에 대한 단계별 변경 범위

| 현재 구현 코드 | 처리 방향 | 이관 완료 조건 |
| --- | --- | --- |
| `src/orca/completed-main-fork.mjs` | **유지·검증** | 정확한 활성 완료 leaf, 복제 경로·증거, 원본 불변 |
| `src/orca/agent-sessions.mjs` | Pi source/fork provenance와 context relation만 남기고 `state`, Git, 탭 생명주기 제거 | Orca 세션·Worktree가 동일한 상태/작업 공간의 정본 |
| `PiComposeOutline.tsx` | **최종 제거 대상** | Orca Native Agent row로 Main/Work/Support 계층·포커스·메뉴·상태 표시까지 대체 |
| `PiComposeMenu.tsx` | Orca 기존 생성 경로에 역할·source 선택만 확장 | 원본 `+`, 단축키, 생성 실패/재시도/기존 기능 그대로 |
| `PiComposeNativeChat.ts` | Orca create/reveal 채택만 남기고 중복 restore 로직 제거 | 탭 닫기/재열기/세션 owner 보호 정상 |
| `orca-native-bridge.mjs` / IPC | 별도 registry의 UI 행 관리 축소 | Pi Fork와 관계 조회만, Orca 실행 상태 추정 금지 |
| `orca-native-overlay.mjs` | 재사용 불가한 정확한 host 확장점만 패치 | 기존 Orca 기능 overwrite 0개, 업스트림 diff 최소 |

**제거 순서:** 먼저 읽기 전용 session link → 실제 Orca 행 대체 → 기존 상태/복원/생성/Worktree 경로 이관 → 중복 코드 삭제. 읽기 전용 표시는 Orca 상태를 추정하지 않는다. 예전 `PiComposeOutline`을 먼저 삭제해 Main/Work 관계를 잃어버리지 않는다.

## 4. 이번 브랜치에서 이미 적용한 안전한 1차 변경

`refactor/orca-native-first-20261028`에서:

1. Orca `NewWorkspaceButton`의 `openWorkspaceCreationComposerWithTourHandoff()`, 기존 라벨, 키보드 shortcut 관련 코드를 **더 이상 덮어쓰지 않는다**.
2. Pi Compose의 첫 열기 자동 생성 팝업을 제거한다. Main/Work 선택은 사용자가 **명시적으로 시작**한다.
3. Pi Compose 생성 Dialog 안의 중복 `Main → Agent` 관계 미니 트리를 제거한다. 이 관계의 정본과 표시 방식은 하나만 둔다.
4. 기존 overlay가 남아 잘못된 전역 `+` 동작을 유지하지 않도록 새 **깨끗한 Orca checkout** 경로 사용.

여기까지는 **Orca 원본 회복을 위한 제한된 변경**이다. 현재 별도 Pi Compose sidebar outline과 자체 Agent 저장소, 직접 Worktree 생성 등 더 큰 중복은 아직 남아 있으며, 기능을 완성했다고 표현하지 않는다.

## 4.1 진행 결과 — Orca 기존 Agent 행으로 교체한 2차 변경

**코드에 반영 (macOS 미검증)**

1. `PiComposeOutline.tsx`를 Orca 실제 사이드바에서 **마운트하지 않는다**. 해당 소스는 레거시/마이그레이션 참고로 저장소에 남겨두지만 Orca 번들로 복사하지 않는다. `item-row.tsx`에 가했던 별도 리스트 삽입과 pointer/click 가로채기를 제거한다.
2. Orca `WorktreeCardAgents` / `DashboardAgentRow`의 원본 상태·선택·계층 표시·Dismiss를 기본 그대로 쓴다. Worktree 우클릭 메뉴 `WorktreeContextMenuView`에 **Pi Compose Agent 만들기…** 한 항목만 추가한다.
3. `use-native-chat-context-menu.tsx`가 현재 열린 Pi Native Chat과 등록된 Pi Compose Main의 **Orca session ID**를 검증할 때만 **이 Main에서 Work 만들기…**를 기존 채팅 우클릭 메뉴에 추가한다. Main을 자동 추측/신규 등록하지 않는다.
4. Work/Main/Support의 새 Native Chat은 `agentSession.rename` 기존 호스트 기능으로 **Main · 이름 / Work · 이름 / Support · 이름**을 설정한다. 별도의 Agent 행 타이틀 UI를 만들지 않는다. 이름 저장이 실패해도 실제 Pi 세션과 Orca Chat을 삭제하지 않는다.
5. Pi Compose 생성 Dialog에서 기존 Orca 생성으로 이동하는 중복 메뉴를 제거한다. Orca 기본 `+`/단축키/투어/일반 Worktree 생성 및 우클릭 메뉴는 바꾸지 않는다.
6. 신규 체크아웃 `.cache/orca-upstream-native-first` 사용. 변경된 upstream patch의 원본 문자열 일치 여부를 확인했지만 GUI/typecheck/실사용 검증은 아직 아니다.

**아직 미완료이며 이번 결과로 완료됐다고 주장하지 않는 것**

- Main → Work → Support를 **서로 다른 Orca Worktree에서도 하나의 컨텍스트 트리로 투영**하는 기능. 지금은 원본 Orca Worktree 안의 Agent 행과 상태가 정본이며, Main/Work 관계 데이터는 Pi Compose에 보존된다. 이 부분이 없는 상태를 최종 제품 UI로 간주하지 않는다.
- Orca의 정식 Worktree 생성·등록 경로로 이전. 기존 Pi Compose 백엔드는 별도 Worktree를 `git worktree add`로 만들기 때문에 미등록/복구 문제가 남는다.
- Main에 Work 결과의 접힌 보고를 표기하는 교차 Pi 세션 저널 연결.
- 기존에 이미 이름이 있는 Agent 자동 이름 변경/이전. 사용자 지정 이름과 세션 원본을 보존하기 위해 재명명하지 않았다.
- Agent를 **종료**하는 것, 목록에서 **숨기는 것**, 채팅 탭을 **닫는 것**, Pi 파일을 **삭제하는 것**, Git Worktree를 **삭제하는 것**의 차이를 현재 새 메뉴로 통합하지 않았다. 각각 Orca 원본 메뉴와 효과를 확인해야 한다.
- Main에서 여러 Pi Extension을 사용할 때 RPC Native Chat의 미지원 UI 경계 확인.
- 현재 Orca 출처의 native Agent rows가 프로젝트 전체 Main 아래 컨텍스트별로 선택·계층 표시되는지는 아직 미확인.

**마이그레이션 안전:** 이전 `OrcaAgentStore` 및 `PiComposeOutline` 레코드를 자동 삭제하거나 Orca 세션을 새로 Fork하지 않는다. 레거시 목록이 더 이상 그려지지 않으므로 실제 Orca가 열려 있지 않은 `prepared` 기록은 새 UI에서 즉시 보이지 않을 수 있다. 재복원·대상 확인 경로가 추가될 때까지 원본 보존이 우선이다.

## 5. 실제 검증 게이트 (테스트 코드/CI 추가 없음)

- 기본 Orca: 원본 `+`/shortcut/tour, 프로젝트·Worktree 생성·우클릭·정리·선택, 상태/Agents feed/탭 close/reveal.
- Main: 기존 Pi 대화 가져오기 및 새 생성, 여러 Main, 실제 원본 세션 보존, TUI Extension 경계.
- Work: 같은 cwd와 분리된 Git Worktree 각각 정확한 완료 leaf Fork, 초기 지시 전송 없음, 작업 중/완료를 정확히 구분, Work 재열기 및 반복 수정.
- Support: 독립 Pi 세션·동시 테스트 실행·원본 Work와의 작업 공간 기준 명시.
- Main 결과: 연결된 Work 항목 단일 표시·접기·펼치기·상세 클릭 시 **Main 세션 전환 없음**. 실제 보고만 사용. Main 모델 컨텍스트에 전체 Tool log 자동 추가 없음.
- 보존/삭제: 탭 닫기, 실행 중지, 세션 보관, Git Worktree 삭제를 서로 구분하고 경고·실제 변경 범위를 확인.
- 이전 실험 마이그레이션: 이미 생성된 Pi session, Orca tab, Git Worktree, 미커밋 파일 그대로. 불명확한 연결은 보존 후 오류 표시, 자동 삭제/재-Fork 금지.

## 6. 아직 원본 코드와 실제 실행으로 증명할 것

1. 원본 Orca의 `Agent Status`가 Pi의 모든 RPC/Extension 실행에서 일관되게 관측되는지 (특히 원격 호스트/hibernation).
2. Orca의 기존 Agent row 데이터에 **다른 Worktree**의 실제 native Chat 행을 노출해도 포커스/상태/메뉴/virtualization이 보존되는 안전한 public internal hook.
3. `NativeChatSubagentRun`를 수정하지 않고 교차 Pi 세션 결과를 `NativeChat transcript slot`으로 표현할 최소 데이터 계약.
4. Orca 정식 Worktree 생성 완료와 Pi exact fork 생성 사이의 실패/보존·재개 상태.
5. 어떤 Agent/Chat 종료 메뉴가 Pi 세션 기록 자체를 지우는지 정확한 side effects.

확인 전에는 임의로 새로운 Agent manager, 상태 계산기, 메시지 플랫폼, 독자 Git UI를 만들지 않는다.

## 근거

- [Orca agent rows](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/WorktreeCardAgents.tsx)
- [Orca agent lineage](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/agent-row-lineage-model.ts)
- [Orca workspace creation](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/workspaces/workspace-creation.ts)
- [Orca session restore](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/lib/activate-ai-vault-structured-session.ts)
- [Orca native subagent disclosure](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatSubagentRun.tsx)
- [Orca native transcript slots](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/native-chat-subagent-section-slots.ts)
- [Orca native turn status](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatWorkingStatus.tsx)
- [Orca Activity feed](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/activity.mdx)
- [Orca orchestration contract](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/skill-guides/orchestration.md)
- [기존 Pi Compose 재사용 감사](https://github.com/SEONGMINY/pi-compose/blob/research/orca-pi-product-fit-20261028/docs/research/ORCA_REUSE_FIRST_REAUDIT_20261028.md)
