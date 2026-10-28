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
