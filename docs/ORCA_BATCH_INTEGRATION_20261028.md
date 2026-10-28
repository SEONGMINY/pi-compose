# Pi Compose × Orca — Native-first 통합 구현

> 작업 브랜치: `feat/orca-batch-integration-20261028`  
> 기준: `stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8`, Pi SDK `1.4.0`  
> 상태: **계획서 P0/P1/P2 재감사 중 · 기존 macOS TypeScript 타입 검사 1회 성공, 실제 GUI 실기 동작은 미검증. 최종 GO 불가.**  
> 기존 브랜치, Git Worktree, Pi 대화 파일을 자동 삭제·병합하지 않음. 사용자 요청에 따라 새 CI/테스트 코드는 작성하지 않음.

## 우선하는 제품 가치

1. **Main의 대화 컨텍스트가 정본이다.** 요구사항, 결정 이유, 강한 제약까지 Pi 세션에 유지한다.
2. **Work는 Main의 실제 Pi 대화를 Fork한다.** 의도·강도를 다시 요약하여 전달하지 않는다. 현재 활성 leaf를 Pi RPC에서 받아 마지막 완료된 응답까지만 복제한다.
3. **Support는 독립적인 조사·탐색·테스트 작업이다.** Main의 전체 컨텍스트를 무조건 복제하지 않는다.
4. **Orca 기능을 먼저 사용한다.** 프로젝트, Git Worktree, 실행 호스트, Native Chat, Agent 상태, 도구·추론 표시, 미전송 초안과 생명주기는 Orca가 관리한다.

UI를 위해 원래 Orca 세션/Worktree 이외의 가짜 실행 상태나 가짜 Agent를 생성하지 않는다.

## 통합 경로

| 사용 동작 | 원본 기능/연결 | 지켜야 하는 계약 |
| --- | --- | --- |
| Main 생성·기존 Pi 세션 등록 | Pi SessionManager + Orca Native Chat adoption | 사용자가 선택한 정확한 ID와 파일만 허용 |
| Work 생성 전 검증 | Orca의 Pi RPC `get_entries` → 활성 leaf → `preview-work-fork` | 여러 분기에서 마지막 append를 활성 분기라고 추측하지 않음 |
| Work Fork | `captureCompletedMain` → `forkCompletedMain` → 복제 항목 비교 | Main 원본 읽기 전용, 진행 중 응답 제외, 실제 항목 ID 보존 |
| Work/Support의 별도 작업 공간 | Orca `createWorktree`의 결과 ID/path → Pi Compose 준비 | Compose의 직접 `git worktree add` 제거, Orca 생명주기/목록/상태 사용 |
| Work Native Chat | Orca의 기존 Pi Native Chat resume/adoption | 작업 지시 자동 전송 금지, 중복 세션 불확실 시 보존하고 중단 |
| Main의 Work 행 | Orca의 실제 Agent row + 원래 Worktree/세션을 참조 | 사이드바에 새로운 가짜 실행 상태 생성 금지 |
| Main의 Work 결과 확인 | 별도 Pi 세션의 **Work 고유 턴**을 읽기 전용 조회 → Orca Native Chat의 `WorkingStatus`, `ReasoningRow`, `ToolRun` 렌더러 | Main 모델 컨텍스트에 로그 전체를 자동 주입하지 않음; 턴 종료 ≠ 기능 완료 |
| Main 모델이 Work 결과 질문 받음 | Pi Extension `compose_work_results` | 질문받았을 때만 실제 완료 응답을 읽음 |
| Support 결과 → Work | Orca `native-chat-composer-draft-store` | 기존 초안 유지, 사용자의 최종 전송 필요, 자동 발송 금지 |
| 실패 후 재연결 | 기존 Native Chat reveal 우선, 사라짐 확정 시 동일 Pi 기록 재채택 | Fork 및 Worktree 중복 생성 금지 |

## 이번 묶음에서 교정한 경계

- **Orca ID vs Pi ID:** Main 채팅에 Work 보고를 붙일 때 Pi의 `session.sessionId`를 쓰지 않고 Orca host `props.sessionId`를 사용한다. 조회 경로는 Main을 소유한 Worktree ID에 고정해 분할 화면에서도 잘못된 프로젝트를 읽지 않는다.
- **Main 컨텍스트와 Work 결과 구분:** Work 파일에 복사된 Main의 마지막 assistant 메시지는 Work의 실행 결과가 아니다. `sourceEntryId` 이후의 **Work 첫 사용자 메시지** 뒤에서 종료된 assistant 응답만 인정한다.
- **완료 의미:** `stopReason: stop`는 Pi 응답의 종료 증거이며 과제 구현·검증 완료의 증거가 아니다. 사용자가 실제 수행 결과를 확인할 수 있도록 출처/원본 세션/도구 내역을 연결한다.
- **Git 작업 공간:** Git 작업 폴더를 별도 생성한다면 먼저 Orca가 만들고, Compose는 그 영수증을 받아 Pi 세션을 준비한다. Work가 연결된 Support는 선택 중인 Main이 아닌 실제 Work의 Git 브랜치와 실행 호스트를 따른다.
- **결과 표시:** Main 화면이 열려 있을 때 완료된 Work 응답을 읽기 전용으로 갱신한다. 추론이나 도구 활동이 길면 일부만 표시하고 전체 내역은 Orca Work Native Chat 원본에 남긴다.
- **기존 대화 복구:** 대화 소유권이 확실하지 않으면 새 세션을 만들지 않고 원본을 보존한다. 등록된 세션은 재열기 기능으로 복구한다.
- **Pi 유연성:** Compose Extension은 기존 Pi 옵션에 추가된다. 사용자의 기존 Extension을 대체하거나 비활성화하지 않는다.

## 통합 검증 기준

현재 도구 환경에서는 GitHub 원본 파일을 가져와 오버레이의 모든 `before / after` 구문을 순서대로 적용하는 **소스 정합성 검사**를 실행할 수 있다. 이 검사는 TypeScript 타입 검사나 실제 Electron 실행의 대체가 아니다.

