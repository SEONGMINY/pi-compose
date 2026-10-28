# Pi Compose × Orca — Native-first 통합 구현

> 작업 브랜치: `feat/orca-batch-integration-20261028`  
> 기준: `stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8`, Pi SDK `1.4.0`  
> 상태: **코드 통합 중. Orca macOS GUI 빌드 및 실기 동작은 검증 전.**  
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
- **미확인:** Node 24 + pnpm 실제 타입 검사/빌드, macOS Electron GUI 실행, Orca의 런타임 Pi RPC 소유권·새로운 Worktree 등록·탭 재개·초안 저장 및 동시 수정·실사용 상호작용. 현재 실행 환경에는 GitHub 저장소 체크아웃/외부 네트워크 및 macOS Orca GUI가 없어 이 부분을 통과로 주장하지 않는다.
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
- **P6/T18~T20:** 고정 Orca pin과 overlay 적용 문자열 검사 외 Node 24/pnpm 실제 설치·typecheck·Electron 빌드·macOS UX·U01~U24·레거시 inventory/cleanup 회귀 결과 없음. **GO 판정 불가.**

### 변경 범위 / 검증·보존 기록

- 변경: `src/orca/completed-main-fork.mjs`, `src/orca/agent-sessions.mjs`, `orca-overlay/src/renderer/src/components/pi-compose/PiComposeMenu.tsx`, `orca-overlay/src/renderer/src/components/pi-compose/PiComposeLinkedWorkReports.tsx`.
- 불변: 원본 Main Pi JSONL, 사용자 Git Worktree, 실제 Work/Support 대화, Orca 생성/종료/포커스/원본 Session lifecycle, Pi의 기존 Extension 설정은 개발 중 **수정·삭제하지 않았다**. GitHub 코드 변경만 수행했다.
- 수행: 실제 GitHub 소스 조회, 계획서와 함수별 비교, 변경된 두 `.mjs` 파일을 JS 파서로 구문 검사 **PASS**.
- 미수행: 코드 실행, 기존 테스트 실행, Node/pnpm 타입 검사, Electron 빌드, 실제 Orca GUI, U01~U24 제품 QA. 따라서 **정적 수준의 수정 코드 반영**이며 제품 통합 완료가 아니다.
- 후속은 기존 계획서의 **go/no-go gate**를 따르며, 남은 blocking을 새 자작 UI/Agent/Worktree 관리자로 우회하지 않는다. 사용자가 요청한 대로 별도 CI/테스트 코드를 추가하지 않는다.
