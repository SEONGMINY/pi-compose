# Pi Compose × Orca — Native-first 구현 실행 계획서

> **2026-10-28 · 상세 구현 계획 / 구현 승인서 아님**
>
> 기준 저장소: [Pi Compose `refactor/orca-native-first-20261028`](https://github.com/SEONGMINY/pi-compose/tree/refactor/orca-native-first-20261028)
>
> Orca 기준: [`stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8`](https://github.com/stablyai/orca/tree/4a39d186da72a496b29a9ec5c523bbbf0a3460d8)
>
> Pi 기준: [`earendil-works/pi@v1.4.0`](https://github.com/earendil-works/pi/tree/v1.4.0)
>
> 정책 정본: [사용자 합의 제품 결정](./research/ORCA_PI_COMPOSE_PRODUCT_DECISIONS_20261028.md). 기존 설계의 [리팩터링 진단](./ORCA_NATIVE_FIRST_REFACTOR_PLAN.md)을 계승한다. **문서에 적힌 제안은 정책 정본에 우선하지 않는다.** 이 문서는 변경 요청이 오기 전까지 구현 지침으로 사용하되, 미확정 정책을 자동 확정하지 않는다.
>
> **검증 수준:** 고정 Orca 코드·Pi Compose 브랜치 코드를 읽고 작성한 설계다. 일부 overlay 문자열 적용·반복 준비 경로의 정적 검토 기록은 있으나, **전체 macOS 실행·TypeScript 타입 검사·실사용 통합 검증 완료를 뜻하지 않는다.** 아래의 “확인/미확인/구현 예정”을 구분할 것.
>
> **이번 문서 작업은 코드 변경, 테스트/CI 추가, 머지, 세션·Worktree 삭제를 포함하지 않는다.**

---

## 0. 결정적인 한 문장

**Orca는 실행과 작업 공간을 관리한다. Pi는 대화와 Extension을 관리한다. Pi Compose는 원본 Main의 정확한 컨텍스트 Fork와 Main/Work/Support 사이의 “의미적 관계”만 책임진다.**

Orca가 이미 만든 Agent 행·아이콘·상태·메뉴·Git Diff·Worktree·Native Chat·실행 기록은 유지한다. 새로운 별도 Agent 관리 시스템을 만드는 방식은 허용하지 않는다.

### 절대로 바뀌면 안 되는 가치와 동작

1. **고품질 Main 컨텍스트.** 요구사항, 중요한 금지 사항, 변경 이유, 버린 대안과 의사결정 기록이 실제 원본 Pi 대화에 쌓인다. 임의 요약·역할 프롬프트로 대체하지 않는다.
2. **Work는 실제 Pi Session Fork.** 선택한 Main의 **활성 분기에서 마지막으로 완료된 지점**을 새 Pi 세션으로 복제한다. 동일 cwd라 해도 Resume나 요약 전달로 대체하지 않는다. 원본과 복제본이 다르고 계보를 증명해야 한다.
3. **Support는 독립 대화.** 탐색·검색·검증·테스트 실행 등을 병렬로 맡는다. Main이나 Work 전체 컨텍스트를 자동 상속하지 않는다.
4. **Pi Extension 유연성.** 일반 Pi Extension 활용이 핵심 가치다. Orca Native Chat 기본 사용이 Pi TUI 전용 Extension 기능을 금지해서는 안 된다. 지원 범위를 확인하고 필요한 경로를 제공한다.
5. **Orca의 제품 경험 보존.** 클릭, 포커스, 상태, 종료, 복원, 삭제, 생성, Git Diff, 초안, 아이콘, 메뉴 등은 기존 구현을 우선한다. 직접 대체하려면 기존 코드로 불가능하다는 구체적 근거가 먼저 필요하다.
6. **Main 컨텍스트 보호.** Work의 도구 호출/추론/테스트 로그/코드 변경을 Main 모델 입력으로 자동 복사하지 않는다. 사용자에게 보여주는 Work 결과 카드와 모델에 실제로 전달한 정보는 별개다.
7. **사용자 주도 개발.** Work Fork가 준비돼도 개발 지시를 자동으로 보내지 않는다. 한 턴 종료를 “구현 완료”로 오인하지 않는다. Work에서 반복 개선하고 사용자가 직접 검토한다.
8. **코드/기록 보존.** Agent 행 숨김·Chat 탭 닫기·실행 중지·세션 기록 삭제·Git Worktree 삭제는 완전히 다른 동작이다. 사용자 요청 없이 Main/Work 기록과 미커밋 파일을 지우거나 자동 머지하지 않는다.
9. **정책 변경은 사용자와 결정.** Orca 원본 기능을 제거하거나 Fork·컨텍스트 정책에 영향을 줄 경우, 어떤 불변식이 바뀌는지와 대안을 설명한 뒤 결정한다.
10. **실사용 가능성이 완료 기준.** 화면이 그려지거나 코드가 컴파일된 것만으로 완료가 아니다. 준비→생성→개발→종료→재개→결과 확인→정리까지 사용자 흐름을 실제로 검증한다.

## 1. 세 종류의 관계 — 가장 먼저 분리해야 하는 개념

```text
[Git 소속]             Orca Project / Workspace / Worktree
[실행 소속]            Orca Agent Session / Pane / Tab / Running Status
[대화 컨텍스트]         Pi Main ──실제 Session Fork──▶ Pi Work
                                     └──참조만 연결──▶ 독립 Pi Support
```

- **Git Worktree parent**는 실행/코드 공간의 관계다. Main의 Pi 대화 Fork 출처를 증명하지 않는다.
- **Orca orchestration.parentPaneKey**는 실제 위임/터미널 실행 관계다. Pi Session Fork의 증거가 아니다.
- **Pi Compose parentMainId/sourceEntryId/relatedWorkId**는 실제 세션 계보·표시 연결이다. Orca의 생명주기 상태를 대신하지 않는다.
- **“Main 아래 표시”**는 UI 계층 관계이지 Git 디렉터리나 Session ownership의 이동이 아니다. Work가 다른 Worktree에서 동작해도 원래 위치·실행·관리 권한은 유지된다.

### 1.1 사용자 흐름의 목표

```text
Orca 프로젝트
  ├─ Orca Worktree A
  │   ├─ Main · 회원가입 설계 [Pi Native Chat, 실제 기록]
  │   │   ├─ Work · 진짜 구현 [실제 Pi Fork · A 또는 B에서 실행]
  │   │   │   └─ Support · 테스트 검증 [독립 Pi 대화 · A 또는 C에서 실행]
  │   │   └─ Work · API 연동
  │   └─ Main · 결제 설계 [독립적인 두 번째 Main]
  ├─ Orca Worktree B [독립 Git 작업 공간, Orca가 관리]
  └─ Orca Worktree C [독립 Git 작업 공간, Orca가 관리]

Main 대화:
  ▸ 연결된 Work · 진짜 구현
    회원가입 기능 구현을 완료했습니다.  ← Work가 실제 남긴 보고
    [클릭] Orca의 기존 방식으로 실제 실행 내역 펼침
```

**그림은 정보 관계를 설명한다.** Orca가 기본으로 제공하지 않는 별도 트리 UI나 역할별 새 아이콘을 만들라는 뜻은 아니다. 아래 P2의 교차 Worktree 레이아웃은 기존 Orca 카드/계층 표현을 조사한 뒤 결정한다.

## 2. Single Source of Truth — 소유권 계약

| 데이터/행동 | 정본 | Pi Compose 최소 추가 책임 | 절대 하면 안 되는 일 |
| --- | --- | --- | --- |
| Main/Work/Support의 대화 내용과 분기 | Pi SDK `SessionManager` / 실제 JSONL | 원본 세션 ID, source leaf, Fork 증거, Work 관계 | 요약을 Fork라고 부르기, 사용자 Main 파일 수정 |
| Pi Extension / 실행 모델 | Pi SDK 및 사용자 환경 | Native Chat/RPC/TUI 지원 경계 탐색 | UI 통일을 이유로 Extension 제한 |
| 대화 Native Chat / 세션 호스트 | Orca structured Agent Session host | Pi provider ID ↔ Orca session ID 주소 연결 | 별도 transcript/세션 라이프사이클 |
| Agent working/waiting/done/idle | Orca Agent Status / journal | 실제 상태 읽기만 | `prepared/ready`를 실행 상태로 오인 |
| Agent 행/포커스/상태점/아이콘/메뉴 | Orca `WorktreeCardAgents`, `DashboardAgentRow` 등 | 역할·관계 표시의 최소 확장 | 또 하나의 `PiComposeOutline` |
| Worktree/브랜치/Git 상태/삭제 | Orca managed worktree + Git UI | 실행 공간 선택 및 생성 결과 ID 참조 | 직접 별도 `git worktree add` 구현 확장 |
| Tool/Reasoning/실행 시간/펼침 | Orca Native Chat transcript | 다른 Work 세션에 대한 읽기 전용 참조 | 새 결과 로그 UI·가짜 command 이력 |
| Work/Support 결과 전송 | Orca draft storage / 메시지 전송 경로 | 결과를 Work의 **미전송 초안**으로 준비 | 사용자 승인 없이 send 또는 Main 자동 주입 |
| “Main에 연결된 Work” 숨김/복원 | Pi Compose 관계 기록 | 개별 표시 상태 | 기록/파일/Worktree 삭제로 구현 |

### 2.1 최소 관계 레코드(목표 개념 스키마)

```ts
type ComposeRelation = {
  id: string;                         // Pi Compose relation ID, not Orca paneKey
  projectId: string;                  // 실제 Orca project/repository identity
  role: 'main' | 'work' | 'support';
  parentMainId?: string;              // 의미적 Main 소속
  relatedWorkId?: string;             // Support의 선택적 Work 연결
  piSessionId: string;                // Pi provider session id
  piSessionFile?: string;             // host 접근 범위에서만 사용
  orcaSessionId?: string;              // Orca Native Chat identity
  orcaWorktreeId?: string;             // 실제 실행 위치, context parent가 아님
  fork?: {
    sourcePiSessionId: string;
    sourceEntryId: string;
    sourceEntryIds?: string[];         // 복제 검증 증거
    copiedEntryCount: number;
    excludedInProgress: boolean;
  };
  hiddenFromMainAt?: string;          // 표시만 숨김
};
```

**설계용 스키마로, 곧바로 전체 마이그레이션하라는 지시는 아니다.** 지금의 `OrcaAgentStore` 레코드와 Orca 정본 ID를 매핑해 누락/중복을 확인한 뒤 **원본 하나당 정본 하나**를 유지하는 방향으로 축소한다. `projectId`의 실제 Orca 식별자·remote host 포맷은 확인 후 결정한다. 저장되는 시각 `hiddenFromMainAt`는 실제 Fork 계보를 변경하지 않는다.

### 2.2 ID 연결 검증 계약

- 한 Pi provider session은 동일 실행 컨텍스트에서 **동시에 두 writer가 소유하지 않는다**.
- Orca session을 확인할 때는 반드시 **`agent=pi`, provider session ID, Orca session ID, Worktree ID**를 각각 검증한다. `tab.title`이나 Git branch name으로 추정하지 않는다.
- 실제 Orca Native Agent 행이 없으면 “실행 중” 행을 만들어내지 않는다. History에서 재열 수 있는 사실과 라이브 상태를 구분한다.
- 서브에이전트 합성 행(`rowSource='subagent'`)은 일반 Pi Work와 다르다. 부모의 tool execution roster이며 독립 Pi Session으로 취급하지 않는다.
- 잘못된 mapping, 소속 불일치, 다른 프로젝트/호스트를 발견하면 **미연결**로 표시하고 원본 상태를 보존한다.
- 자동 정리, 임의 재-Fork, 원본 세션 전환은 하지 않는다.

---

## 3. 코드 감사: 현재 무엇이 존재하고 무엇이 빠졌는가

표의 “구현”은 **브랜치에 소스가 있다는 뜻**이다. 운영 수준으로 검증됐다는 뜻이 아니다.

| 기능 | 현재 코드 | 확인된 동작/한계 | 결론 |
| --- | --- | --- | --- |
| Pi Main 생성·가져오기 | `src/orca/agent-sessions.mjs`, `PiComposeMenu.tsx` | Main 원본 JSONL과 등록 레코드, Native Chat 연결 경로 존재. 재열기·다중 Main·Worktree 삭제 후 보존 미검증 | 정본 매핑부터 검증 |
| Main 완료 지점 복제 | `src/orca/completed-main-fork.mjs` | `captureCompletedMain`가 완료 응답을 선택하고 `forkCompletedMain`이 Pi `forkFrom` 결과를 검증 | **핵심 보존**. 실제 활성 leaf 공급 경로 보강 |
| 활성 branch ID 전달 | `OrcaAgentStore.prepare`, `prepareForMain`, `scripts/orca-native-bridge.mjs` | `prepare`는 `activeLeafId`를 받지만 현재 bridge의 `prepareForMain` 호출에는 전달하지 않음 | **P0**. 다중 분기 및 실행 중 응답 검증 필요 |
| 별도 Worktree 생성 | `src/orca/agent-sessions.mjs` | `git worktree add -b` 직접 실행. Orca 등록/정리와 분리 | **P1에서 대체** |
| Native Chat 열기/복구 | `PiComposeNativeChat.ts` | Orca `beginStructuredAgentSessionProvisionalLaunch`, `revealStructuredSession` 사용 | 기본 유지, 실패/중복 writer 재검증 |
| Orca Agent 목록 | `WorktreeCardAgents` / `DashboardAgentRow` | native 상태·아이콘·메뉴·접기·포커스 사용 | 그대로 유지 |
| 같은 Worktree 관계 표시 | `usePiComposeNativeLineage.ts`, Orca `agent-row-lineage-model.ts` overlay | 실제 Pi 세션 매핑이 있어야 행 연결. 원본 orchestration 우선 | **구현 시작됨 / 실사용 미검증** |
| 다른 Worktree 컨텍스트 그룹 | 아직 없음 | native Agent 행은 Worktree 소속. 가짜 paneKey로 그룹을 만들어서는 안 됨 | **P2** |
| Agent 행 `×` / 숨김 | Orca `DashboardAgentRowTrailingControls`, overlay, `setWorkMainVisibility` | `×`는 실행 종료/기록 삭제가 아니라 목록 숨김. 별도 Work 연결 숨김 기록은 보존됨 | 표현/실제 효과 구분 검증 |
| Main의 Work 완료 보고 | 아직 없음 | Orca Native Chat 안의 도구 이력/펼치기는 있음. 별도 Work session 결과를 Main에 참조할 연결 없음 | **P3** |
| Support 결과를 Work 초안으로 | 아직 없음 | Orca `appendToNativeChatComposerDraft` 등 이미 있음 | **P4** |
| Pi Extension 호환성 | `extensions/orca-compose.ts` + Native Chat | UI 전용 Extension이 Native Chat RPC에서 어디까지 동작하는지 미검증 | **P5** |
| 원본 패치 보존 | `scripts/orca-native-overlay.mjs` | pin+manifest, hash 비교. 과거 패치 중복 오류를 수선했지만 macOS 실제 재설치 미검증 | **P0/P6** |

### 3.1 지금 코드에서 특히 의심해야 할 지점

- `usePiComposeNativeLineage`는 `agents.length`, Worktree/cwd 등을 기준으로 목록을 갱신한다. **같은 개수의 다른 Agent가 나타났을 때** 실제 관계 변화가 적절히 반영되는지 확인해야 한다. Native UI의 미활성화/활성화 타이밍, RPC 실패, 렌더 비용을 포함한다.
- 같은 Worktree끼리 관계가 보이는 것은 **다른 Worktree에 있는 Work가 Main에 표시되는 것과 다르다.** 결과를 과장하지 않는다.
- 현재 `PiComposeMenu`는 생성 후 Orca Native Chat 채택에 실패해도 준비된 Pi/Worktree 자산이 남을 수 있다. orphan 상태에서 **원본을 보존하면서 정확히 재개**할 길이 필요하다.
- 최신 완료 지점은 **가장 마지막에 추가된 JSONL 행**과 다를 수 있다. `activeLeafId` 없이 분기 선택을 추측하면 안 된다.
- overlay가 upstream 텍스트를 직접 수정하는 방식은 장기 유지보수 리스크다. **패치 수를 늘리기보다 더 작은 연결 지점으로 통합**해야 한다.
- 각 현행 기능이 실제 macOS에서 동작하는지는 별도의 실사용 검증이 필요하다.

---

## 4. 구현 순서와 의존성

| 우선순위 | 작업 | 선행 조건 | 주된 완료 결과 |
| --- | --- | --- | --- |
| **P0** | 정본·계약·활성 Pi leaf·기존 데이터 감사 | 현재 브랜치 | 틀린 ID/잘못된 Fork 차단, 안전한 기준선 |
| **P1** | Orca Native Worktree 생성 + 세션 생명주기 통합 | P0 | 직접 Git 생성 제거, 등록/복원/실패 일관성 |
| **P2** | Main 중심 네이티브 관계/다른 Worktree 그룹핑 | P0, P1 ID 계약 | Orca 행을 재사용해 실제 Pi 관계 표시 |
| **P3** | Work 결과 → Main 대화의 접는 항목 및 읽기 | P0/P2 session link | Main에서 근거 있는 Work 결과 확인 |
| **P4** | Support 결과 → Work 미전송 초안 | P0/P1/P2 대상 주소 | 독립 병렬 검증과 선택적 전달 |
| **P5** | Pi Extension/TUI 호환성 검증 및 보완 | P1 | Pi 유연성을 잃지 않고 실행 |
| **P6** | 중복 코드 정리, 업그레이드/복구/제품 QA | 각 기능 이관 후 | 실제 개발 한 사이클을 안전하게 수행 |

**병렬화:** P0 내 Orca 소스 조사/코드 경로 검증 등은 독립 조사로 병렬 처리 가능하다. 그러나 **P1 소유권 계약이 확정되기 전에 P2 화면을 확정하거나 P3의 모델 컨텍스트 전달을 임의 구현하지 않는다.** 먼저 차이를 문서로 명확히 하고 사용자와 방향을 맞춘다.

---

## P0. 원본 계약 및 Pi Fork 정확성 감사 — 먼저 할 작업

### P0-1. Pi 활성 leaf를 실제 세션에서 읽는다

**기존 Pi 코드 재사용**
- `packages/coding-agent/src/core/session-manager.ts`의 `SessionManager.getLeafId()`, `getBranch()`, `forkFrom` 등 (v1.4.0의 정확한 타입/호출 계약 확인).
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts` / `packages/coding-agent/src/core/agent-session.ts`에서 실시간 활성 분기, turn 정지·완료, RPC snapshot 정보를 확인.

**Pi Compose 변경 대상**
- `src/orca/completed-main-fork.mjs`: 기존 완료 분기 캡처·검증 코드는 유지.
- `src/orca/agent-sessions.mjs`: `prepare({ activeLeafId })`가 실제 원본 Main의 활성 leaf를 받도록 함.
- `scripts/orca-native-bridge.mjs` 및 IPC contract: 현재 bridge→`prepareForMain`에서 빠진 authoritative leaf 입력 전달.
- Main Orca Native Chat의 실행 호스트/세션 ID→Pi 활성 leaf를 얻는 **읽기 전용 경로** 확보. 임의 JSONL 마지막 행으로 대체하지 않음.

**단계**
1. Orca에서 연 Main의 **정확한 provider session ID**를 판별한다.
2. Pi RPC/SessionManager가 보고하는 **현재 활성 leaf**를 확인한다.
3. 그 branch의 완료된 assistant 응답을 선택한다. 요청 중이면 마지막 완료 지점까지 자르고 사용자에게 제외 사실을 알린다.
4. 원본 JSONL 스냅샷을 읽기 전용으로 캡처, Pi SDK `forkFrom`으로 **새 ID/새 파일** 작성, 정확히 같은 ID 체인인지 검증한다.
5. provenance: 원본 Pi ID, leaf ID, entry 수, 생성한 Pi ID, 생성 시 실행 cwd를 기록한다.
6. 실패 시 원본 수정/추가, 자동 Resume, 완료 선언 금지. 생성된 자산을 조용히 삭제하지 않고 회복 가능하도록 상태를 보고한다.

**완료 기준**
- 단일/다중 branch, assistant 응답 진행 중, 완료 직후, 같은/다른 cwd에서 **선택한 완료 branch만 복제**.
- Work 첫 메시지는 사용자가 직접 입력. Fork한 시점 이후 Main 변경은 Work에 자동 반영하지 않음.
- 원본과 Work의 Pi 세션 ID/파일이 서로 다르고 증명 가능. Fork 실패 시 Main 기록 byte-level 불변.
- Main이 계속 쓰는 중·동시 writer·leaf 판단 불가에서는 안전하게 중단.

**금지:** “Main의 마지막 문장만 복사”, “요약 프롬프트 생성”, “동일 cwd에서 Resume”를 빠른 구현으로 선택하지 않는다.

### P0-2. Orca 세션 ID/Pane/Worktree 관계 감사

**기존 코드**
- [`WorktreeCardAgents.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/WorktreeCardAgents.tsx)
- `useWorktreeAgentRows.ts`, `worktree-agent-rows.ts`, `worktree-agent-row-selectors.ts`
- `src/shared/stable-pane-id.ts`, `src/shared/agent-status-types.ts`
- `src/main/runtime/rpc/methods/structured-agent-session.ts` 및 `agentSession.history` / `agentSession.subscribe`
- `src/renderer/src/lib/activate-ai-vault-structured-session.ts`의 `revealStructuredSession`

**해야 할 일**
1. Pi provider ID / Orca session ID / paneKey / tab ID / worktree ID / Git repository ID 사이의 **현재 매핑 실측표** 작성.
2. 같은 Worktree 두 Main, 하나 Main의 Work 여러 개, 외부 Worktree의 Support, 탭 close/reopen 시 어떤 ID가 유지되는지 확인.
3. 이전 브랜치에서 만든 `prepared`/`connection-error` 레코드가 native 상태/History에 어떻게 보이는지 확인.
4. “현재 작동 중”은 반드시 Orca state에서 읽는다. Compose record의 `state='ready'`는 등록/연결 단계이지 실행 state가 아님.
5. owner mismatch/중복 세션/원본 누락은 변경하지 않고 오류로 표시한다.

**완료 기준:** UI의 하나의 Agent가 **하나의 Orca 세션으로** 추적되며, 정본 세션과 다른 원본을 실수로 활성화하지 않는다.

---

## P1. Worktree와 Native Session 생명주기를 Orca에 완전히 맡긴다

### P1-1. 현재 `git worktree add` 대체

**기존 Orca 코드**
- [`src/main/runtime/workspaces/workspace-creation.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/workspaces/workspace-creation.ts)의 `createManagedWorktree` — 생성·metadata·setup·활성화·실패 복구.
- `src/main/runtime/rpc/methods/agent-launch-worktree-creation.ts`의 `agentLaunchWorkspaceFactory` / `createWorktree` — 이미 호스트 RPC에서 managed creation을 호출하는 예.
- `src/main/runtime/rpc/methods/worktree-create-args.ts`의 `buildManagedWorktreeCreateArgs` — 기존 인자 검증/생성 옵션.
- Orca 기본 Workspace 생성 UI, Git Diff, 브랜치 상태, Workspace 제거 메뉴.

**변경 설계**
1. 사용자가 `현재 작업 공간 사용`을 선택하면 **기존 Orca Worktree ID/cwd 그대로** 사용한다.
2. `별도 Worktree`를 선택하면 Orca가 지원하는 **기존 host 관리 생성 경로**를 호출한다. Renderer가 직접 Git CLI를 실행하지 않는다.
3. 응답한 Orca Worktree ID/path/branch/base commit을 확인한 뒤 **Pi Fork의 targetCwd**로 사용한다.
4. Worktree 생성 성공 → Pi Fork 실패, Worktree 생성 성공 → Native Chat 실패, 생성 요청 timeout 등 **중간 상태를 복구 가능하게** 기록한다.
5. 이미 만들어진 원래 Compose Worktree는 Orca에 자동 중복 생성하지 않고 **기존 Git/Orca 상태를 확인해 안전하게 연결**한다.
6. 생성/등록을 Orca가 책임지고 Git Diff/삭제/재열기도 native 경로가 자동으로 처리하도록 한다.

**기술 검토 포인트:** 사용자가 Worktree만 만들고 대화를 시작하지 않는 경우 Orca의 기본 `startupAgent` / `runHooks` / `activate` 옵션이 **자동 Agent 시작**을 유발하는지 반드시 조사한다. 필요 시 기존 옵션을 사용해 시작을 비활성화해야 하며, 어떤 옵션이 이를 보장하는지 원본 구현으로 증명한다.

**완료 기준**
- shared/isolated 모두 지원, 원본 Main 컨텍스트와 Git 실행 위치가 독립적으로 선택됨.
- Orca에 없는 유령 Worktree, Git에만 있는 Compose 별도 Worktree를 새로 만들지 않음.
- Orca 기본 생성·Git Diff·삭제·실패 안내가 그대로 작동.
- Main Pi 세션 파일은 Worktree 삭제 후에도 원본 보존.

### P1-2. Native Chat 생성·종료·복원 재사용

**기존 Orca 코드**
- `agentSession.create`, `agentSession.ensure`, `agentSession.reveal`, `agentSession.close`, `agentSession.history`, `agentSession.subscribe` — `src/main/runtime/rpc/methods/structured-agent-session.ts` 계열.
- `src/renderer/src/lib/activate-ai-vault-structured-session.ts`의 `revealStructuredSession`.
- `src/main/runtime/rpc/methods/structured-agent-session-rename.ts`의 `agentSession.rename` — Session History/탭/모바일에 공유된 정본 이름.
- `src/renderer/src/components/dashboard/DashboardAgentRow.tsx` / `DashboardAgentRowTrailingControls.tsx` — 상태·아이콘·표시·메뉴.
- `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx` — activate / dismiss / 접기.

**변경 설계**
- 기존 `PiComposeNativeChat.ts`는 Orca 세션을 열거나 기존 것을 reveal하는 **얇은 adapter**만 유지.
- `OrcaAgentStore`의 `state='prepared'/'ready'/'connection-error'`는 UI 상태점에 직접 사용하지 않는다. 생성 workflow의 **입장/실패 기록**에만 허용하며 lifecycle 상태를 대신하지 않는다.
- 닫힌 탭, 실행 중단, 호스트 종료, provider 세션 close, History record 보존을 분리하여 원래 Orca 기능으로 연결.
- session이 불확실할 때 제2의 Pi writer를 만들지 않는다. `reveal`의 `gone`과 `host-cannot-open`을 구별한다.
- 사용자 지정 이름이나 rename 실패 때문에 Pi Fork provenance를 바꾸지 않는다.

**완료 기준:** Agent 하나만 닫기·종료·다시 열기·상태 확인이 정확히 그 Agent에만 적용. 다른 Work/Support/Main은 유지.

---

## P2. 컨텍스트 중심 그룹핑 — Orca 행을 재사용한다

### P2-1. 현재 같은 Worktree 관계 표시 안정화

**기존 Orca 코드**
- `WorktreeCardAgents.tsx` / `useWorktreeAgentRows.ts`
- [`agent-row-lineage-model.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/agent-row-lineage-model.ts)의 `buildAgentRowLineageTree` / `resolveAgentRowParentPaneKey`
- `src/renderer/src/components/dashboard/agent-row-lineage.ts`의 `applyAgentRowLineage`
- `DashboardAgentRow.tsx` / `worktree-card-compact-agent-row.tsx`의 기존 상태/아이콘/시간/확장
- `worktree-card-agents-expansion-state.ts`의 접기 상태

**현재 코드:** `orca-overlay/.../usePiComposeNativeLineage.ts`가 Pi Compose metadata와 실제 Orca 세션 ID를 매칭해 별도 context parent map을 만든다. native Orca orchestration parent가 있으면 그것을 우선한다.

**구현**
1. 기존 Agent row의 `paneKey`, `tab`, `state`, `entry`, `agentType`을 절대로 새로 계산하지 않는다.
2. 실제 Main/Work/Support의 Pi/Orca session 매핑이 모두 확인될 때 **관계용 parent ref만** 계산한다.
3. Orca의 native orchestration 정보가 명시돼 있으면 우선한다. 외부 Pi Fork 관계로 오케스트레이션 메타데이터를 위조하지 않는다.
4. 같은 Worktree 두 Main, Work 여러 개, Support-Work 연결/비연결, 사용자 숨김, orphan, 먼저 끝난 Work, 닫힌 Main 순서로 실사용 검증한다.
5. 관계가 생기거나 사라져도 Orca의 원래 포커스/상태점/컨텍스트 메뉴, Compact/Expanded, 키보드 접근성을 그대로 유지한다.
6. RPC 조회가 매 Agent 렌더마다 중복 실행되는지, 타이밍/데이터 갱신이 stale한지 점검한다. snapshot/구독/메모이제이션의 가장 작은 해결책을 선택한다.

**아이콘 정책(확정):** Orca의 `AgentTypeIcon`/`AgentStateDot`를 그대로 사용한다. Orca가 진짜 subagent의 종류 아이콘을 생략하는 경우만 기존 구현을 따른다. Main/Work/Support에 말풍선/기어/로봇 같은 **새 장식 아이콘을 넣지 않는다.**

### P2-2. 서로 다른 Worktree의 Work를 Main 아래에서 확인

**이 문제의 본질:** Orca의 기존 `WorktreeCardAgents(worktreeId)`는 해당 Worktree 소속 Agent만 받는다. 다른 Worktree의 행을 복사해 Main Worktree에 붙이면 선택과 상태·종료·삭제가 잘못된 Worktree를 향할 수 있다.

**소스 조사 순서**
1. `src/renderer/src/components/sidebar/worktree-card-secondary-rows.tsx`의 `WorktreeCardAgents` 진입과 Worktree 카드 생성 경로.
2. `useWorktreeAgentRows` / `worktree-agent-row-selectors.ts`의 Worktree별 행 수집·원본 ID.
3. Orca의 Worktree parent/child UI, `WorktreeContextMenuView.tsx`의 기존 연결·선택·삭제 메뉴.
4. `src/renderer/src/components/dashboard/agent-row-lineage-model.ts` 및 기존 Dashboard Agent tree 지원 범위.
5. History/Agent feed에서 동일 실제 session을 여러 위치에 “참조”하는 기존 affordance가 있는지 확인.

**원칙을 지키는 구현 후보의 우선순위**
- **후보 A (우선 조사):** 기존 Orca 카드/Agent 행의 **원래 위치를 유지**하면서 Main의 연결 정보만 native 계층/참조로 제공. Work를 열 때 Orca의 기존 `activateAndRevealWorktree` + `activateStructuredAgentSessionTab`를 사용.
- **후보 B (A가 부족한 경우):** 기존 Orca의 Agent row renderer/실행 대상 routing은 그대로 사용하되, **읽기 전용 context projection**에서만 그룹을 합쳐 보여주는 host extension. 상태/메뉴는 원본 Worktree owner에 위임.
- **금지:** fake `parentPaneKey`, fake `worktreeId`, duplicate `AgentStatus`, 중복 tab/Agent identity, Git Worktree 이동, 새 자체 Agent 트리 렌더러.

**결정 게이트:** Orca 기본 사이드바 구조에서 A/B 중 무엇이 가능한지는 **실제 컴포넌트/소유권 경로를 검증한 뒤** 사용자와 보여줄 범위를 결정한다. 크로스 Worktree 관계를 이유로 Orca의 기존 Worktree 그룹핑을 지워서는 안 된다.

**완료 기준**
- Main A에 Work 1, Work 2, Support 1; Main B에 Work 3을 올바르게 구분.
- Work가 다른 브랜치/Worktree/프로젝트 탭에 있어도 원본 소속을 유지.
- Main의 접기/펼치기/Work 포커스/상태/종료/재개/개별 목록 숨김 정상.
- 선택한 Work만 제거하면 Main과 다른 Agent, 코드는 유지.
- Agent가 live row에 없을 때 가짜 “working”을 표시하지 않는다.

### P2-3. Main 목록의 지속성

Orca activity 목록은 영구 Pi 대화 목록과 다르다. 저장된 Main이 실행 중이 아니면 status row가 사라질 수 있다.

- 기존 Orca Session History 및 재열기 기능을 우선 조사한다.
- Main을 영구 Agent activity 행으로 위장하지 않는다.
- **등록된 Main을 어떻게 찾아 다시 열고 그 아래 Work를 보느냐**는 사용자 흐름으로 검증한다.
- 필요한 경우 기존 History/검색/그룹 affordance의 최소 참조 기능만 제안한다. 별도 Agent 관리 대시보드 신설은 마지막 수단.

---

## P3. Work 결과를 Main 대화 안에서 펼쳐 본다

### P3-1. 사용자에게 보여줄 형태

```text
[Main · 회원가입 설계 대화]

  ▸ 연결된 Work · 진짜 구현
    회원가입 기능 구현을 완료했습니다.

클릭 (새 대화로 전환하지 않음)

  ▾ 연결된 Work · 진짜 구현
    회원가입 기능 구현을 완료했습니다.

    15s 작업 내역
    1번 명령
    1번 명령 실행 및 3 파일 읽기

    추론
    bash 실행 · git status --short --branch…
    read · review.md
    read · signup.mjs
    read · signup.test.mjs
```

**원칙:** Orca가 현재 transcript에 쓰는 동일한 “턴 펼침/명령/추론/파일 읽기” UI를 재사용한다. 새로운 “작업 상세 화면”이나 Work 대화로 자동 포커스 이동하는 버튼을 만드는 것이 아니다.

### P3-2. 재사용할 Orca 소스

- [`NativeChatWorkingStatus.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatWorkingStatus.tsx): 종료된 턴의 시간/펼침 토글.
- [`NativeChatToolRun.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatToolRun.tsx): 실행 명령/파일 읽기 등 도구 이력 표시.
- `NativeChatReasoningRow.tsx`: 허용된 reasoning 기록 표시.
- [`NativeChatSubagentRun.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatSubagentRun.tsx): 기존 하위 실행 펼침.
- `NativeChatTranscriptRow.tsx` / `NativeChatMessageList.tsx` / `use-native-chat-transcript-slots.ts` / `native-chat-subagent-section-slots.ts`: 가상 스크롤, 원본 메시지와 펼침 위치 관리.
- `src/main/runtime/rpc/methods/structured-agent-session.ts`의 `agentSession.history` / `agentSession.subscribe`: 실제 Orca host journal 읽기.

**경계:** Orca의 `NativeChatSubagentRun`은 본래 같은 provider/journal에서 이어진 하위 실행을 다룬다. **별도 Fork Pi 세션의 Work**가 자동으로 “subagent block”이 되는 것은 아니다. 완성된 subagent UI와 세션 간 전송을 혼동하지 않는다.

### P3-3. 추가할 최소 도메인 계약

```ts
type WorkResultReference = {
  mainOrcaSessionId: string;
  workOrcaSessionId: string;
  workPiSessionId: string;
  workTurnId: string;        // 실제 호스트의 종료 턴 ID
  workRecordId: string;      // provenance 및 Main 소속 검증
  observedAt: string;
  reportText?: string;       // Work의 실제 보고; 임의 생성 금지
};
```

구현 순서:
1. 실제 Work session의 host journal에서 **어느 턴이 종료됐는지** 확인한다. `working/done`는 Orca 정본을 사용.
2. 종료 턴의 Work assistant 응답에서 보고 텍스트/원본 ID를 가져온다. “회원가입 기능 구현 완료”라는 주장은 **Work가 실제 그렇게 보고했을 때만** 쓴다. 턴 종료만 확인되면 “Work가 응답을 마쳤습니다”로 구분한다.
3. 같은 보고를 중복 표시하지 않도록 `workOrcaSessionId + turnId` 키를 사용한다. 여러 번 수정/후속 턴이 있으면 결과 항목을 정확한 순서로 보존한다.
4. Main의 **화면 전용 읽기 참조 항목**에 연결한다. 필요할 때 원본 host history를 읽고 Orca 기존 transcript/detail 렌더러로 펼친다.
5. 닫힌/삭제됐거나 host가 unavailable한 Work는 완료를 위조하지 않고 “기록을 읽을 수 없음” 등의 실제 상황을 보여준다.
6. 읽기 요청은 소속/권한/호스트 범위를 검증하고, 원본 워크세션에 메시지나 명령을 보내지 않는다.
7. 스크롤/virtualization/키보드/기존 턴 펼침이 보존돼야 한다.

### P3-4. Main 화면 정보와 Main 모델 컨텍스트의 구분

| 동작 | Main 화면 | Main 모델 입력 |
| --- | --- | --- |
| Work가 끝난 경우 | 실제 완료/종료 보고가 있다면 참조 항목 표시 | 자동 추가 없음 |
| 사용자가 항목 클릭 | Work 실행 내역 확장 | 자동 추가 없음 |
| 사용자가 Main에 “Work 뭐 했어?” 질문 | 연결된 기록을 확인할 수 있어야 함 | **필요할 때만** 읽기 전용 Tool로 근거를 가져오는 방식 검토 |
| 사용자가 Work 결과를 Main 설계에 반영하려는 경우 | 원본 결과 참조 | 사용자가 명시적으로 승인/요청한 정보만 반영 |

현재 `extensions/orca-compose.ts`는 주로 UI slash command라 Main 모델이 Work 상태/결과를 **Tool로 조회할 수 없는 문제**가 있다. 따라서 최소 `getLinkedWorkResults` / `readWorkTurn` 같은 읽기 전용 Extension tool을 후보로 검토하되, 기존 Orca의 세션 조회가 가능한지 먼저 조사한다. **어떤 로그도 자동 삽입하지 않는다.**

**완료 기준:** 사용자 Main 대화에서 Work가 실제 보고한 결과를 볼 수 있고, 클릭 시 **대화 전환 없이** 원본 Orca 방식으로 기록을 펼친다. Main 모델이 질문받았을 때 확인할 방법이 있지만 임의로 “공식 handoff를 받았다”고 거짓말하지 않는다.

---

## P4. Support는 독립 실행, 결과는 사용자가 Work 초안으로 전달

### P4-1. 독립 실행·동시 개발

- Support 생성은 `SessionManager.create` 등 Pi의 새 대화를 사용, **Main Fork 금지**.
- 실행 공간은 사용자 선택: 현재 Worktree 또는 별도 managed Worktree.
- Support에서 코드 검색/테스트를 돌리는 중 Work는 계속 개발할 수 있다.
- Support가 사용 중인 Git 작업 공간/브랜치와 테스트 시점의 코드 기준을 식별한다. 특히 다른 Worktree에서는 미커밋 변경이 자동으로 복제되지 않는다.

### P4-2. Orca 입력창 초안 재사용

**기존 Orca 코드**
- [`native-chat-composer-draft-store.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/native-chat-composer-draft-store.ts)의 `structuredAgentSessionDraftScopeKey` / `appendToNativeChatComposerDraft`.
- `native-chat-composer-draft-persistence.ts` / `native-chat-composer-draft-storage.ts`의 기존 persistence.
- `notes-send-agent-targets.ts` / `running-agent-targets.ts`의 대상 검색.
- Orca `revealStructuredSession` / Native Chat composer 기존 초안 표시.
- **사용 금지:** `agent-message-send.ts`의 즉시 모델 메시지 제출은 이 UX와 다름.

**사용자 흐름(확정)**
1. Support 결과를 검토한 뒤 사용자가 `Work에 보내기` 클릭.
2. 연결된 Work가 유효하면 기본 대상으로 표시; 여러 개면 사용자가 선택.
3. 실제 Orca Work session ID 및 host/Worktree를 확인.
4. Work의 이미 작성 중인 초안을 조용히 지우지 않고, 내용을 검토할 수 있는 미전송 초안으로 추가.
5. Work Native Chat으로 이동해 초안을 검토·수정·삭제 가능.
6. **전송 버튼은 사용자**가 누른다. 그 전까지 Work 모델 입력 없음.

**실패 처리:** Work 닫힘, host unreachable, 기존 초안 저장 거부, 이미지/첨부, 다른 머신 대상, 코드 스냅샷 불명확에서는 자동 전송/성공 표시 금지. 원본 Support 결과를 보존하고 복사 등 복구 기능을 제공한다.

**완료 기준:** Main에는 Support 로그가 자동 들어가지 않으며 Work의 기존 입력/첨부/사용자 작성 메시지도 보존된다.

---

## P5. Pi Extension 유연성과 Native Chat/TUI 호환성

**재사용 경로**
- Pi v1.4.0: `packages/coding-agent/docs/extensions.md` / `rpc-commands.md` / `session-manager.ts`.
- Orca structured Pi host, `agentSession.*` 메서드, Session History.
- 현재 `extensions/orca-compose.ts`의 `/compose-main`, `/compose-work`, `/compose-support`, `/compose-agents`.

**검증 매트릭스(각각 실제 실행)**
1. Pi 기본 도구와 Extension 등록 도구의 모델 호출.
2. Session fork 이후 Extension 코드/설정 읽기 위치와 `AGENTS.md` 등 프로젝트 컨텍스트 변화.
3. Native Chat RPC에서도 정상 지원되는 Extension 기능과 `ctx.ui.select`, `ctx.ui.input` 등 TUI 전용 UI의 차이.
4. 같은 Pi 세션을 TUI/Orca에서 번갈아 사용할 때 writer 충돌 여부.
5. 모드 변경·세션 재열기·slash command·기존 설치된 Extension 충돌.
6. 실패 시 TUI로 전환해도 원본 Pi session/context가 유지되는지.

**원칙:** Orca Native Chat은 기본이고 Pi TUI는 호환성 있는 대안이다. “Pi Extension을 자유롭게 사용”한다는 가치를 훼손하는 Native Chat 제약이 드러나면 감추지 않고 사용자에게 지원 여부를 알린다. 무리하게 Extension 전부를 UI wrapper로 재구현하지 않는다.

---

## P6. 중복 제거·안전한 마이그레이션·제품 검증

### P6-1. 기존 코드의 최종 정리 방향

| 현행 파일 | 조치 | 제거/유지 조건 |
| --- | --- | --- |
| `src/orca/completed-main-fork.mjs` | **유지·정확성 보강** | Pi SDK 계약과 활성 완료 branch 검증 |
| `src/orca/agent-sessions.mjs` | **관계/provenance만 축소** | Git 생성·실행 상태·Chat lifecycle가 Orca로 이전됐을 때 |
| `scripts/orca-native-bridge.mjs`, IPC/preload | **검증된 좁은 명령만** | Pi source/fork/관계 조회·표시/읽기, Orca 기존 기능 중복 제거 |
| `orca-overlay/.../PiComposeMenu.tsx` | **역할·Main 선택 최소 UI** | 기존 Orca 생성·재열기 흐름과 동등 기능; 중복 버튼 제거 |
| `orca-overlay/.../PiComposeNativeChat.ts` | **기존 Orca create/reveal 어댑터** | 세션 identity/중복 writer 검증 |
| `orca-overlay/.../usePiComposeNativeLineage.ts` | **관계 adapter 유지/축소** | 오로지 verified session ID, native row projection |
| 레거시 `PiComposeOutline.tsx` | **실제 대체 검증 후 제거** | 모든 Main/Work/Support 관계 및 재열기 경로가 native UI에서 확인될 때 |
| `scripts/orca-native-overlay.mjs` | **최소 패치로 정리** | 원본 컴포넌트 수정 수 최소화, 반복 prepare·업스트림 drift 보호 |
| 새로운 상태 manager/Agent tree/UI | **만들지 않음** | 불가능한 이유를 구체적으로 증명하지 않는 한 금지 |

### P6-2. 이전 데이터/작업 보호

- 현재 `PI_COMPOSE_STATE_DIR`의 기존 record/launcher와 Pi JSONL/Orca session/Git Worktree는 삭제·재작성하지 않는다.
- 먼저 기존 레코드의 `mainId/workId/piSessionId/orcaSessionId/orcaWorktreeId`를 **읽기 전용으로 감사**한다.
- 동일 Git repo의 여러 Worktree에는 같은 repo 정체성, 서로 다른 실행 위치가 있을 수 있다. 경로 문자열만으로 구분하지 않는다.
- 레거시 레코드가 `prepared`인데 Orca session이 없다면 **고아 기록 보존 + 사용자에게 복구 경로 안내**. 자동 재-Fork 금지.
- session reveal 실패는 `gone`/불확실/호스트 미지원 구분.
- Worktree 삭제 이전 Git 미커밋 데이터와 Pi 세션 보존 범위 확인. 실제 삭제가 수반되면 Orca 원본 확인 흐름 사용.
- **처음 생성했던 기능에 대한 기존 사용자의 데이터**가 새 그룹핑에서 보이지 않는다면 사라졌다고 오해하지 않도록 History·복구 경로 제공.

### P6-3. 설치·업스트림 변경 안정성

- `scripts/orca-upstream.mjs`의 Orca commit pin 유지.
- `scripts/orca-native-overlay.mjs`의 전체 패치 대상·해시/manifest 검증 유지. **첫 prepare, 같은 소스 재prepare, 기존 준비 상태에서 업데이트**를 구분.
- 사용자가 원본 Orca checkout 파일을 직접 수정했다면 덮어쓰지 않고 중단.
- 패치 필요 지점을 새로 추가할 때 “Orca의 기존 공식 내부 helper/플러그인 API/호스트 RPC를 쓸 수 없는 이유”를 먼저 문서화.
- plugin/upstream 버전 변경은 현재 pinned Orca 코드를 다시 확인하고, 무조건 최신 파일명을 추측하지 않는다.

### P6-4. 실사용 QA — 테스트 코드/CI 추가 없이 검증

아래는 **실행 시나리오**이며 자동 테스트 구현 요청이 아니다.

| 시나리오 | 반드시 확인할 기대 결과 |
| --- | --- |
| Orca만 사용 | 원본 `+`, 키보드 단축키, 워크스페이스 생성, 메뉴, 상태, Git Diff, 탭 종료 모두 동일 |
| Main 두 개 | 두 대화의 Pi JSONL·설계 맥락이 섞이지 않음 |
| 기존 Main import | 기존 세션 이름·이력 보존, 실제 Orca session으로 복원 |
| Main 다중 branch | 활성 완료 leaf만 Fork, 출처 ID 정확 |
| Main 응답 중 Fork | 마지막 완료 지점까지만 복제, 제외 안내 |
| Work shared | 같은 디렉터리에서도 **새 Pi 세션**, Resume 아님 |
| Work isolated | Orca managed Worktree 생성/등록/상태/삭제, 기존 코드와 충돌 없음 |
| Work 둘 이상 | 개별 행 선택·종료·숨김, 다른 Work와 Main 유지 |
| Support independent | Main/Work 대화 상속 안 됨, 현재/별도 Worktree 실행 가능 |
| cross-worktree 그룹 | Main에서 관계 확인, Work 선택 시 실제 원래 소유 Worktree/세션 열림 |
| 완료 보고 | Work 보고가 Main의 접힌 항목에 나타나고 실제 기록만 표시 |
| Main 모델 질문 | 필요 시 근거 읽기, 모델이 실제로 받지 않은 자동 handoff를 받았다고 주장 안 함 |
| Support→Work 초안 | 기존 입력/첨부 보존, 사용자 전송 전 모델 호출 0 |
| 탭 닫기/재개 | 동일 Pi/Orca 세션 복원, 중복 writer·중복 Fork 없음 |
| Worktree 삭제 | 잘못된 범위 삭제 없음, Main Pi 기록 보호 |
| Extension | Native Chat 지원 범위+TUI 대체 경로 확인 |
| 앱 재시작/업데이트 | 저장된 관계·session mapping·이전 작업 복원 가능 |
| `orca:prepare` 반복 | 두 번째 실행도 통과, 업스트림 drift에서 fail closed |

**완료 정의:** 사용자가 “Main에서 충분히 설계 → Work 정확히 Fork → Work에서 개발/반복 수정 → Support 독립 검증 → 결과 검토 → Main에서 근거 확인 → 필요한 Agent만 정리 → 재실행”을 끝까지 수행할 때, Orca 원본 기능의 회귀가 없다.

---

## 5. 실제 개발 단계마다 지켜야 하는 작업 프로토콜

1. **기존 Orca 기능 먼저 확인.** 문서와 고정 commit의 실제 호출 경로를 읽는다. “Orca에 없는 기능”이라고 섣불리 판단하지 않는다.
2. **사용자 요구 → 기존 Orca 코드 → 부족한 필드/계약 → Pi Compose 추가 책임**을 파일 단위로 기록한다.
3. **구현안 2개 이상일 때는 원본 보존량·resource 소모·사용성 영향·핵심 가치 훼손 가능성**을 함께 비교한다.
4. 기존 lifecycle/아이콘/상태·메뉴·Git 기능을 바꾸는 설계는 사용자에게 먼저 알린다.
5. Orca 기본 코드는 가능하면 **그대로 호출/재사용**하며, 누락된 케이스/관계만 최소 확장한다.
6. Main Fork와 Pi Extension에 대한 안전성 검증은 어떤 편의 기능보다 우선.
7. 패치 적용 뒤 원본 Orca 기능이 영향을 받지 않았는지 보고한다.
8. 구현 결과를 **확인된 사실 / 정적 코드만 확인 / GUI 실행 미검증**으로 정확히 나눈다.
9. 새 기능이 아니라 중복 구현을 만들었다면 **동등 Orca 기능으로 대체 후 제거**한다.
10. CI·테스트 코드·자동 머지/자동 변경은 별도 승인 없이 추가하지 않는다. 문서와 실사용 검증은 수행한다.

### 단계별 작업 보고 양식

```md
## 작업명
- 사용자가 원하는 최종 행동:
- Orca 원본에서 이미 되는 일:
  - 호출 경로:
  - UI/Session/Worktree 정본:
- Pi Compose가 추가해야 할 최소 정보:
- 절대 바꾸지 않을 핵심 불변식:
- 수정 파일과 각 파일 역할:
- 변경하지 않을 Orca 기능:
- 데이터/세션/파일 보존 방식:
- 예상 실패 및 회복:
- 직접 확인한 시나리오:
- 아직 검증하지 못한 항목:
- 사용자와 논의해야 하는 결정:
```

---

## 6. 사용자와 논의가 필요한 결정 — 구현자가 임의 선택하지 않는다

1. **교차 Worktree 관계의 실제 표시 방식.** Orca 기존 사이드바/Agent Dashboard가 지원하는 native 참조 구조를 조사하고, Main 아래에서 다른 Worktree Work를 어떻게 보여줄지 기존 UI 보존 관점에서 결정. 새 “Agent manager”는 안 됨.
2. **Work/Support 생성 시 작업 공간 선택의 기본값.** 매번 선택할 수 있다는 것만 확정됐고 shared/isolated 중 초기 기본값은 미확정.
3. **종료/삭제/숨김의 구체 생명주기.** 개별 행 숨김과 독립 Pi 세션/Worktree 자산의 삭제 범위, 복구·메뉴 안내를 어떻게 결합할지.
4. **별도 Support Worktree가 Work의 미커밋 변경을 대상으로 검사해야 하는 경우.** 자동 복제·cherry-pick을 도입하는 것은 미합의.
5. **Main 결과 보고의 모델 접근 경계.** UI에서 Work 로그를 펼치는 방식은 확정. Main 모델이 사용자의 질문을 받았을 때 읽을 **최소 read-only tool 계약**의 내용/범위는 기존 Orca 기능 확인 뒤 제안.
6. **Native Chat과 Pi TUI Extension 호환성 차이.** 어떤 Extension UI는 Native Chat에서 지원되지 않을 수 있어 실제 매트릭스와 사용자 선택 동선을 확인한 뒤 결정.
7. **원격 호스트·여러 머신 간 Support→Work 초안 이동.** 현재 Orca가 허용하는 host 경계부터 확인.

미확정 사항이 있어도 **안전하게 진행 가능한 조사, 정본 ID 검증, 기존 기능 복구**는 먼저 수행할 수 있다. 새 UI나 파괴적인 데이터 변경을 임의로 정하지 않는다.

---

## 7. 다음 세션에서 바로 시작할 수 있는 실무 체크리스트

- [ ] **P0-1** 활성 Main Pi leaf의 실제 호스트 획득 경로와 현재 bridge 누락을 확인하고 계획대로 수정
- [ ] **P0-2** `Pi ID ↔ Orca session ID ↔ paneKey ↔ Worktree ID` 실제 매핑을 한 프로젝트에서 측정
- [ ] **P0-3** 중복 writer/동시 응답 중 Fork 실패 기준, 원본 불변 계약 확인
- [ ] **P1-1** Orca managed worktree 생성 호출/자동 Agent 시작 옵션/실패 복구 코드 확인
- [ ] **P1-2** 기존 직접 `git worktree add` 제거를 위한 단계적 adapter 준비
- [ ] **P1-3** Native Chat create/reveal/close/History 정확한 side effect 감사
- [ ] **P2-1** 같은 Worktree에서 두 Main·두 Work·Support 관계와 개별 제거 실사용 확인
- [ ] **P2-2** cross-worktree 행 참조 시 Orca 포커스/상태/메뉴 소유권 조사 및 설계안 비교
- [ ] **P2-3** Main inactivity/history 상태에서도 관계를 다시 찾는 기본 흐름 확인
- [ ] **P3-1** Work session host journal의 종료 턴/최종 응답/실행 기록 읽기 계약 확인
- [ ] **P3-2** Main transcript에 **읽기 전용 연결 항목**만 삽입할 native slot 조사
- [ ] **P3-3** Main 모델 on-demand 확인 경로가 필요한 최소 read-only 범위 설계
- [ ] **P4-1** Support의 독립 Pi 세션 및 코드 기준 시점 확인
- [ ] **P4-2** Orca 기존 Draft append + 다른 Worktree 대상 선택 + 절대 미전송 조건 검증
- [ ] **P5** Extension 호환 매트릭스와 Pi TUI 선택 경로 검증
- [ ] **P6** 레거시 세션/Worktree 보존, 기존 중복 코드 제거, `prepare` 반복 및 제품 QA
- [ ] 단계별 구현 전 **Orca 원본 코드 재사용 / 부족한 계약 / 핵심 가치 보호** 표를 갱신
- [ ] **사용자 승인 없는** 새 아이콘·새 관리 UI·새 상태 시스템·Git 자동화·CI·자동 머지 금지

---

## 8. Orca / Pi 실제 소스 인덱스

아래는 **고정 Orca commit** 기준으로 실제 존재와 코드 역할을 확인한 주요 파일이다. 참조할 때 최신 main의 이름으로 추측하지 말고 고정 SHA의 실제 코드를 확인한다.

### Agent 행/관계/아이콘/선택

- [`WorktreeCardAgents.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/WorktreeCardAgents.tsx) — 기존 Agent 행·상태·포커스·접기·dismiss·선택.
- [`useWorktreeAgentRows.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/useWorktreeAgentRows.ts) — Worktree별 실제 Agent 행 수집.
- [`worktree-agent-rows.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/worktree-agent-rows.ts) — live/retained/subagent 합성.
- [`agent-row-lineage-model.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/agent-row-lineage-model.ts) — 네이티브 orchestration parent/child 계산.
- [`agent-row-lineage.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/agent-row-lineage.ts) — 행 들여쓰기/child count의 presentation.
- [`DashboardAgentRow.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/dashboard/DashboardAgentRow.tsx) — 상태점과 native `AgentTypeIcon`, 이름, 메뉴.
- [`worktree-card-compact-agent-row.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx) — compact native row와 아이콘.
- [`worktree-card-secondary-rows.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/sidebar/worktree-card-secondary-rows.tsx) — Worktree 카드 안의 native Agent 행 삽입.

### Worktree·세션·복원

- [`workspace-creation.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/workspaces/workspace-creation.ts) — managed Worktree 생성.
- [`agent-launch-worktree-creation.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/rpc/methods/agent-launch-worktree-creation.ts) — 호스트 RPC에서 managed creation 사용 예.
- [`worktree-create-args.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/rpc/methods/worktree-create-args.ts) — Worktree create 인자/옵션.
- [`structured-agent-session.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/runtime/rpc/methods/structured-agent-session.ts) — Agent Session create/send/close/history/subscribe.
- [`activate-ai-vault-structured-session.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/lib/activate-ai-vault-structured-session.ts) — 실제 session reveal/복구.

### Main의 펼침 결과·Support 초안

- [`NativeChatMessageList.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatMessageList.tsx) — 원본 transcript 가상 목록/슬롯.
- [`NativeChatTranscriptRow.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatTranscriptRow.tsx) — 작업 상태와 메시지 연결.
- [`NativeChatWorkingStatus.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatWorkingStatus.tsx) — “Worked for 15s” 펼침.
- [`NativeChatToolRun.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatToolRun.tsx) — 명령/파일 읽기 세부 내역.
- [`NativeChatSubagentRun.tsx`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/NativeChatSubagentRun.tsx) — 기존 하위 실행 상세.
- [`native-chat-composer-draft-store.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/native-chat-composer-draft-store.ts) — 입력창 초안 저장·추가.
- [`native-chat-composer-draft-persistence.ts`](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/renderer/src/components/native-chat/native-chat-composer-draft-persistence.ts) — 초안 내구성.

### Pi

- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/session-manager.ts) — 실제 Pi 세션 및 분기 관리.
- [`packages/coding-agent/docs/extensions.md`](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md) — Extension API.
- [`packages/coding-agent/docs/rpc-commands.md`](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md) — Pi RPC 명령 범위.

### Pi Compose

- [`src/orca/completed-main-fork.mjs`](../src/orca/completed-main-fork.mjs) — 실제 완료 branch 캡처/정확한 Pi Fork.
- [`src/orca/agent-sessions.mjs`](../src/orca/agent-sessions.mjs) — 현재 관계/provenance와 레거시 Git 생성.
- [`orca-overlay/src/renderer/src/components/pi-compose/usePiComposeNativeLineage.ts`](../orca-overlay/src/renderer/src/components/pi-compose/usePiComposeNativeLineage.ts) — 같은 Worktree의 Pi 관계 투영.
- [`orca-overlay/src/renderer/src/components/pi-compose/PiComposeNativeChat.ts`](../orca-overlay/src/renderer/src/components/pi-compose/PiComposeNativeChat.ts) — Orca Native Chat 채택/재개.
- [`scripts/orca-native-overlay.mjs`](../scripts/orca-native-overlay.mjs) — pinned Orca에 소규모 hook 적용.

---

**최종 판단 기준:** 기능을 개발하기 전에 **“Orca가 이미 제공하는 것은 무엇이며, 정확한 Pi Main Fork와 Extension 자유를 지키려면 무엇만 추가해야 하는가?”**에 코드와 사용자 흐름으로 답할 수 있어야 한다. 그 답이 없다면 새 기능을 구현하지 않는다.