실기 검증이 필요한 주요 흐름은 다음과 같다.

1. macOS, Node.js 24 이상 환경에서 `npm run orca:prepare` 및 `npm run orca:dev` 실행. 같은 준비 명령 반복 시 기존 사용자 변경을 덮어쓰지 않는지 확인.
2. 저장된 Main에서 여러 Pi 분기를 만든 다음 실제 활성 leaf를 선택하여 Work 생성. Fork가 완료된 원본만 정확히 포함하는지 확인.
3. Main/Work/Support를 Orca Native Chat으로 열어 작업하고, 다른 Worktree에 생성한 Work의 실제 Orca Agent 상태가 Main 관계 아래 나타나는지 확인.
4. Main 안에서 Work 응답의 완료 시간·추론·도구 실행을 펼쳐 확인. **Work 실행 전에는 상속된 Main 답변이 절대로 Work 결과로 표시되면 안 됨**.
5. Support의 완료 응답을 Work의 입력 초안에 추가하되 기존 초안을 지우지 않고 자동 전송하지 않는지 확인.
6. 닫힌 채팅 재열기/연결 실패/기존 Pi TUI 실행 중 소유권 충돌에서 중복 Fork 없이 원본이 보존되는지 확인.

### 현재 확인된 것과 확인되지 않은 것

- 확인된 것: 고정 Orca 소스와 패치 구문을 대조하는 정적 검사, 핵심 호출 계약에 대한 소스 대조, GitHub 브랜치에 코드 저장.
- **확인된 일부:** 기존 GitHub macOS Actions에서 Node 24/pnpm 설치 및 고정 Orca TypeScript 검사 통과(이전 커밋). **미확인:** 최신 HEAD의 전체 타입 검사·Electron GUI 실행, 런타임 Pi RPC 소유권, Worktree 등록·재시작, 탭 재개, 초안 동시 수정, U01~U24 실사용. GitHub 소스 대조만으로 이를 통과했다고 주장하지 않는다.
- UI 표시로부터 워크플로 성공, 코드 수정 성공, 테스트 통과를 자동으로 판정하지 않는다.

## 실행 및 이어서 검증

```bash
git switch feat/orca-batch-integration-20261028
npm install
npm run orca:prepare
npm run orca:dev
```

소스 정합성만으로는 제품 수준 사용 가능 여부를 확정할 수 없다. **실제 Orca 화면에서 Main → Work → 완료 보고/원본 확인 → Support 전달 흐름을 재현하는 통합 검증이 남았다.**

[기존 구현/제약 문서](./ORCA_CONTEXT_FIRST_IMPLEMENTATION.md)


## 원본 1,052줄 실행 계획서 재대조 및 보완 (2026-10-28)

**정본:** [ORCA_CONTEXT_FIRST_EXECUTION_PLAN.md](./ORCA_CONTEXT_FIRST_EXECUTION_PLAN.md) 및 [사용자 합의 제품 정책](./research/ORCA_PI_COMPOSE_PRODUCT_DECISIONS_20261028.md). 이 문서의 구현 현황이 정본의 P0~P6, T00~T20, U01~U24 완료 기준을 대체하지 않는다.

### 이번 재대조에서 확인하고 수정한 사항

| 정본 작업 | 실제 코드/문제 | 이번 수정 | 검증 수준 |
| --- | --- | --- | --- |
| T01/T02 · 정확한 활성 leaf/원본 Fork | `previewMainFork`와 `prepare`가 호출자 누락 시 단일 leaf를 추측할 수 있음 | Orca Work 생성·사전 검증에서는 활성 Pi RPC leaf ID를 반드시 요구. 모르면 중단 | JS 구문 파싱. 실제 RPC 실기 미검증 |
| T02 · Fork 증거 지속성 | 이전 `verifyCopiedEntries`는 Work가 자체 대화를 추가하면 전체 길이/마지막 ID 비교로 오탐 | Main에서 상속한 ID/내용의 **접두 구간**만 비교하며, 원본/대상 Pi ID와 원본 branch entry chain을 함께 검사 | JS 구문 파싱. 다중 분기/실시간 실기 미검증 |
| T02 · 기록 중 원본 읽기 | `readEntries`는 쓰기 진행 중 마지막 JSONL 부분 행을 무조건 파싱 | 기존 `readCompleteJsonl`을 공유해 **마지막 미완성 행만 읽기에서 제외**. 파일 수정 없음 | JS 구문 파싱. 실제 동시 writer 미검증 |
| T03/T07 · 실패/중복/복구 | Work Fork 증명 실패 시 저장된 session/Worktree는 남는데 UI가 준비 ID를 잃을 수 있었음 | 반환된 기존 record ID를 즉시 표시하고, 증거 불일치 Work는 재열기 UI에서도 실행 차단. 원본과 중간 자산 보존 | 코드 대조. 크래시·재시작 미검증 |
| T12/T13 · Work 결과 보고 | `linkedWorkResults`가 Work별 마지막 응답 하나만 표시하여 여러 완료 턴을 누락 | 최근 완료된 Work 턴 **각각을 실제 entry ID로 별도 반환**(Work별 최신 3개까지). Main 모델에 자동 주입하지 않고 출력은 IPC 범위로 제한 | JS 구문 파싱. 실제 UI/IPC 검증 전 |
| T13 · 원본 증거 확인 | Main의 접는 항목에 원본 Work 대화를 여는 명시적 액션이 없음 | Orca 기존 `activateAndRevealWorkspace`, `activateStructuredAgentSessionById`로 **원본 Work 세션 활성화** 연결 | TSX 소스 대조. macOS GUI 미검증 |

**경계와 이유:** Work 결과 3개 제한은 현재 UI/IPC 응답을 제한하기 위한 표시 범위일 뿐 원본 Work의 실제 턴을 삭제하거나 통합하지 않는다. 오래된 턴은 Orca 원본 세션에서 조회한다. 이 임시 상한의 장기 사용성 및 페이지네이션은 P3의 실사용 검증 후 결정한다.

