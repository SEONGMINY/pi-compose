# Pi Compose × Orca — Native-first 구현 실행 계획서

> **역사적 실행 계획 — Orca 통합 중단(2026-10-30).** 이 문서의 Orca 관련 P0–P6는 현재 구현 지침이 아닙니다. 최신 방향과 미확정 범위는 [PRD §0](PRD.md#0-최신-사용자-결정--2026-10-30)를 참조하세요. 코드는 이 문서 갱신만으로 변경되지 않았습니다.
>
> **2026-10-28 · 상세 구현 계획 / 구현 승인서 아님 · 필수 누락 사항 재감사 완료(부록 A)**
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


---

## 부록 A. 실행 가능성 재감사 — 기존 계획에서 빠졌던 필수 계약 (2026-10-28)

> **이 부록은 P0~P6의 필수 선행 조건이다.** 초기 계획서가 638줄이더라도 그 사실만으로 실행 가능한 설계가 되지 않는다. 아래에 **실제 코드로 확인한 차이**, **아직 불명확한 구현 계약**, **실패 시 지켜야 할 동작**, **사용자 결정 게이트**를 추가한다.
>
> 상태 구분: **확인** = 고정 버전의 소스 코드를 직접 확인함 / **설계** = 구현 접근이며 API 연결 검증 필요 / **미확정** = 사용자의 결정을 기다림 / **실행 미검증** = macOS 실제 조작·빌드·유지보수 확인 전.
>
> *Orca 기본 구현을 그대로 사용하는 것이 기본값이다. Orca의 어떤 함수·필드가 부족한지 증명되지 않은 항목에 대해 자체 상태 시스템이나 별도 Agent UI를 만드는 것은 금지한다.*

### A-1. 기존 계획서의 보완·정정 사항

| 번호 | 빠졌거나 모호했던 내용 | 실제 확인한 사실 | 수정된 실행 지침 |
| --- | --- | --- | --- |
| G01 | Work Fork의 원본 활성 leaf를 **어디서** 읽는지 | Pi v1.4.0 `session-manager.ts`에는 `getLeafId()`/`getBranch()`, RPC `get_entries` 응답에는 `leafId`가 있다. 하지만 **Orca host에서 해당 Pi RPC를 현재 Main과 묶어 읽는 어댑터는 미확인** | leaf 조회 연결 자체를 P0 통과 조건으로 승격 |
| G02 | 여러 Pi 분기, Compaction, Context의 계보 | `get_entries`는 버려진 분기까지 append 순서로 반환, `getBranch`는 현재 분기만 반환. JSONL 마지막 행을 활성 leaf로 보면 틀린다 | 분기/Compaction/모델 변경/커스텀 entry 보존 확인 후 Fork |
| G03 | Main 생성부터 Fork까지 데이터가 여러 곳에 분산 | `agent-sessions.mjs`가 레코드·launch script·Pi JSONL·Git Worktree를 순서대로 만든 뒤 Native Chat 연결은 UI에서 별도로 실행 | 생성 중간 실패, 중복 요청, 재시도, 앱 강제 종료에 대한 상태·복구표 필요 |
| G04 | Pi Session vs Orca Agent Session vs Tab/Pane/Worktree의 식별 | 서로 다른 ID이며 Orca `structured-agent-session-tab-activation.ts`는 실제 Worktree/Tab/host owner를 검증한다 | ID 매핑·권한·호스트 검증을 mutation별로 정의 |
| G05 | shared/isolated와 dirty Git 작업 복제 | 별도 Worktree는 선택된 `HEAD`를 기준으로 생성된다. 미커밋 파일은 자동 복제되지 않는다 | 실행 대상 코드 기준/미커밋 데이터 정책을 사용자에게 명시 |
| G06 | Work “삭제”와 Agent 행 `×` | Orca `DashboardAgentRowTrailingControls.tsx`의 `×`는 목록/상태 레코드 dismiss. Pi Compose `hiddenFromMainAt`는 **Main 연결 표시만** 숨김 | 두 동작이 달라도 전체 삭제가 아님을 명확하게 표시. 서로 동기화할지는 별도 UX 결정 |
| G07 | 합성 하위 Agent와 독립 Work를 구분하지 않음 | Orca `rowSource='subagent'`는 일반적으로 고유 session/tab 없이 부모 실행 상태에서 만들어짐 | 그 행을 Main에서 Fork된 Work의 생명주기로 취급 금지 |
| G08 | Main 아래 다른 Worktree의 Agent | native `WorktreeCardAgents`는 해당 Worktree의 실제 Agent만 수집 | 가짜 `parentPaneKey`·`paneKey` 없이 참조 위치/클릭 라우팅 별도 증명 |
| G09 | Orca Session History에 Main이 없어지는 경우 | native activity row는 영구 Main 인덱스가 아니다 | Main 불활성/닫힘/삭제 후 검색·재개·관계 확인 흐름 명세 |
| G10 | Work 완료 보고의 발생 시점 | Orca는 턴 종료 시각을 알 수 있으나 “기능 구현 완료”의 진위는 아님 | `응답 종료` / `Work가 완료 보고` / `사용자 승인`을 별개 개념으로 정의 |
| G11 | Main 화면에 Work 결과가 보이는 것 vs 모델이 안다는 것 | 화면 항목은 모델 입력이 아님. 현 `extensions/orca-compose.ts`는 slash command 위주이며 모델 호출 가능한 결과 조회 Tool은 없음 | Main 모델이 결과를 질문받을 때의 읽기 전용 접근 경로를 명시 |
| G12 | 외부 Work 세션 실행 이력을 Main 내부에 펼침 | `NativeChatSubagentRun`은 **같은 journal의 하위 실행**이라는 전제가 있음 | 원본 host history를 읽어 **읽기 전용 참조**로 투영. 임의 subagent message 생성 금지 |
| G13 | Support 결과 전송의 중복/초안 손상 | Orca `appendToNativeChatComposerDraft`와 영속성 경로 존재 | 기존 초안·첨부·늦은 hydration·동시 창 수정/중복 클릭 방지 필요 |
| G14 | Pi Extension 호환성 설명 과도한 단순화 | Pi v1.4.0 공식 `extensions.md`는 RPC에서도 **지원되는 UI dialog/notification을 전달**할 수 있고, custom terminal component는 지원하지 않는다고 설명 | `ctx.hasUI` 전체를 “TUI 전용”이라 단정 금지. 기능별 실제 지원표 작성 |
| G15 | 레거시 데이터 마이그레이션 절차 없음 | `OrcaAgentStore` JSON 레코드/launchers와 Orca history가 병존 | 읽기 전용 inventory → 정본 확인 → 안전한 idempotent 채택 → 상태표시 → 후속 정리 순서 |
| G16 | overlay patch 정적 적용과 실제 빌드의 차이 | 문자열 삽입에 성공해도 TypeScript/API shape/React hook 제약이 보장되지 않음 | 기계적 패치 성공을 통합 완료로 보지 않음. typecheck·macOS 실제 흐름 확인 |
| G17 | 시차·재진입·호스트 재시작·다중 창 | UI, bridge, session host, JSONL, Git이 별개 프로세스/영속 저장 | 정확한 재시도·중복 방지·부분 성공 복구 계약 필요 |
| G18 | Repo/Host/Worktree path만으로 접근 검증 | 현재 `scripts/orca-native-bridge.mjs`는 프로젝트 root를 비교하지만 모든 작업의 host/session 소유권까지 검증하는 것은 아님 | 호스트 ID·workspace ID·provider session ID를 모두 확인. 다른 머신 파일을 로컬 파일 경로로 열지 않음 |
| G19 | 단계 사이의 go/no-go 없이 기능 추가 | 현재 P0~P6 분류만으로는 잘못된 상태에 P2/P3 진행 가능 | **각 단계 진입/이탈 게이트**와 blocking defect를 추가 |
| G20 | 기존 기능 보존의 검증 범위 부족 | Orca에는 compact/full Agent 목록, Worktree 메뉴/단축키, history, 가상 목록, 모바일/원격 경계가 있음 | 원본 동작 회귀 매트릭스 유지; 새 역할 전용 UI 추가 전 영향 확인 |

### A-2. 특히 우선순위가 높은 현재 코드 결함/위험

아래 항목은 **“설계가 완성되어 구현만 하면 된다”**고 간주할 수 없는 이유다. 발견한 코드 사실과 미검증을 구분한다.

**R1 — 실제 활성 Main leaf 전달 누락 (Blocking, 코드 확인).**

`src/orca/agent-sessions.mjs`의 `prepare({activeLeafId})`와 `prepareForMain({activeLeafId})`는 받는 인자를 Fork 코드로 보낸다. 그러나 `scripts/orca-native-bridge.mjs`가 `prepareForMain`에 넘기는 인자에는 활성 leaf 획득/전달 경로가 없다. `captureCompletedMain`은 분기가 하나이면 fallback하지만, 활성 분기가 여러 개인 경우 정확한 Fork를 보증하지 못한다.

**처리:** Pi의 `get_entries.leafId`가 존재함은 확인됐다. **Orca의 특정 호스트 Native Chat이 가진 현재 Pi RPC 프로세스에 어떻게 안전하게 접근할지**를 먼저 소스 조사한다. `SessionManager.open(savedFile)`에서 leaf를 추정하거나 마지막 JSONL ID로 대신해서는 안 된다.

**R2 — Git 작업 공간을 Orca 밖에서 만들고 나중에 검색 (Blocking, 코드 확인).**

`agent-sessions.mjs`는 `git worktree add -b`로 별도 checkout을 만들고, `PiComposeMenu.tsx`는 그 경로와 같은 Orca Worktree가 있는지 `fetchAllWorktrees` 뒤에 찾는다. 이는 Orca가 생성 요청 자체의 책임을 소유하는 방식과 다르다. Git 생성 성공/Orca 등록 실패 시 고아 Worktree가 남을 수 있다.

**처리:** Orca `createManagedWorktree`와 `agentLaunchWorkspaceFactory`의 실제 계약, 별도 create 요청의 재시도 ID와 자동 startup 옵션을 확인하고 **Orca 생성 → 결과 영수증 → Pi Fork** 순으로 교체한다.

**R3 — Work “목록에서 제거”가 의미하는 위치가 서로 다름 (현재 기능 차이, 코드 확인).**

- Pi Compose `setWorkMainVisibility`는 `hiddenFromMainAt`만 바꾼다.
- Orca의 실제 Agent 행은 해당 Worktree에 계속 있을 수 있다.
- native `×`는 기본적으로 Orca의 Agent status/retained 표시만 dismiss한다. 원본 Pi/Orca session이나 Main relation 삭제가 아니다.
- 합성 `subagent`의 숨김은 renderer-session cache라 재시작하면 다시 나타날 수 있다.

**처리:** 선택한 Work 하나를 없애도 Main/다른 Work/코드가 보존돼야 한다는 정책은 확정. **“Main 연결 표시 숨김”과 “현재 Agent activity 숨김”**을 사용자에게 동일한 삭제처럼 보여주지 않는다. 일관된 메뉴 라벨·복구 위치·재시작 동작까지 P2에서 확인한다.

**R4 — 현재 Lineage adapter의 범위/무효화 누락 가능성 (검증 필요).**

`usePiComposeNativeLineage`는 Worktree별 `unifiedTabsByWorktree`, `agents.length`, Compose records를 참조한다. Agent가 바뀌어도 수가 같거나 Tab이 달라질 때, 이벤트가 지연될 때, Main이 다른 Worktree에 있을 때 실제 부모 연결이 정확히 갱신되는지 미확인이다. `applyAgentRowLineage`와 `buildAgentRowLineageTree`를 함께 적용하는 현재 overlay가 native depth, child counts, collapse, 포커스에 회귀를 만드는지도 확인해야 한다.

**처리:** 관계가 변경되는 실제 이벤트를 기준으로 갱신. 매 렌더마다 레코드 fetch/중복 UI 생성 금지. 오류 시 Orca 기본 행으로 안전하게 fallback.

**R5 — Host 결과를 Main에 표시하기 위한 확장점 미확정 (Blocking for P3).**

Orca `NativeChatWorkingStatus`/`NativeChatToolRun`/`NativeChatSubagentRun`은 이미 펼침 UI를 구현했지만, 별도 Pi Work의 이력을 Main의 가상 transcript에 연결하는 공식 slot은 아직 검증되지 않았다. **기존 UI가 있으므로 서로 다른 Session도 자동으로 보인다고 단정할 수 없다.**

**처리:** `agentSession.history`, transcript projection, slot key, virtualization, disclosure state를 읽고 원본 ID를 잃지 않는 **read-only external-work reference slot** 최소 변경안을 제시한 후 구현.

**R6 — 프로젝트 보존 정책과 삭제 시 실제 결과 불명확 (Blocking for destructive action).**

Main Pi JSONL은 Worktree 삭제 후에도 보존되어야 한다. Orca 원본 Worktree Delete는 Git checkout을 없앨 수 있고, Orca `agentSession.close`는 provider/in-memory를 닫되 record/journal은 보존하도록 구현돼 있다. 둘은 다른 명령이다. **삭제 메뉴를 단순한 Work 목록 숨김과 합치지 않는다.**

**R7 — native 연결은 세션 단위·호스트 단위 검증이 필요 (Blocking for remote).**

현재 bridge가 확인하는 Git root는 프로젝트 소속 검사일 뿐, **호스트 실행 권한·파일 접근 권한·중복 writer 배제**의 완성된 계약이 아니다. 원격/WSL/다중 Orca 창에서는 같은 path의 의미도 다를 수 있다. Host provider identity가 다르면 자동 연결하지 않는다.

### A-3. 실제 end-to-end 호출 흐름 — 목표/현황 비교

#### 생성: 현재 코드(확인)

```text
사용자 Work 생성
  PiComposeMenu.onLaunch
    -> window.api.piCompose.create('work', { cwd, mainId, workspace, title })
    -> Electron IPC (pi-compose:execute)
    -> scripts/orca-native-bridge.mjs
    -> OrcaAgentStore.prepareForMain(...)
    -> captureCompletedMain(sessionFile, sessionId, activeLeafId?)
    -> [workspace=worktree] execFileSync('git', ['worktree','add', ...])
    -> forkCompletedMain / SessionManager.forkFrom(snapshot, cwd, ...)
    -> OrcaAgentStore.put(record)
    <- record / proof
    -> [workspace=worktree] Orca fetchAllWorktrees + path lookup
    -> openPreparedPiNativeChat(...)
    -> PiCompose attach-chat (Orca session ID 기록)
    -> Orca agentSession.rename(...)
    -> native Agent rows
```

**이 흐름의 구멍:** Pi leaf 조회/전달 누락, Orca가 생성 책임을 소유하지 않음, Git 성공 후 Pi 실패, Orca 세션 채택 실패, 네이티브 이름 저장 실패, 중간 단계 재시작. 현재 UI가 `preparedId`를 보유하는 것만으로 영구 복구나 안전한 재시도가 보장되지 않는다.

#### 생성: 목표 호출 흐름(설계 — 계약 검증 필요)

```text
사용자 Main/Work/Support 생성
  1) 실제 Orca worktree + provider/Orca session/host 확인
  2) role, 선택된 Main, 실행 공간 선택의 ID 유효성 검증
  3) Work인 경우 활성 Pi branch leaf 조회 + 완료 지점/원본 스냅샷 고정
  4) isolated인 경우 Orca managed worktree create (기존 API)
  5) 영수증으로 새 worktree ID, 실제 path, base SHA 확인
  6) Work: Pi SDK forkFrom(검증된 완료 branch) / Support: 독립 SessionManager
  7) Pi session ID/파일과 Fork provenance를 안정적으로 기록
  8) Orca structured Agent Session의 기존 create/ensure/reveal로 채택
  9) Orca host-owned name, actual Agent row/status/owner 연결
 10) 관계 인덱스 갱신; 후속 Main 결과 참조에 활용
 (어느 단계 실패하든 생성 자산을 숨기거나 임의 삭제하지 않고 재개/복구)
```

**실행 게이트:** 3의 활성 leaf 공급과 4의 Orca managed creation 호스트 계약이 증명되지 않으면 5~10을 프로덕트 완료로 선언하지 않는다.

### A-4. 생성 단계별 부분 성공/복구 매트릭스 (P0/P1 필수)

| 마지막 확인 단계 | 실제 남은 자산 | 표시할 상태/복구 동작 | 금지 행동 |
| --- | --- | --- | --- |
| 사용자 입력 검사 실패 | 없음 | UI 필드 오류, 그대로 수정 | 유령 Pi 세션 생성 |
| Main leaf 읽기 실패 | Main 원본만 | 근거 있는 실패 안내, 다시 시도 | 마지막 append 행 추정 |
| Main 완료 응답 없음 | Main 원본만 | 먼저 Main에 설계·완료 응답 저장 | 임의 빈 Fork 생성 |
| Worktree 생성 요청 실패 | Orca가 보고한 성공/실패 확인 필요 | 기존 Orca 결과/영수증 사용 | Git 상태 추측·중복 생성 |
| Worktree 생성 성공, Pi Fork 실패 | 새 managed Worktree 있음 | “작업 공간 준비됨, Pi 대화는 아직 없음” + 복구 | 자동 Git 삭제·Fork 성공 표시 |
| Pi Fork 성공, 레코드 기록 실패 | 새 Pi 파일 및 Worktree 가능 | 실제 파일/ID로 복구 대상 식별, 원본 보존 | 같은 요청 재실행해 또 Fork |
| Pi Fork/레코드 성공, Native Chat 연결 실패 | Work Pi 세션 준비됨 | Orca session 조회 후 동일 Pi 기록 재채택 | 새로운 Pi provider ID 자동 발급 |
| Orca Chat 생성 성공, attach 기록 실패 | 이미 열린 Chat + Pi 파일 | Orca 실제 session ID 재확인 후 연결만 복구 | 새 Chat/새 Pi 파일 무조건 생성 |
| rename 실패 | 실제 Chat과 Pi 원본 있음 | 생성 성공, 이름 보완 가능 상태 | 원본 기록 삭제/연결 롤백 |
| 원격 host 응답 불확실 | 상태 불명 | host ID + creation ID로 재조회/재개 | “실패”라고 단정하고 두 번째 생성 |
| 앱 강제 종료/재시작 | 일부 단계가 영속 완료됐을 수 있음 | 자산 inventory 읽기 및 단계별 재개 | 초기화/전량 cleanup |
| 동일 버튼 연속 클릭 | 하나의 사용자 생성 의도 | 동일 operation ID에 동일 결과 반환 | 중복 Worktree/세션/브랜치 생성 |

**필수 구현 계약:** API가 원자적으로 실행할 수 없는 작업이라면 **단계별 기록/creation ID/idempotency key**를 사용한다. 전역 트랜잭션을 흉내 내지 않는다. UI retry는 반드시 같은 생성 의도인지 먼저 확인한다.

### A-5. Session & Context 정합성 스냅샷 계약

정확한 Fork를 검증할 때 최소한 아래를 **같은 원본 기준 시점**에서 기록한다.

```ts
type ForkEvidence = {
  source: {
    piSessionId: string;
    sessionFile: string;
    activeLeafId: string;        // Pi의 실제 활성 leaf
    completedEntryId: string;   // 선택한 branch의 마지막 완료 응답
    entryIds: string[];         // root -> completedEntryId의 계보
    readingGeneration?: string; // 동일 상태 재조회 검증용, 계약 확인 필요
  };
  target: {
    piSessionId: string;
    sessionFile: string;
    cwd: string;
    orcaWorktreeId?: string;
  };
  verification: {
    copiedCount: number;
    expectedCount: number;
    identicalEntryChain: boolean;
    originalUntouched: boolean;
    excludedInProgress: boolean;
  };
};
```

이는 **검증 항목 목록**이지 SDK가 이 필드 전부를 바로 반환한다는 뜻이 아니다. 특히 `readingGeneration`은 제공되는지 조사 후 채택한다.

- **활성 분기:** Pi `SessionManager.getLeafId` 또는 RPC `get_entries.leafId`가 실제 live Main을 대표한다는 경로까지 확인.
- **완료 지점:** assistant `stopReason='stop'`/`endTurn`와 Pi SDK의 실제 turn 완료 시점이 일치하는지 확인. `message`가 아닌 branch entry(Compaction, Model Change, custom entry)는 보존 여부를 검토.
- **실행 중 Main:** 읽기→Fork 사이 Main이 계속 append할 수 있다. Fork 기준을 **읽어 고정한 leaf와 완료 응답 ID**로 명시하고 변화를 조용히 섞지 않는다.
- **복제 검증:** 목표 파일 헤더만이 아니라 원본 branch entry ID/parent ID/내용을 비교한다. Pi의 context 구성 중 `AGENTS.md`/system prompt/Extension 설정은 cwd에 따라 바뀌므로 “모든 미래 모델 입력이 byte-identical”하다고 주장하지 않는다.
- **기록 보존:** Main 파일은 쓰기/수정/복원 금지. 새 Work 파일로만 writer를 시작.
- **Compaction/마이그레이션:** 이전 Compaction summary가 활성 branch에 있으면 정상적으로 복사돼야 한다. 분기 밖의 abandon history를 자동 포함하지 않는다.
- **검증 실패:** UI에 ‘Fork 준비됨’을 표시하지 않는다. 실패 원인·원본 ID·복구 가능한 자산만 기록한다.

### A-6. Native Agent 행 표시와 실제 제거의 상태표

**Orca 소스:** `DashboardAgentRowTrailingControls.tsx`의 `hideDismiss`/`onDismiss`, `WorktreeCardAgents.tsx`의 `dropAgentStatus`/`dismissRetainedAgent`, `worktree-card-agents-expansion-state.ts`. 

| 사용자 동작 | Orca 실제 상태/표시 | Pi 대화 기록 | Main-Work 의미적 관계 |
| --- | --- | --- | --- |
| Work 행 선택 | 올바른 Orca tab/pane 활성화 | 유지 | 유지 |
| Activity row의 `×` | 해당 row/status 표시를 제거 | 유지 | 유지(별도 명시 없으면) |
| Main의 `연결된 Work 관리 → 목록에서 제거` | Main 관점에서 관계 표시 숨김 | 유지 | `hiddenFromMainAt`로 숨김 기록 |
| 숨긴 Work 다시 표시 | 관계 표시 복구 | 유지 | 부모/자식 관계 그대로 |
| Chat 탭 닫기 | 탭 숨김/호스트 Close 정책 확인 | 별도 삭제 명령이 없다면 보존 대상 | 유지 |
| Agent 실행 정지 | 현재 실행/턴에 대한 Orca stop/cancel | 기존 기록 보존 | 유지 |
| Worktree 삭제 | Orca Git Worktree 수명주기 | **Main Pi 세션 원본 보호 필수** | 관련 레코드는 고아 상태/재개 정책 필요 |
| Pi 세션 기록 실제 삭제 | 별도 파괴적 동작 | 삭제 위험 | 관계 orphan 재처리 |

**현재 제품 미완성:** Activity `×`와 `hiddenFromMainAt`가 반드시 같은 화면 결과를 만드는 것은 아니다. 이 문제는 “개별 제거 기능 완료”로 보지 않고 **같은 사용자가 어느 위치에서 제거했는지와 결과가 같은지**를 실제 UI로 비교한 뒤 통일한다. 부모 집합의 모든 자식이 사라지지 않는 것도 확인해야 한다. 

**원칙:** native Agent 상태 삭제와 relation 숨김을 무리하게 결합해 Orca의 `dropAgentStatus`를 호출하지 않는다. 역할 데이터의 숨김이 언제 무엇을 숨겨야 하는지 사용자에게 설명한 다음, 기존 메뉴/행 연결 최소 변경을 선택한다.

### A-7. Main/Work/Support/Worktree 상태의 진실표

| 사실 | 가능한 표현 | 데이터 정본 |
| --- | --- | --- |
| Pi 레코드만 작성 | “대화 준비 중/등록됨” | Compose workflow metadata |
| Pi Fork 검증 완료, Orca Chat 연결 전 | “Pi Fork 준비됨, Chat 연결 필요” | Pi 파일 + Fork evidence |
| Orca Chat 열린 상태에서 실제 생성 요청 처리 중 | “실행 중” | Orca Agent host |
| Orca가 사용자 응답을 기다림 | “확인 대기/입력 필요” | Orca Agent host |
| Orca 턴 정상 종료 | “응답 종료” | Orca journal/turn lifecycle |
| Work가 “구현 완료”라고 보고 | “구현 완료를 보고했습니다” | 원본 Work assistant turn (검증된 텍스트) |
| 사용자가 구현 검토 승인 | “사용자 확인 완료” (별도 정책이 있다면) | 실제 사용자 행동 |
| Host 연결 불명 | “상태 확인 불가” | Orca host/network |
| 앱 닫음 / 오프라인 | “실행 상태 확인 불가, 기록은 보존될 수 있음” | history vs host 상태 구분 |
| Git Worktree 삭제됨 | “실행 공간 없음/재연결 필요” | Orca Worktree + Git 정보 |

**금지:** `state='ready'`를 실행 중으로 표시, timer elapsed만으로 “작업 완료” 판단, 미검증 assistant 문장을 제품 검증 완료로 표시.

### A-8. Work 결과 보고 계약 — Main 접기 UI 상세

**결과 발생 주체**
- **보고 생성:** Work가 실제 assistant 응답으로 남긴 텍스트.
- **결과 감지:** Orca host의 작업 턴/Journaling 또는 기존 Activity 이벤트.
- **전달 주소:** 검증된 Main Orca session ID와 Work Orca session ID의 *관계*, Work의 고유 turn ID.
- **결과 표시:** Main의 Native Chat 화면에 읽기 전용 참조. Main Pi JSONL에 새 사용자/assistant 메시지를 만들지 않는다.
- **상세 열기:** 원본 Work history와 Orca의 native transcript rendering 구성 요소를 사용한다. 닫는다고 작업/세션이 종료되지 않는다.

**반복/동시성**
1. Work가 같은 턴을 여러 번 publish해도 `(workOrcaSessionId, turnId)`는 한 번만 표시.
2. Work가 구현 뒤 두 번 수정하면 두 종료 턴은 **각각의 출처·시각·결과**를 가질 수 있다. 최신 결과 하나로 덮어쓰지 않는다.
3. 출처 Work를 숨겨도 과거 결과 참조를 지우거나 거짓으로 완료 상태를 변경하지 않는다. **보일지/숨길지는 별도 UX 정책 결정**.
4. Main 화면이 닫혀 있는 동안 Work가 완료되더라도 다음 열기에서 host history로 복구 가능한지 검증.
5. 외부 Work 호스트가 꺼져 있을 때 마지막 알고 있던 완료와 현재 연결 불가를 구분한다.
6. Work의 명령/파일 읽기/추론 가운데 host journal에 실제 없는 기록을 꾸며내지 않는다. Reasoning은 provider가 출력/보관·권한 허용한 범위만 보여준다.
7. 원본 파일의 최신 Git 상태를 과거 Work 턴의 변경 증거인 양 표시하지 않는다. 당시 Git HEAD/Worktree/시각이 기록돼 있을 때만 대응시킨다.

**추가로 검증할 Orca 원본 코드**
- `agentSession.history` / `agentSession.subscribe`와 응답의 cursor/paging/role/session ownership.
- `NativeChatMessageList.tsx` / `use-native-chat-transcript-slots.ts` / `NativeChatTranscriptRow.tsx`의 slot identity, virtualizer 위치, 펼침/접힘 state.
- `NativeChatSubagentRun.tsx`는 native 하위 실행 UI지만, 별도 Fork Pi session을 자동으로 서브에이전트라고 해석할 수 없다.

**Main 모델이 답할 수 있게 하는 최소 조회 후보**
```ts
// 설명용 계약 후보. 실제 Pi registerTool 인터페이스는 v1.4.0과 연결해야 한다.
type ReadLinkedWorkResult = (args: {
  workId: string;
  turnId?: string;
  detail?: 'report' | 'tools';
}) => {
  sourceWorkPiSessionId: string;
  sourceWorkOrcaSessionId: string;
  turnId: string;
  content: string;
  observedAt: string;
};
```

- 도구 등록은 **실제 Pi Main 세션의 Extension tool 경로**를 우선 검토하고, model이 권한 없는 Work/다른 프로젝트를 열 수 없게 한다.
- 모델 호출 시 필요한 근거만 반환. 모든 Work logs의 자동 컨텍스트 주입 금지.
- 결과 길이 제한/큰 로그 쪽 나누기/민감한 데이터 노출 방지는 기존 Orca/Pi 모델 권한 내에서 처리.
- 사용자 요청 없이 실제 Work 입력/세션 수정/명령 실행하는 Tool은 만들지 않는다.

### A-9. Support → Work 초안 전달: 상세 실패 매트릭스

| 조건 | 사용자가 보게 되는 행동 | 보존 대상 |
| --- | --- | --- |
| Work 한 개, 초안 비어 있음 | 대상 Work의 미전송 입력에 결과 제안 | 원본 Support 결과 |
| Work 여럿 | 대상 선택 후 입력 초안에 추가 | 대상의 원래 내용 |
| Work 이미 작성 중 | 기존 문장을 지우지 않고 내용 병합/검토 가능 | 텍스트·이미지·첨부·커서/사용자 입력 |
| Work 다른 Worktree | 실제 Orca session/host 확인 후 해당 Chat 열기 | 다른 Worktree 실행 소속 |
| Work host 불명/닫힘 | 성공을 선언하지 않고 복구/복사 경로 안내 | 지원 세션 원본 |
| 초안 저장 실패 | “저장되지 않음” 안내, 다시 시도 | 기존 초안·결과 |
| 초안 추가 중 늦은 hydration | Orca draft store의 기존 replay-safe append 사용 | 늦게 복원된 원래 초안 |
| 사용자가 두 번 클릭 | 중복 문구 삽입 방지 (새 delivery ID의 정책 검토) | 내용 중복 방지 |
| Work가 동시에 다른 창에서 입력 | Orca의 기존 draft broadcast/ownership 계약 따라 충돌 안내 | 사용자 작성 중 내용 |
| 결과 12,000자 초과 | 현재 `supportResult`가 `text.slice(0,12000)`와 `truncated`를 반환함을 표시 | 전문은 원본 Support 기록에서 확인 |

**호출 금지:** `agentSession.send` / `agent-message-send.ts`는 **즉시 전송 경로**이므로 “Work에 보내기”의 기본 구현에 사용하지 않는다. 결과는 Work의 실제 초안에 저장된 뒤 사용자가 제출한다.

### A-10. Pi Extension 지원 정책의 정확한 구분

Pi v1.4.0 `docs/extensions.md`는 `ctx.hasUI`가 TUI와 일부 RPC UI 모두에서 의미가 있고, **RPC Extension UI가 지원하는 dialog/notification은 전달 가능**, **custom terminal component는 RPC에서 제공되지 않음**이라고 설명한다. 따라서:

| 구분 | 기대 처리 | 검증 |
| --- | --- | --- |
| Model-callable Extension tool | Pi runtime에 등록되는 그대로 유지 | Native Chat Pi provider가 실제 도구 목록/호출 노출하는지 |
| Session lifecycle/변경 이벤트 | Pi SDK 자체의 이벤트 사용 | Fork 후 동일 Extension 재로딩 여부 |
| `ctx.ui.input` / `ctx.ui.select` | RPC UI에서 지원 가능한 프로토콜인지 실제 host 검사 | Orca Native Chat Pi adapter에서 실행해 볼 것 |
| terminal-only custom component | Native Chat에서 지원된다고 가정 금지 | Pi TUI 진입 경로 제공 여부 |
| slash command/shortcut | 각 모드의 실제 지원 수준 구분 | Native Chat·TUI 각각 테스트 |
| 사용자 설치 Extension, tool renderer | 원본 Extension 설정을 보존 | 복제된 cwd·config 경로 달라지는지 |
| Remote Pi host | 해당 host에 Extension/설정이 실제 설치돼 있는지 | 로컬 설정이 원격에 자동 적용된다고 주장 금지 |

**추가 설계:** Native Chat에서 Pi UI 기능이 일부 제한되는 경우 **사용자에게 정확히 알리고, 실제 원본 Pi 세션을 TUI에서 안전하게 열 수 있는지 검증**한다. 같은 세션을 동시에 두 writer가 열도록 하지 않는다.

### A-11. 운영/성능/안전성 경계

1. **대량 Agent:** Main 수십 개·Work/Support 다수에서도 `window.api.piCompose.list`를 Agent row 하나마다 RPC 호출하지 않도록 조회 단위를 정한다. Orca의 `worktree-agent-row-selectors.ts`는 Worktree별 인덱스를 캐시하며 이를 깨지 않는다.
2. **대량 transcript:** 오래된 Work 턴의 상세는 처음부터 전체 불러오기 대신 Orca history pagination·virtualization으로 읽는다. Main의 큰 설계 컨텍스트를 다시 계산하지 않는다.
3. **Race:** Work rename/reveal/dismiss/새 턴 완료/Worktree 삭제가 동시에 발생할 때 stale response가 최신 UI를 덮지 않도록 epoch/실제 session ID를 비교한다.
4. **데이터 민감성:** Work transcript에는 tool output·환경 변수·파일 내용이 포함될 수 있다. **사용자 화면에 읽기 허용된 원본 내용만 표시하고, Main 모델 도구 반환은 권한 확인 후 필요한 범위로 제한**한다. 별도 로그 복제 저장을 기본으로 하지 않는다.
5. **Host 경계:** 로컬/원격/WSL에서 파일 경로·Git repository ID·session ID 충돌을 검사한다. 다른 호스트의 Pi JSONL을 로컬 경로로 임의 열지 않는다.
6. **캐시:** 생성/삭제/Work 숨김/rename/탭 재열기 후 UI가 실제 정본을 반영해야 한다. 껐다 켜야 나타나는 값은 제품 완료가 아니다.
7. **접근성:** Orca 기존 Agent 행의 키보드 선택/메뉴/접기, Native Chat의 접근성, 가상 목록 스크롤 위치가 그대로 유지돼야 한다.
8. **오류 관측:** host/bridge/renderer 각 단계에서 **동일 operation ID**, 역할, 실제 Worktree ID, 실패 단계 정도만 식별 가능하게 로깅. 비밀번호·세션 전체 메시지·파일 내용을 진단 로그에 복제하지 않는다.
9. **버전 호환:** Orca pin 변경 시 API/patch manifest 비교가 먼저. `orca:prepare` 첫 실행/재실행/이전 패치에서 업그레이드/중단 복구 모두 확인. hash mismatch에는 overwrite 금지.
10. **중복 작업 금지:** Git Worktree 관리·Agent UI·터미널 탭/컨텍스트 메뉴·Native Chat transcript의 기존 Orca 기능을 Pi Compose 아래에 다시 만들지 않는다.

### A-12. 단계별 go/no-go, Blocking 조건 및 의존성

| 단계 | 시작 가능 조건 | 끝났다고 인정할 조건 | 실패하면 되돌아갈 곳 |
| --- | --- | --- | --- |
| **P0** | Pi SDK/Orca pin 확정, 기존 자산 읽기 보존 | 활성 leaf 실제 획득, 안정적인 ID/owner 매핑, 원본 Fork 증거와 실패 기준 | Pi 런타임/host bridge 계약 조사 |
| **P1** | P0 Fork 안전성 보장 | Orca managed worktree로만 생성, 동일 session 복원, 실패 후 재시도 안전 | Orca `createManagedWorktree` API·workflow |
| **P2** | P1 owner/Worktree ID 보장 | 같은/다른 Worktree에서 관계 표시·포커스·상태·개별 숨김이 정확 | native Worktree/Agent 행 owner 라우팅 |
| **P3** | P2 Work session 주소 확인, host history read 확인 | Main 화면에 실제 보고와 펼침, 중복 없음, Main 모델 자동 주입 없음 | native journal/slot 접근 조사 |
| **P4** | P2 대상 Work 확인, draft API 사용 가능 | Support 결과가 미전송 초안에 안전하게 저장되고 직접 전송 전 모델 메시지 0 | Orca draft owner/persistence |
| **P5** | 동일 Pi 세션 Native Chat/TUI 운영 계약 | 지원/미지원 Extension이 명확하고 데이터 오염 없음 | Pi RPC UI / 원본 Extension API |
| **P6** | 이전 단계별 실행 결과/데이터 inventory | 기존 작업 보존, 중복 코드 제거, Orca 주요 흐름 회귀 0, 앱 재시작 후 사용 가능 | 해당 원본 기능의 owner/contract |

**Blocking이면 동작을 우회하는 새 구현을 만들지 않는다.** 예: Orca가 현재 Pi의 활성 leaf를 노출하지 않는다는 결론이 나오면 직접 대화를 요약해 Work에게 보내는 식으로 “완료”하지 않는다. 필요한 host 확장 계약을 먼저 명시하고 구현 범위를 승인받는다.

### A-13. 실사용 검증 상세 시나리오 (CI/테스트 코드 작성 아님)

**기준 데이터:** 하나의 Git 프로젝트에 Main A(회원가입), Main B(결제); A의 Work 1(진짜 구현), Work 2(API 연동); Work 1의 Support 1(테스트); 다른 Worktree의 Support 2(코드 탐색). 가능하면 단일/다중 Pi branch와 이미 만들어진 레거시 record를 하나씩 준비한다.

| 번호 | 실제 사용자 조작 | 기대 결과 | 실패 증거 |
| --- | --- | --- | --- |
| U01 | Orca 기본 `+` / 단축키로 Worktree 생성 | 기존 UI/생성/상태 그대로 | 새로운 Compose 모달이 원본을 대체 |
| U02 | Worktree 우클릭으로 Pi Compose 생성 | 기존 메뉴 유지 + 역할 선택 진입 | 원본 메뉴/작동 사라짐 |
| U03 | 두 Main을 같은 Worktree에 생성 | 원본 세션 ID/대화 독립 | A/B 선택이 섞임 |
| U04 | Main A에서 다중 분기 만든 뒤 Work 1 생성 | 활성 완료 분기만 새 Pi 세션으로 복제 | 마지막 append 분기 복제 |
| U05 | Main A가 응답 중일 때 Work 생성 | 직전 완료 지점만 Fork, 제외 안내 | 진행 중 token/tool 포함 |
| U06 | Work 1 생성 직후 아무 메시지 안 보냄 | Work 대화만 준비, 모델 개발 시작 0 | 자동 생성 프롬프트 실행 |
| U07 | 같은 Worktree의 Work 1/Work 2 사용 | 별개 Pi session, Orca 상태/선택 각각 | 중복 하이라이트/세션 뒤바뀜 |
| U08 | 별도 Worktree로 Work 1 생성 | Orca managed Worktree·실제 Agent/삭제 메뉴·Git Diff 사용 | Git에만 있는 미등록 checkout |
| U09 | Work 1 종료/탭 닫기/재열기 | 각 동작의 뜻이 다르고 동일 Pi 원본 복원 | 새 Pi writer / 기록 사라짐 |
| U10 | Work 1만 숨김 | Main/Work 2/Support 1/미커밋 파일 보존 | 전체 그룹 사라짐/파일 삭제 |
| U11 | Work 1 복원 | 같은 Pi/Orca 원본, 관계 재확인 | 새 Fork/새 session 생성 |
| U12 | Main A 닫고 다시 열기 | Work 연결을 다시 찾음 | 활동 행 없어서 관계 실종 |
| U13 | Work 1을 별도 Worktree로 이동/연결 | Orca 실행 위치와 Main의 의미적 관계 모두 정확 | 가짜 parentPaneKey/잘못된 종료 대상 |
| U14 | Support 1 테스트와 Work 1 구현 동시 실행 | 독립 Pi context, 실제 Git 기준 확인 | Main 대화 자동 복제/시험 결과 오인 |
| U15 | Support에서 Work에 보내기 | 미전송 초안, 기존 입력·이미지 유지 | 즉시 Work 모델 실행 |
| U16 | Work 1 완료 보고 후 Main 보기 | Work가 실제 보고한 문구와 원본 턴 ID를 표시 | 응답 종료만으로 구현 완료 생성 |
| U17 | Main의 Work 항목 펼치기 | 명령·읽은 파일 등 원본 Orca 렌더러, Main 전환 없음 | 새 자체 로그 UI/자동 모델 주입 |
| U18 | Main에게 “Work에서 뭘 했어?” 질문 | 실제 조회 Tool로 확인하거나 접근 불가 명시 | 확인하지 않았는데 handoff 받았다고 주장 |
| U19 | Work 호스트 끊고 Main 열기 | 마지막 결과와 연결 불명 구분 | 최신 작업 상태를 지어냄 |
| U20 | App crash 이후 재실행 | 세션/레코드/Worktree 조회·재개 가능 | 중복 Work/자동 삭제 |
| U21 | 작업 중 생성/rename/attach 일부 실패 유도 | 중간 자산 보존·복구 버튼/절차 존재 | 자동 새 Fork 남발 |
| U22 | `orca:prepare` 2회 + 업그레이드 | 둘 다 성공, 변경된 Orca 파일은 fail closed | 패치 중복 적용/덮어쓰기 |
| U23 | Pi TUI 전용 Extension 사용 | 지원 여부 안내, 원본 세션 안전한 호환 경로 | Extension 기능 제거 |
| U24 | Git Worktree 삭제 시도 | Orca 원본 영향·경고, Main Pi 세션 보존 | 예기치 않은 사용자 파일 삭제 |

**실행 관측 자료:** 각 시나리오의 사용자 행동, 실제 Main/Work/Support ID(민감 정보는 축약), Orca host ID, 결과 화면, 실패 로그의 **이벤트명·원인**만 기록한다. 사용자의 전체 대화나 민감한 파일 내용을 진단 데이터에 넣지 않는다.

### A-14. 설계 결정 기록 양식 — 미확정 항목은 임의 구현 금지

| 결정 코드 | 사용자 관점 질문 | 확인해야 할 Orca 기존 기능 | 선택 전 필요한 근거 |
| --- | --- | --- | --- |
| D01 | 다른 Worktree의 Work를 Main 아래 **어느 위치에** 표시할까? | Worktree 카드/Agent Dashboard/Context menu/History | 기존 UI 보존량·포커스 대상·삭제 범위 |
| D02 | 목록 `×`로 숨긴 Work를 어디서 다시 찾을까? | Orca retained Agent/Session History | 같은 Worktree·다른 Worktree·앱 재시작 시 발견 가능성 |
| D03 | 현재 폴더/별도 Worktree 선택의 기본값은? | 원본 workspace creation preference | 코드 변경의 resource·충돌 위험·이해도 |
| D04 | 작업 공간 삭제 시 연결된 Pi 대화를 어떻게 재개할까? | Orca Delete/History/Session archive | 원본 파일 위치·보존 범위 |
| D05 | Work가 후속 수정한 결과를 Main에 어떻게 누적할까? | Native Chat turn list/Activity | 새 보고가 과거 결과를 덮지 않는 방식 |
| D06 | Main 모델이 Work 결과를 요청하면 어디까지 조회할까? | Orca host journal read, Pi registerTool | 컨텍스트 비용, 권한, 요구사항 변경 승인 경계 |
| D07 | Support의 별도 Worktree에서 Work의 미커밋 코드를 어떻게 검사할까? | Orca Git Diff/Worktree base | 자동 복제 금지·명시적 코드 기준 |
| D08 | 호스트가 다른 Work에 Support 결과 초안을 전달할까? | Native Chat draft owner/remote | 현재 호스트의 RPC와 접근 범위 |
| D09 | 별도 역할 아이콘/메뉴의 표현이 필요할까? | Orca AgentTypeIcon/StatusDot/기존 context menu | **기본값은 추가 안 함**. 구체적 결핍 증명 필요 |

*이 표를 변경하기 전에는 기존 사용자 합의 제품 결정 문서를 먼저 읽는다. 새로운 기본값을 임의로 확정하지 않는다.*

### A-15. 구현자의 실제 작업 단위 — Task별 산출물

다음은 “기능 하나 구현”보다 작은 단위로 나누어, 손실 없이 다음 세션으로 인계할 수 있게 한 작업 계약이다.

| 작업 ID | 구현/조사 대상 | 산출물과 완료 증거 |
| --- | --- | --- |
| T00 | 고정 Orca/Pi 버전과 코드 경로 일치 | 실제 파일 경로·함수·소유권 매트릭스 |
| T01 | Pi active leaf 조회 경로 | host 세션 ID → `get_entries.leafId`의 실제 연결 |
| T02 | 완료 branch Fork 안전성 | 한 Main에서 분기·실행 중 Fork 시 원본/새 세션 증명 |
| T03 | existing/empty Main 등록과 writer 충돌 | Main ID 채택·원본 보존 및 복구 흐름 |
| T04 | Orca managed Worktree 생성 경로 | 호출 인자·영수증·auto-start 방지·중간 실패표 |
| T05 | Work/Support shared/isolated 생성 연결 | 실제 Orca Worktree ID와 Pi targetCwd 일치 |
| T06 | Native session lifecycle 정리 | create/reveal/close/history/rename 원본 API 사용 |
| T07 | 레거시 record inventory | 기존 Pi/Orca/Worktree별 상태 목록, **변경 없음** |
| T08 | 같은 Worktree의 관계 투영 | 두 Main/여러 Work/Support, Native row 회귀 검증 |
| T09 | 교차 Worktree 관계의 사용성 설계 | 기존 Orca UX A/B 비교, 사용자 결정용 영향표 |
| T10 | 교차 Worktree read-only 링크 | 실제 원본 Agent를 정확히 활성화·관리 |
| T11 | 개별 행 제거·숨김·복구 정책 | 실제 메뉴와 보존/재시작 동작이 일관 |
| T12 | Main의 Work 결과 데이터 모델 | Work turn ID/보고/host history/idempotency |
| T13 | Native Chat 결과 projection | Main에 접는 결과 항목, 원본 renderer/scroll 유지 |
| T14 | Main 모델 on-demand read tool | 명시적 읽기 근거, 무단 실행/자동 전송 없음 |
| T15 | Support 결과/원본 코드 기준 | Worktree/브랜치/검사 시점 포함 |
| T16 | Support→Work draft append | 기존 초안/첨부/동시창·중복 클릭 보호 |
| T17 | Extension RPC/TUI 호환성 | Extension 기능별 실제 성공/미지원 표 |
| T18 | overlay patch 최소화·기존 데이터 migration | 반복 prepare, 실패/복구, 레거시 원본 보존 |
| T19 | 실사용 QA 전체 흐름 | U01~U24 결과, 실패 시 원인·수정 범위 |
| T20 | 중복 관리자/리스트 정리 | 없어지는 코드와 대체한 Orca 원본 API 명시 |

**각 T 단위의 완료 보고에 반드시 포함할 것:**
1. 이미 있던 Orca 기능의 정확한 이름·함수·파일.
2. 사용한 API와 추가한 필드 또는 입력·출력 계약.
3. Main 고품질 컨텍스트/정확한 Pi Fork/Extension 유연성을 어떻게 보존했는지.
4. 재사용하지 못했다면 왜 원본으로 부족했는지.
5. 파일/Worktree/세션 삭제·수정 범위와 실패 후 복구.
6. 정적 검증, 실제 실행 검증, 아직 미검증을 따로 표기.
7. 미확정 정책 및 사용자 결정 요청 여부.

---

**이 부록이 추가됐다고 모든 기술적 가능성이 증명된 것은 아니다.** 실제 호스트를 통한 활성 leaf 조회·cross-worktree Agent 참조·다른 Pi 세션의 Main transcript slot, 정확한 RPC Extension 지원은 여전히 **소스/실사용 검증 뒤 범위를 확정할 항목**이다. 이 사실을 숨기고 새로운 UI나 상태 관리자를 만들지 않는 것이 핵심 원칙이다.