### 완료 판정 불가 — 계획서의 잔여 blocking 항목

- **P0/T01~T03:** 활성 leaf를 돌려주는 Orca 호스트 어댑터는 코드에 있지만, 실행 중 Main 및 다중 branch, writer 소유권·호스트-실제 provider session ID 일치 검증은 미완료.
- **P1/T04~T07:** Orca `createWorktree`를 호출하도록 변경했으나, Worktree 생성 후 IPC/세션 등록 실패와 앱 강제 종료에 대한 **stable operation ID 기반 중복 방지/재개**는 완성되지 않았다. 같은 요청의 재시도 시 새 Worktree를 만들 위험을 제품 검증에서 반드시 확인.
- **P2/T08~T11:** 같은/다른 Worktree 관계·포커스·기존 Orca 행 dismiss/Compose 연결 숨김의 분리·History에서의 재열기 실제 시나리오 미검증. 새 가짜 pane/Agent를 만들지 않는다.
- **P3/T12~T14:** Work별 다중 응답을 표시하도록 보완했지만 전체 Journal 투영, 같은 턴 중복/전환, Main 모델의 on-demand read tool, 원격 host 연결 상태와 UI 복구는 실사용 검증 전.
- **P4/T15~T16:** Native draft store 재사용은 코드에 있음. 기존 초안·첨부·늦은 hydration·다중 창 편집·중복 클릭·서로 다른 호스트 검증 미완료.
- **P5/T17:** Extension RPC에서 가능한 UI API와 TUI만 되는 API를 기능별 검증한 표·실행 검증 미완료. 확인 전 기능을 제거하거나 지원한다고 단정하지 않는다.
- **P6/T18~T20:** macOS Node 24/pnpm 설치와 고정 Orca 타입 검사는 중간 커밋에서 성공했으나 최신 HEAD·Electron GUI·U01~U24·레거시 inventory/cleanup 검증은 미완료. **GO 판정 불가.**

### 변경 범위 / 검증·보존 기록

- 변경: `src/orca/completed-main-fork.mjs`, `src/orca/agent-sessions.mjs`, `orca-overlay/src/renderer/src/components/pi-compose/PiComposeMenu.tsx`, `orca-overlay/src/renderer/src/components/pi-compose/PiComposeLinkedWorkReports.tsx`.
- 불변: 원본 Main Pi JSONL, 사용자 Git Worktree, 실제 Work/Support 대화, Orca 생성/종료/포커스/원본 Session lifecycle, Pi의 기존 Extension 설정은 개발 중 **수정·삭제하지 않았다**. GitHub 코드 변경만 수행했다.
- 수행: 실제 GitHub 소스 조회, 계획서와 함수별 비교, 변경된 두 `.mjs` 파일을 JS 파서로 구문 검사 **PASS**.
- 당시 수정 묶음의 기록: 실제 GUI/제품 QA 미수행. 이후 기존 GitHub Actions는 Node/pnpm 및 Orca 타입 검사 성공 기록이 있고, **기존 contract-check는 구형 검증 조건 때문에 실패**한다. 최신 HEAD 및 U01~U24 제품 QA 성공 증거는 없다.
- 후속은 기존 계획서의 **go/no-go gate**를 따르며, 남은 blocking을 새 자작 UI/Agent/Worktree 관리자로 우회하지 않는다. 사용자가 요청한 대로 별도 CI/테스트 코드를 추가하지 않는다.


## 2026-10-28 · 원본 P2 의사결정 게이트 복구 / P0·P1 재감사

이 절은 [1,052줄 계획서](./ORCA_CONTEXT_FIRST_EXECUTION_PLAN.md)의 **실행/검증 기록**이며 별도 정책 정본이 아니다. 계획서 P0→P1→P2 단계별 go/no-go와 사용자 확정 결정을 우선한다.

### 확인된 Orca 원본과 실제 사용 경계

| 구분 | Orca 원본 코드 | Compose가 할 수 있는 일 | 변경하면 안 되는 일 |
| --- | --- | --- | --- |
| Agent 아이콘·활동 상태 | `DashboardAgentRow.tsx`의 `AgentTypeIcon`/`AgentStateDot`; `rowSource='subagent'`에서만 종류 아이콘 생략 | 실제 Orca Pi native row의 관계만 투영 | Main 말풍선 아이콘/역할 아이콘 추가, 상태 자체 계산 |
| 같은 Worktree 부모 관계 | `WorktreeCardAgents.tsx`, `agent-row-lineage-model.ts`, `applyAgentRowLineage` | **실제** Orca Native Chat ID를 갖고 있고 Fork 증거가 유효한 Work의 `parent` projection | fake paneKey, AgentStatus, 실행 대상 변경 |
| 다른 Worktree의 Agent | 각각의 `useWorktreeAgentRows(worktreeId)`, `activateAndRevealWorkspace`, `activateStructuredAgentSessionTab` | 원래 Worktree 및 Orca Agent 관리자를 유지하며 관계를 참조 | 원래 Worktree를 바꿔 끼우기·세션 중복 등록 |
| `×`/Dismiss | 원본 `DashboardAgentRowTrailingControls` + 원래 Worktree의 `dropAgentStatus`/retained dismiss | 별도 'Main에서 연결 숨김'은 다른 동작임을 명시 | 같은 `×`에 다른 생명주기 의미 몰래 적용 |

### P2-2 A/B 대조 — 아직 사용자 선택 전

| | A: 원본 Orca 위치 유지, Main에서 참조 | B: Main 아래에도 Native Agent 행 표시 |
| --- | --- | --- |
| 비용/변경 범위 | 더 작음: Main에서는 실제 Orca 세션을 여는 명시적 참조 링크/메뉴만 추가 | 더 큼: 다른 Worktree의 상태·포커스·dismiss·접기·가상화를 원본 owner에 정확히 라우팅 |
| 기대 효과 | Orca 본래 행과 소유권, 아이콘/상태/메뉴 의미를 그대로 보존 | Main 아래에서 Work 진행을 한 화면에 모아 볼 수 있음 |
| 위험 | Main 트리에서 원격 Agent의 전체 행을 바로 볼 수 없음 | 같은 Agent가 두 번 표시됨, `×` 의미 차이, 두 Worktree의 focus·virtualization·reopen 충돌 |
| 현재 결정 | **기존 Orca 원래 위치를 손대지 않는 안전한 임시 상태** | **활성 오버레이에서 제외, 코드만 검토용 보존**. 실제 사용성·소유권을 증명하고 사용자와 범위 결정 전 활성화 금지 |

기존 `PiComposeCrossWorktreeAgentRefs.tsx`는 예전 B안 시도의 **비활성 참고 코드**다. 파일이 존재한다고 배포 UI에서 해당 컴포넌트를 사용한다는 뜻은 아니다. 새 오버레이에서는 관련 `WorktreeCardAgents` 네이티브 행 복제 삽입 4개를 제거했다.

**업데이트 안전:** 기존 Orca 체크아웃에 과거 B안 오버레이가 적용돼 있을 수 있다. 단순히 새 hook 목록에서 제거하면 원래 파일에 중복행 코드가 남는 문제가 있어, 이전 manifest의 전체 파일 SHA256과 실제 현재 파일이 동일할 때만 `git show HEAD:<original-path>`로 **고정 Orca 커밋의 원본을 읽고**, 현행 overlay hook 전체를 다시 구성하도록 수정했다. 사용자 수정이 한 글자라도 달라 hash가 불일치하면 덮어쓰지 않고 중단한다. Git checkout/reset/delete는 수행하지 않는다.

**같은 Worktree:** `usePiComposeNativeLineage.ts`에서 Work의 `proof.allMatch===true`까지 확인해야 native Main 아래에 연결한다. 증명이 없으면 원래 Orca Native Chat은 그대로 유지하지만 Main의 검증된 Fork처럼 보이지 않는다.

### P0·P1 Go/No-Go

- **P0: 아직 NO-GO.** Orca 실제 Pi host registry 및 provider handle 파일의 Pi 세션 ID와 RPC의 `get_entries.leafId` 연결은 소스·타입 수준에서 확인. macOS 실제 다중 branch, 실행 중 writer, 재시작/호스트 불일치에서 한 번의 정확한 Fork 증거 및 부작용 없음은 미검증.
- **P1: 아직 NO-GO.** 아래 후속 작업에서 영속 생성 의도와 Orca 영수증 복구 및 Pi 파일 재사용을 구현했으나, 다중 창·실제 강제 종료·Orca host 응답 불확실·인텐트 복구 전체 실기를 검증하지 못했다. 인텐트 저장만으로 Orca host 자체의 영속 idempotency가 생긴 것은 아니다.
- **P2: 아직 NO-GO.** 동일 Worktree의 read-only lineage는 남김. **다른 Worktree B안 중복 행을 비활성화**했으므로 Main의 전체 cross-Worktree 그룹핑은 제품 기능으로 완료되지 않았다. A/B안은 실사용 및 사용자 결정 후 선택한다.
- **P3~P6:** 이전 코드가 존재하는 것과 단계별 제품 완료는 다르다. 상위 게이트를 통과하기 전 완료라고 선언하지 않는다.

### 검증 증거와 한계

- 고정 원본 Orca source 및 overlay patch 정적 대조: 현재 overlay가 `WorktreeCardAgents`에 **같은 Worktree 관계용 4개 hook만** 삽입하고, `crossRefs.map`은 삽입하지 않는 것을 확인. JS 구문 검사 통과.
- 기존 GitHub macOS [Actions 실행 40679291301](https://github.com/SEONGMINY/pi-compose/actions/runs/40679291301)의 **upstream-integration 타입 검사 성공**: 당시 커밋 `d8b5fbd` 기준. 이후 overlay 리베이스·P2 수정의 실제 타입 검사 결과는 별도 확인이 필요.
- 기존 `contract-check`는 구형 구현을 기준으로 한 fixture가 활성 leaf ID 없이 Work Fork, Compose의 Git Worktree 직접 생성 등을 요구해 실패하고 있다. 계약을 약화해 테스트를 통과시키지 않는다. 신규 테스트·CI는 추가하지 않았다.
- macOS GUI 실제 실행, Agent icon/status/focus/`×` 클릭, `orca:prepare` **이미 패치한 checkout에서 업데이트 후 반복 실행**, U01~U24 전체 결과는 **미검증**. 소스 대조만으로 완료 선언 금지.


## P1 영속 생성 의도·실제 Orca 영수증 복구 (2026-10-28 후속)

**정본 게이트:** `ORCA_CONTEXT_FIRST_EXECUTION_PLAN.md`의 P1, A-4(부분 성공 복구), T04~T07. 새 관리 시스템을 만들지 않는다. Worktree/상태/삭제/포커스는 계속 고정 Orca 원본이 담당한다.

### 고정 Orca 4a39d186 소스 재검증

- `src/renderer/src/store/slices/worktrees/create/create-worktree.ts`의 `createWorktree` **19번째 인자**가 `creationId`이며, Orca의 생성 요청에 그대로 전달된다.
- `src/main/runtime/workspaces/workspace-creation.ts`의 `createManagedWorktree`는 `creationId`로 `workspaceLifecycle.openCreate`를 호출한다.
- `src/main/runtime/workspaces/workspace-lifecycle-creations.ts`의 `open`은 **메모리 생성 진행 목록**을 등록한다. 같은 `creationId`를 재등록하면 이전 요청을 자동 완료/재사용하는 영속 idempotency 저장소가 아니다. **이 값을 전달하는 것만으로 재시도 안전하다고 주장하지 않는다.**
- 실제 생성·등록은 Orca의 `createWorktree` / `createManagedWorktree`에만 위임한다. Compose에서 직접 `git worktree add` 하지 않는다.

### 이번 최소 구현

| 단계/실패 경계 | 변경 내용 | 여전히 확인할 것 |
| --- | --- | --- |
| 생성 버튼 누름 | `OrcaAgentStore.beginCreation`이 Main당 하나의 영속 생성 의도를 atomic `wx`로 저장. 생성 ID/명칭을 재시작 후에도 유지 | 여러 Electron 창 동시 작업 실기 |
| Orca 생성/응답 끊김 | `createWorktree` 호출에 저장된 `creationId`를 전달. `requested` 기록을 유지하고 **자동 두 번째 생성 금지** | 호스트의 실제 생성 여부 확인 |
| Orca 영수증 반환 | `recordCreatedWorkspace`가 동일 프로젝트 Git 정체성과 원래 의도 ID에 맞는 Orca `id/path`만 저장 | 원격 호스트는 지원 선언하지 않음 |
| 영수증 저장 후 앱 종료 | `pendingWorktreeCreation`의 `workspace-created` 영수증과 Orca 현재 목록의 `id/path`가 일치하면 **같은 영수증**으로 Pi 준비 재개 | 사용자가 삭제/이동한 작업 공간 처리 |
| 응답만 누락됨 | `requested` 상태는 사용자 명시적 '기존 작업 공간 확인'을 통해 Orca 등록 목록에 **같은 생성 이름의 브랜치 하나**가 있을 때만 연결. 근거가 없으면 계속 중단 | Orca가 자동으로 이름을 변경한 경우는 강제 추측하지 않음 |
| Pi Fork 생성, Compose 기록 저장 실패 | 저장된 `creationIntentId`를 실제 Pi child session ID로도 사용. SDK에서 해당 Pi 파일을 조회해 Main branch 항목과 parent 원본을 전부 확인한 경우만 재사용. 다른 파일이면 중단 | 실제 fork/record 사이 크래시 주입 |
| Compose 기록 저장, 인텐트 완료 저장 실패 | 같은 ID의 기존 Pi Compose 레코드를 확인한 뒤 재사용. 완료 기록을 썼으나 보관(rename) 전 크래시가 나면 다음 조회에서 원본 연관성을 확인한 뒤 영구 보관 | 디스크 오류/일부 손상 입력 |
| Pi 세션 준비 완료 | Main/role/worktree/creationIntentId가 모두 일치하면 활성 인텐트를 별도 완료 레코드로 보관. 기존 Worktree, Pi 파일, 브랜치 삭제 없음 | end-to-end macOS 재시작 |

### 아직 P1 GO로 판정할 수 없는 이유

1. Orca host 응답이 없고 등록 목록에서도 **동일한 기존 Worktree를 증명할 수 없는 상태**에는 생성 인텐트를 그대로 보존한다. 안전하게 존재하지 않음을 입증하기 전 자동으로 인텐트를 폐기하거나 새 생성을 재개하지 않는다. 이 경우 사용자에게 원본 Orca/Git 상태 점검이 필요하다.
2. 생성된 Git Worktree가 Orca의 이름 충돌 처리로 다른 브랜치명을 받은 경우, 현재 자동 복구는 그 브랜치를 추측하지 않는다.
3. 두 개의 앱 창, 강제 종료, writer 경합, 여러 호스트에서의 인텐트·영수증·Pi 세션 관리 실제 실기는 검증되지 않았다. **재개할 때 작업명/Support 연결/실제 Main 활성 leaf·완료 지점이 최초 의도와 다르면 실패 보존**한다. 최초 기준으로 자동 Fork를 재구성하거나 다른 분기로 넘어가지 않는다.
4. `OrcaAgentStore`는 여전히 실행/세션 연결을 위한 일부 legacy 메타데이터를 보유한다. Orca 자체 lifecycle을 완전히 대체한 뒤 코드 삭제하기 전까지 P6 종료 아님.
5. 기존 `test:orca`는 이전 P0/P1 계약을 기대해 실패. **새 CI·테스트 코드를 추가하지 않았고**, 기존 검증을 실제 고정 Orca 타입 검사와 분리해 기록한다.

### 변경한 파일

- `src/orca/agent-sessions.mjs`: 영속 생성 의도(작업명·Support 연결·Main 활성 leaf 및 완료 응답 ID 고정), 독점 예약, 영수증, 동일 Pi 자식 ID의 기존 Fork 검증·재사용, 완료 기록 보관.
- `scripts/orca-native-bridge.mjs`: 안전한 생성 intent 명령과 Work/Support 준비 연동.
- `orca-overlay/src/main/pi-compose-ipc.ts` / `orca-overlay/src/preload/api/pi-compose-bridge.ts`: 새로운 좁은 IPC 계약.
- `orca-overlay/src/renderer/src/components/pi-compose/PiComposeMenu.tsx`: 재시작 후 영수증 사용, 응답 분실 시 사용자 명시적 원본 확인.

**검증 상태:** 위 파일들은 GitHub에 반영했고 `.mjs` JavaScript 구문 검사를 수행했다. macOS Orca GUI 재시작·Worktree/파일 실제 크래시 복구 테스트는 수행하지 못했다. 이 단계에서 완료/GO를 주장하지 않는다.


## P0/P1 후속: 활성 leaf 변경·동시 Pi Fork·중단된 준비 복구

2026-10-28. 위 P1 구현 뒤 코드 재감사에서 추가된 보수적 동작이다.

| 위험/검토 항목 | 이번 변경 | 완료 판단 |
| --- | --- | --- |
| 두 프로세스가 같은 생성 의도를 동시에 Pi SDK로 Fork | `OrcaAgentStore.prepareForMain`에서 Main별 `.preparing.lock`을 O_EXCL로 점유한 하나만 진행. 다른 프로세스는 중복 생성 대신 차단 | 코드 반영. 실제 동시 실행 미검증 |
| 레코드 저장의 TOCTOU | `put`의 `existsSync -> rename` 패턴을 제거. 완성된 임시 파일을 `linkSync`로 새 경로에 배타적 등록하고 원본 사용자 레코드를 덮어쓰지 않음 | 코드 반영. 실제 fs 오류/멀티프로세스 QA 미검증 |
| RPC await 동안 Main의 Orca 소유권 변경 | 활성 leaf 조회 완료 **후** Orca provider handle, 원본 Pi realpath, Pi header ID 재검증 | 코드 반영. 실제 전환 경쟁 검증 전 |
| 준비 중 브리지 프로세스 강제 종료 | 잠금은 삭제하지 않고 원본 자산 보존. 사용자가 명시적으로 복구를 실행하면 같은 생성 의도와 종료된 PID(ESRCH)를 확인, `.recovery.lock`으로 복구 시도 직렬화 후 잠금만 해제 | 원본 Pi/Worktree 삭제 없음. 실제 강제종료 검증 전 |
| Main이 이후 다른 분기로 대화를 계속한 상태에서 기존 생성 복구 | **새 Work**는 Orca의 live leaf 필수. 이미 영수증이 있는 **기존 Work**만 최초 기록된 `activeLeafId`/`expectedSourceEntryId`로 `captureCompletedMain`을 재검증해 재사용; 현재 live leaf로 슬쩍 교체 금지 | 코드 반영. 저장된 leaf가 삭제/변경되면 보수적으로 실패 |

**제약:** 파일 잠금의 PID가 재사용됐거나 권한 오류(EPERM)로 생사를 확인할 수 없으면 자동 복구하지 않는다. 별도 잠금 복구자가 비정상 종료해 `.recovery.lock`이 남아도 자동 해제하지 않는다. 운영자 수동 정합성 점검이 필요하며, 원본 데이터를 임의로 삭제하거나 Git 리셋하는 방식으로 우회하지 않는다.

기존 GitHub macOS `upstream-integration`은 **이번 변경 이전 커밋**에서 통과했다. 현재 커밋의 macOS TypeScript/GUI 및 P0/P1 크래시·다중창은 미검증이다. `contract-check`는 구형 구현을 전제로 한 fixture와 불일치하여 실패하며 변경된 코드에 대한 추가 테스트는 사용자 요청에 따라 작성하지 않았다. 이 기록은 P0/P1 **GO 판정이 아니다**.


## P0/P1 후속 재감사: Pi Compaction 컨텍스트 보존 및 Orca Worktree 영수증 식별

**이번 확인의 출처:** Pi SDK `earendil-works/pi@v1.4.0`의 `packages/coding-agent/src/core/session-manager.ts`, Orca `stablyai/orca@4a39d186`의 `src/shared/worktree/id.ts`, `src/main/ipc/worktree-branch-name.ts`, `src/shared/new-workspace/worktree-create-retry-policy.ts`.

### P0 — 마지막 완료 응답 뒤의 Main 컨텍스트 누락 수정

실제 Pi SessionEntry는 일반 `message` 이외에도 `compaction`, `context_edit`, `model_change`, `custom`, `session_info`, `usage`, `branch_summary`, `custom_message` 등을 가질 수 있다. 이전 `captureCompletedMain`은 마지막 완료 assistant 응답 위치에서 무조건 잘라, **그 응답 뒤에 활성 분기의 Compaction/ContextEdit가 기록되면 Work의 차후 모델 컨텍스트가 Main과 달라지는 결함**이 있었다.

수정: 완료된 assistant를 기준으로 후속 `message` 또는 `custom_message`(아직 답을 받지 않은 새 입력)가 나오기 전의 **상태·컨텍스트 항목만** 보존한다. 이후 사용자 입력과 그 하위 항목은 복제하지 않는다. `sourceEntryId`는 **실제로 복제한 분기의 마지막 Pi entry**로, `completedAssistantEntryId`는 별도로 **마지막 완료 assistant message**를 나타낸다. Pi SDK가 제공하는 Compaction, ContextEdit, Extension 상태 기록도 손실 없이 전달한다.

**직접 코드 로직 실행 검증(저장소 테스트 파일 추가 없음):** 현재 GitHub `completed-main-fork.mjs`에서 `branchFrom`/`captureCompletedMain`의 실제 함수를 가져와 세 경우를 검증했다.
- 완료 assistant → Compaction → ContextEdit → 새 User: 새 User는 제외하고 앞 세션 항목 포함.
- 완료 assistant → Compaction → ContextEdit: 끝까지 포함, `excludedInProgress=false`.
- 완료 assistant → 미완료 Extension `custom_message`: 해당 Extension 입력 제외.

세 경우 모두 통과했다. **실제 Pi macOS RPC 다중분기/Fork·후속 모델 입력 검증을 대신하지 않는다.**

### P1 — 호스트 영수증의 경로·브랜치 일치 검증

고정 Orca는 `composeWorktreeId(repoId, worktreePath)`로 `repoId::worktreePath`를 만들고, 브랜치명에는 사용자 설정 prefix 및 충돌 시 `-2`, `-3` 등 suffix를 적용할 수 있다.

`OrcaAgentStore.recordCreatedWorkspace`는 이제 `workspace.id`에 들어 있는 경로와 수신 `workspace.path`, 원본 Main의 Orca repo ID가 일치하는지 확인한다. **최초 영수증**은 `git branch --show-current`(읽기 전용)로 생성 의도의 이름 또는 Orca의 숫자 충돌 suffix와 일치해야 한다. 불일치하면 기존 인텐트와 Git/Orca 자산을 보존한 채 중단한다. `beginCreation`도 원본 Main이 Orca 실제 Worktree owner와 연결돼 있어야 진행한다.

이는 **브라우저가 전송한 임의 문자열만 믿지 않기 위한 방어**다. 실제 Orca 영속 registry의 등록 여부까지 완전히 증명하는 것은 아니며, 해당 주장은 하지 않는다.

### 현재 Go/No-Go

- **P0 NO-GO:** 수정된 Compaction/Fork 소스 로직 세 경우는 통과했으나, 실제 Pi 다중 분기, 비동기 실행 중 메시지 append, 세션 reopen/restart, Extension 컨텍스트로 모델 호출까지 실사용 증거 없음.
- **P1 NO-GO:** 경로/브랜치/Orca repo ID 검증 추가. 실제 강제 종료·원본 Worktree 복구·다중 창/경합·변경된 repo/branch 예외의 GUI 검증 없음.
- **CI:** `f3fdf8b` macOS pinned Orca `upstream-integration` **PASS**, `contract-check`는 구형 Fork/Worktree fixture를 기대해 실패. 이번 P0 컨텍스트 변경까지 포함한 최신 커밋의 macOS 타입 검사 결과는 별도 확인 필요.

새 테스트 코드/CI는 추가하지 않았으며, 기존 세션·작업 공간·Git 브랜치를 삭제하거나 재작성하지 않았다.


## 2026-10-29 · P2 관계 갱신 / P3 출처 확인 / P4 초안 전달 안전성 보완

> 범위: `feat/orca-batch-integration-20261028` · 제품 정책 변경 없음 · 로직 구현 기록.
> 자동 테스트/CI/GUI 검증은 수행하지 않음. 구현 여부와 제품 검증은 별도 판단.

| Task | 이번 코드 변경 | Orca 재사용 | 남은 경계 |
| --- | --- | --- | --- |
| T08 | 같은 개수의 Agent 교체·Pi 세션 탭 교체 시 관계 조회 무효화, 오래된 비동기 조회 결과 차단. 관련 Work가 숨겨졌거나 Fork 미검증이면 독립 Support를 Main에 귀속 | `useWorktreeAgentRows`, `applyAgentRowLineage`, Orca native row | 실제 GUI 관계/키보드 검증은 사용자 담당 |
| T12 | Work의 실제 완료 응답 읽기 전에 source/target Pi JSONL entry chain의 Fork 증거 재검증. 불일치 기록은 보고하지 않음 | Orca Native Chat 원본으로 이동하는 기존 경로 유지 | 현재 결과 키는 Pi assistant entry ID. Orca host turn ID/journal 기반 영속 출처와 unreadable 구분은 미구현 |
| T15 | Support 전달 메타데이터에 등록된 Orca Worktree ID와 실제 Pi 세션 ID·응답 시각 추가 | Orca 실제 Worktree ID 참조 | 실행 당시 Git HEAD/브랜치는 관찰되지 않아 임의로 채우지 않음 |
| T16 | 선택 대상의 최신 Compose Fork 증거 및 살아 있는 Pi Native Chat 탭 확인 뒤 Orca draft store에 append. 제목이 아닌 원본 Support+entry ID로 중복 감지하고 같은 renderer 내 중복 동시 호출 직렬화. 기록된 텍스트와 draft 영속 저장 확인 | `findStructuredAgentSessionTab`, `appendToNativeChatComposerDraft`, `nativeChatComposerDraftWriteSettled` | 여러 Orca 창 간 동일 전달의 완전 원자성/원격 호스트 전달은 별도 계약 필요 |

**보존:** Main·Work·Support Pi JSONL 및 fork source entries 원본 수정 없음. Worktree 생성·삭제·Git 변경 없음. 자동 모델 입력·Support 즉시 전송 없음. 기존 Orca Agent 소유권·아이콘·상태·포커스·native draft 영속성 유지.

**미확정 / 보류:** D1 교차 Worktree A/B UI, D2 기본 작업 공간, D3 파괴적 삭제 UI, D4 미커밋 변경 복제, D5 모델 읽기 Tool, D6 Native↔TUI 전환, D7 원격 초안 전달. T09는 Orca 원본 근거로 별도 비교. B안의 비활성 `PiComposeCrossWorktreeAgentRefs.tsx`는 활성화하지 않음. P5/P6 전체 완료로 분류하지 않음.

**기술적 제한:** Work 결과는 아직 로컬 Pi JSONL의 단일 분기에서 읽는 bounded projection이며 host journal의 진짜 Orca Turn ID를 제공하지 않는다. 이것을 호스트 근거를 갖춘 완료 상태라고 주장하지 않는다. Source Git HEAD를 관찰하지 않은 Support 결과에 저장된 생성 당시 HEAD를 실행 시점 HEAD로 표기하지 않는다.


## 2026-10-29 · P2 의사결정 근거 / P3 읽기 경합 / P5 확장성 조사

### T09 — 교차 Worktree A/B 후보 (선택 전, 코드 미활성)

| 비교 | A: Orca 원본 Worktree에 한 행 | B: Main에도 native Agent 참조 행 |
| --- | --- | --- |
| 원본 행 위치 | `WorktreeCardAgents.tsx` → `useWorktreeAgentRows(realWorktreeId)` 그대로 유지 | 원본 행 + Main 소속 Worktree에 두 번째 read-only 투영 |
| Main의 탐색 | 관계 참조를 통해 `activateAndRevealWorkspace`, `activateStructuredAgentSessionById` 호출 | 원본의 `DashboardAgentRow` / compact row를 참조 위치에도 렌더링 |
| Agent 상태·아이콘·시간 | 원본 소유자 그대로 | 다른 Worktree 원본 `useWorktreeAgentRows` 조회값을 참조 행에도 동기화 |
| 클릭·포커스 | Orca 원본 tab/worktree owner로 라우팅 | 참조 행에서 원본 owner로 별도 정확한 전달 필요 |
| Dismiss `×` | 원본 `DashboardAgentRowTrailingControls` → Orca `dropAgentStatus` / `dismissRetainedAgent` | 실험 코드의 `setWorkMainVisibility`는 **다른 의미**이며 기존 원본 `×`와 불일치 |
| Orca parent/child | `WorktreeContextMenuView`의 parent는 Git Worktree 관계이며 Pi 대화 Fork가 아님 | Worktree parent를 Pi 소속으로 오용할 수 없음 |
| History | Orca `AiVaultSessionHistoryDialog`, `revealStructuredSession` 및 기존 재열기 경로 | 두 표시 위치에서 원본 Session History/retained 상태를 별도 반영해야 함 |
| 코드 범위·비용 | Main의 최소 참조 메뉴/관계 연결만 추가, 유지보수 부담 낮음 | `WorktreeCardAgents`, native row owner/dismiss/focus, compact/expanded, virtualization까지 변경 범위 확대 |
| 핵심 가치 | Main 연결과 정확한 Pi Fork 증거는 유지, Agent 실행 행 복제 없음 | 근거의 정확성은 유지할 수 있지만 조작 의미와 UI 중복 위험 큼 |

**권장: A**, Orca 소유권/행 동작을 변경하지 않고 Main의 관계 및 원본 이동 경로를 제공. **사용자 선택 이전에 A나 B 구현 확정 금지.** `PiComposeCrossWorktreeAgentRefs.tsx`는 실험 파일로만 남기고 사이드바에 연결하지 않는다.

### T12/T13 — Main의 표시 경합 및 미검증 Work 표시 보완

- `PiComposeLinkedWorkReports.tsx`: Main Orca Session ID와 선택된 Compose Main ID를 함께 고정하여 이전 Main의 타이머가 현재 대화에 결과를 표시하지 못하도록 제한.
- Focus/Compose 변경/주기적 조회의 비동기 응답을 단일 read epoch으로 구분. 느린 오래된 결과가 최신 결과를 덮지 않도록 보완.
- Compose 목록에서 Fork 증거 `proof.allMatch`가 없는 Work가 확인되면 결과가 없다고 조용히 처리하지 않고 미검증 Work 수를 안내. Pi 원본 세션은 수정하지 않음.
- 범위 한계: 정상 Fork이지만 Pi JSONL을 읽지 못하거나 여러 활성 leaf가 불명확한 Work는 bridge가 현재 `[]`로 합쳐 반환한다. 이 세부 상태 구분 및 **실제 Orca host Turn ID/journal 출처**는 추가 계약 필요. 이 UI 수정으로 해결됐다고 판단하지 않음.

### T14 / T17 — 고정 Pi v1.4.0 및 Orca 4a39d186 RPC 경계

- Pi `packages/coding-agent/docs/rpc-extension-ui.md`: `ctx.ui.select`, `confirm`, `input`, `editor` RPC 요청/응답 지원. `notify` 등 fire-and-forget 이벤트도 프로토콜에 존재. `ctx.mode === 'rpc'`, `ctx.hasUI === true`.
- Orca `src/main/pi/rpc-session.ts` → `rpc-dialog-callbacks.ts` → `rpc-extension-dialogs.ts`: 실제 native question/approval에 위 네 가지 dialog를 변환하는 코드 존재.
- Orca `PiRpcDialogCallbacks`의 DECORATION 집합(`notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`)은 현재 렌더링하지 않고 무시. Native UI에서 모두 동작한다고 표시하지 않음.
- Pi RPC의 `ctx.ui.custom()`은 지원하지 않음. TUI 세션과 Native Chat의 동시 writer 금지 및 안전한 인계 절차는 **D6** 결정 전까지 새 전환 동작을 추가하지 않음.
- `extensions/orca-compose.ts`에는 `compose_work_results` 모델 조회 Tool이 **이미 등록**돼 있음. Main Pi 세션을 제한해 실제 Work 답변을 명시적으로 조회하며 자동 주입은 아님. 그러나 사용자가 D5 입력/출력/권한 범위를 확정하기 전이므로 **승인된 최종 계약으로 간주하지 않고 확장하지 않음**.

이 조사로 별도 Extension UI/Chat renderer/Agent 상태 관리자를 신설할 근거는 없음. 테스트·CI·GUI 실행은 사용자 담당.


## 2026-10-29 · Support 결과 최신성 및 전달 대상 우선순위

- **T15/T16 로직 수정:** `OrcaAgentStore.supportResult`는 완료된 마지막 assistant 응답 이후에 미완료 user/assistant/toolResult/custom_message가 있으면 과거 응답을 최신 Support 결과로 제공하지 않고 명시적으로 중단한다. Compaction/ContextEdit 등 대화 상태 항목은 차단 조건에 포함하지 않는다. 원본 JSONL이나 Orca Session을 수정하지 않는다.
- **T16 메뉴 수정:** 연결된 `relatedWorkId`가 검증된 대상 Work 목록에 존재하면 그 Work를 가장 먼저 제시한다. 자동 선택·전송하지 않고 사용자의 명시적 메뉴 선택과 Orca 원본 draft append를 계속 사용한다.
- **Orca 재사용 확인:** 고정 Orca `WorktreeCardAgents.tsx`의 원본 owner 기반 행 활성화/해제, `structured-agent-session-tab-activation.ts`의 세션 탭 선택, `native-chat-composer-draft-store.ts`의 초안 영속화 기능을 유지한다.
- **D1 미확정:** 교차 Worktree는 A(원래 Worktree에서 표시하고 Main에서 이동) 권장, B(두 위치의 읽기 전용 행 참조) 미승인. `PiComposeCrossWorktreeAgentRefs.tsx`는 활성화하지 않는다.
- **미완료:** T12 실제 Orca host turn/journal ID 및 Work별 unreadable 상태, T14 모델 조회 Tool 최종 계약(D5), T17 TUI writer 인계(D6), T18/T20 전체 중복 정리. 사용자 결정 없이 범위를 확대하지 않는다.
- 이번 변경에서는 테스트·CI·GUI 실행, Worktree/브랜치/세션 삭제, 업스트림 버전 변경을 수행하지 않았다.
