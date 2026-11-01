# Implementation Plan — Pi + Ghostty 재설계

- 기준: [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [TRD](TRD.md), 최신 UX 합의 2026-10-31
- 상태: **새 방향의 일부 기능을 Draft PR #15에서 구현 중**. 사용자 선택형 Handoff의 Pi Extension 연결 코드는 작성됐지만 실사용·통합 검증 전입니다. Ghostty Overview/Sidebar/Summary와 현재 레거시 실행 경로는 여전히 미구현/재설계 대상입니다. 이전 tmux/workmux/Orca Phase 0–6 계획은 현행 작업 순서가 아닙니다.
- 원칙: 사용자 검증을 위해 기능 구현과 별도로 테스트/CI/PR 병합을 자동 실행하지 않습니다. 이전 구현 코드와 사용자 세션·Worktree는 보존합니다.

## 1. 구현 목표

**Main에서 설계·의사결정 → 현재 Agent 또는 같은 프로덕트의 선택한 Pi 세션을 정확히 Fork해 Work에서 개발 → 필요할 때 독립 Support 위임 → Work 결과 Summary 확인 → 사용자가 필요한 결정만 Main에 반영**하는 흐름을 Pi와 Ghostty만으로 사용할 수 있게 합니다.

기능을 얻기 위해 Pi 런타임·Extension·Git 관리자를 다시 만들지 않습니다. 재사용 기능과 실제 공백을 먼저 확인합니다.

## 2. 진행 방식과 구현 범위

**사용자가 확정한 순서: 기술 조사 → 확정된 기능 일괄 구현 → 사용자 실사용 검증 → 관찰된 문제 개선.**

아래 행들은 단계마다 사용자에게 테스트를 요구하는 구현 순서가 아니라, **한 번의 구현 배치에 포함할 기능 영역**입니다. 독립성이 확인되는 부분은 병렬 구현할 수 있지만 Main 컨텍스트/Fork 계약을 흐리게 만들지 않습니다. 기능마다 테스트·검증·승인을 반복하는 게이트를 만들지 않습니다. 기존 세션·Worktree·설치 자산을 무단 정리하지 않습니다.

### 구현 전 기술 조사

1. **Pi:** Main/Work/Support의 활성 완료 분기 Fork·독립 세션·Compaction, **`>w`/`>s`/`>>w`/`>>s`의 `input` 이벤트 사전 처리**, **`>w @`·`>>w @` 세션 자동완성**과 기존 Pi `@` 파일 참조 보존, 같은 프로덕트 세션 목록·최근 활동 근거·고유 세션 ID/완료 leaf 식별, 최초 지시 원문 전송 및 직접 위임 원본 모델 대화 미기록, `agent_settled`/Tool/UI Prompt 이벤트, **새 지시 없이 입력 대기로 세션 복원**하는 방법 및 정상/비정상 종료 감지. **별도 키보드 단축키는 추가하지 않음.**
2. **Git/Workspace:** **`>` 명령 입력 Agent의 cwd 공유**, **`>>` 명령 입력 Agent의 현재 브랜치 HEAD 기준 독립 Worktree/브랜치 생성**, 미커밋 파일 비복사 안내, 다른 Worktree 세션을 `@`로 선택해도 입력 Agent의 Workspace 기준 유지, Git detached HEAD·브랜치명 충돌·동시 생성·생성 실패 안전 처리.
3. **Ghostty(macOS):** Overview 관리 TUI와 실제 Surface Split, Surface ID/TTY/Pi 프로세스 매핑, 새 Agent의 마지막 생성 순서 Split 배치와 포커스 유지, Ghostty 수동 드래그 Tab 왕복, 실제 Surface에 Summary Overlay 표시, Split 공간 부족·Resize/Zoom, 직접 닫기와 종료 상태, `pic` 내부 최소화/숨김의 실제 수명.
4. **요약·상태:** 사실 이벤트 수집→의미 변화 판단→경량 요약 생성(비용·속도·오인식 방지), 포커스 아웃 30초 타이머와 비포커스 응답 종료 즉시 표시, Shared Directory Git 귀속 제한, 명시적 사용자 선택 대기 감지.
5. **통신:** `pi-intercom` 현재 기능과 사용자 지정 대상 전송, 수신 Work의 **현재 턴 종료 후** 반영, 발신/수신/실패/확인 상태. 원래 사용자의 Main 모델 컨텍스트를 자동 오염시키지 않는 방법.

실제 Ghostty/Pi 제약으로 핵심 동작이 불가능하다면, 별도 멀티플렉서·미러링·가짜 Pi TUI 등으로 **조용히 대체하지 않고 차이와 영향을 보고**합니다. 다음 표의 '검증 대상'은 실사용 성공을 선언한 것이 아닙니다.

### 일괄 구현할 기능 영역

| 영역 | 필요한 결과 | 계약·주의점 |
| --- | --- | --- |
| **기존 자산 보존** | 현재 세션·Worktree·브랜치와 기존 구현의 안전한 정리 범위 식별 | Orca/tmux/workmux에 다시 의존하지 않으며 사용자 데이터 무단 삭제 금지 |
| **Overview·탐색** | Overview 전용 Sidebar, 프로덕트별 여러 Main/전체 Agent/메시지 보기, 기존 Agent 클릭 시 실제 Surface 포커스 | **계층/순서 유지**. 상태에 따른 자동 재정렬 금지. Main 이름에 `Main ·` 접두어 불필요 |
| **Agent 생성·위임** | Main·Work·Support의 Pi 기본 입력에서 **`>w`, `>s`, `>>w`, `>>s`**, 일반 자연어 위임, 현재/`@` 선택 Pi 세션의 정확한 완료 지점 Work Fork와 독립 Support, 지시 원문 전달 | **입력한 Agent 모델 대화에 직접 위임 기록 없음**. 역할·계층 깊이 임의 제한 없음. 일반 자연어는 입력한 Agent 대화에 남을 수 있음. 기존 키 변경 제외; Pi·IME 호환성 검증 |
| **세션 검색·Workspace** | `>w @`·`>>w @`에서 **현재 프로덕트 세션만** 이름+최근 작업+Workspace 정보로 자동완성. `>`는 호출 Agent cwd 공유, `>>`는 호출 Agent 브랜치 HEAD에서 새 Worktree 생성 | 실행 중·종료된 세션 포함, 실제 Pi 세션 ID 식별. 다른 프로덕트 제외, 일반 Pi `@` 기능 보존, 미커밋 파일 자동 복사 없음. 마지막 선택 기억·Workspace 선택창·자동 Git 통합 없음 |
| **Surface·화면 배치** | 생성 순서대로 새 Ghostty Split 추가, 포커스 유지, Sidebar로 위치 탐색, 수동 Tab 드래그 왕복, Resize/Zoom | Agent 수 인위적 제한·완료에 따른 이동/닫기 없음; 공간 부족이면 실패를 알리고 무단 정리 금지. 동일 Pi 프로세스 유지 |
| **상태·Summary** | Sidebar 상태만 간결 표시, 비포커스 30초 또는 응답 종료 즉시 Summary Overlay, 포커스 시 즉시 Pi TUI | 현재 하는 일/결과/필요한 결정 한 줄 + 근거 1~2개; 경량 모델의 근거·비용 제한. 추측 진행률/성공 판정 금지 |
| **Agent 실행 수명** | Pi `Esc` 중단, 개별 Agent 종료, 정상/비정상 종료 반영, 종료된 Agent 행 클릭 즉시 같은 Pi 세션을 **입력 대기로 복원**, 종료된 Agent만 Compose 목록에서 제거 | 실행 중 종료 확인, 유휴 종료 바로 처리. **작업 재개는 사용자 새 지시 이후에만** 실행. Pi 세션/Git 보존, 재-Fork·이전 지시·실패 명령 자동 재실행 금지 |
| **`pic` 수명·복구** | 내부 종료에서 백그라운드 유지/실행 Agent 종료 선택, 완전 종료 후 Main 명시 선택·Main만 재개, **생성 실패 Agent를 Sidebar에 유지** | Cmd+Q/일반 창 닫기 가로채지 않음. 새 Work/Support 자동 시작 금지. **중복 생성·자동 재시도·Sidebar 복구 버튼 제외**; 가능한 오류 정보는 기존 Overview/터미널에 표시 |
| **프로젝트 문서** | 승인한 중요한 결정만 기존 docs에 바로 기록, 사용자 요청 시 선택적 문서 조회 | 신규 문서 사전 확인, 계약 중복·자동 감시 DB 금지. Work 문서 갱신 권한은 미확정 |
| **Summary 공유·Handoff** | 중요한 결정 후보는 Summary에 표시, Main 명시 수신, Work→Work 수신자 선택 후 `pi-intercom` 전송, 메시지 Sidebar | 응답 중 Work는 **현재 턴 종료 후** 반영. 브로커 전송과 실제 수신/모델 반영 상태 구분. 범용 메시지 버스 금지 |

### Handoff 구현 진척 (2026-11-01)

| 항목 | 코드 상태 | 실제 실행 검증 |
| --- | --- | --- |
| Pi 1.4.0 원본 Session/Leaf/Entry 참조 | 기존 Pi API 사용 | 과거 실제 Fork 기록 검토; Compose Handoff 통합 전 |
| `/compose handoff` 사용자 선택형 전송 | **Draft PR #15 코드 작성** | 미검증 |
| pi-intercom Outbox 발송 및 결과 기록 | **Draft PR #15 코드 작성** | Compose 연결 미검증 |
| Pi 기록 기반 `/compose messages` 읽기 전용 메시지 조회 | **Draft PR #15 코드 작성** | 미검증; 최종 Sidebar 아님 |
| `human-first` 정상 턴 종료 후 전달 | pi-intercom 0.18.1 upstream 재사용 | 실제 Pi TUI 1회 관찰. 오류/중단 전체 미검증 |
| Summary Overlay 공유 후보와 연결 | 미구현 | 미검증 |
| 제품별 수신 Agent 식별·Overview 제어 연결 | 미구현 | 미검증 |
| 메시지 Sidebar 및 상태 표시 | 미구현 | 미검증 |
| Ghostty 1.3.1 AppleScript 실제 Terminal 조회·포커스(`/compose surfaces`) | **Draft PR #15 코드 작성** | macOS 실사용 검증 전; 실제 Agent 관계 미연결 |
| Ghostty 원본 Split 어댑터 | **Draft PR #15 코드 작성** | Agent 생성·Fork 흐름 미연결 |
| 명시적 Agent 관계(Fork 출처와 생성 요청자 분리) 읽기 모델 | **Draft PR #15 코드 작성** | 역할/프로덕트 관계를 기록하는 실행 경로 없음; UI 미연결 |
| 새 Pi 세션의 Launch Ticket·Identity 기록 | **Draft PR #15 코드 작성** | 실제 Ghostty에서 부모/자식 일치 확인 전 |
| 완료 Leaf 기준 Pi Native Work Fork | **Draft PR #15 코드 작성** | 실제 Fork 대상·원본 불변·Compaction 연결 검증 전 |
| Ghostty Terminal UUID와 자식 Pi ID의 정확한 연결 | **명시적 영수증 연결 함수 작성** | 영수증 발생/실제 Agent 실행 연결 전 |

**구현 완료(코드 기준):** Pi 원본 엔트리와 Compose Handoff custom entry를 읽기 전용으로 투영하는 기능을 `src/handoff-history.ts`에 분리하고 임시 `/compose messages`를 연결했습니다. **다음 구현:** 사용자 직접 위임이 실제 Ghostty Split을 시작한 뒤 Launch Ticket→새 Pi 세션 ID→Terminal UUID를 **검증된 생성 영수증으로** 연결하는 실행 경로가 우선입니다. Work의 선택 완료 분기 추출은 코드 작성됐지만 실제 Pi 실행 시작/원문 작업 지시 연결은 아직 없습니다. 그 근거를 이용해 Overview TUI의 프로덕트/Agent/메시지 뷰와 실제 Summary 공유 후보 선택을 구성하고, 기존 Handoff 전송/조회 기능을 연결합니다. 기록이 없는 세션을 역할이나 프로덕트로 추측하지 않습니다. 기능별 실사용·타입 검증은 사용자가 진행합니다. 모델 읽음/정책 승인/검증 성공을 추정하거나 자동 재전송·새 Broker를 만들지 않습니다. 제품이 아직 없는 UI를 구현 완료로 표시하지 않습니다.

### Native 실행 연결 진척 — 2026-11-01

| 항목 | 코드 | 검증/현재 제약 |
| --- | --- | --- |
| Pi `input` 직접 위임 명령 선처리 | `extensions/direct-delegation.ts` 작성 | `>w`/`>s`만 준비; 실제 Overview ID 없으면 원문 복원 |
| 진행 중 응답/명령 실패 시 원문 보존 | `handled`·`setEditorText()` 코드 작성 | 실제 Pi TUI 검증 전 |
| 완료한 Work leaf 복제와 Support ID 생성 | Native Pi API 연결 코드 작성 | 실행/원본 불변 검증 전 |
| Ghostty Split 발행·반환 UUID 확보·기존 포커스 복원 | `src/native-agent-launch.ts` 작성 | Ghostty 1.3.1 macOS 통합 검증 전 |
| 자식 Pi 시작·초기 작업 지시 원문 | 일회성 Ticket + `bin/native-agent-entry.mjs` 작성 | 실제 Pi readiness·지시 전달 검증 전 |
| 자식 세션 identity/Terminal binding | `extensions/agent-identity.ts` 연결 | 실제 부모-자식-UUID 검증 전 |
| `pic` 전용 Overview TUI·관리 Terminal ID | **미구현** | **현재 Native 직접 위임 실행 불가** |
| `>>w`/`>>s` Worktree, `>w @세션` | **미구현** | 임의로 cwd 실행/최근 세션 사용하지 않음 |

**다음 우선 작업:** 기존 `pic`을 실제 전용 Overview 관리 TUI 진입으로 전환하고, 그 관리 Terminal의 정확한 Ghostty UUID를 각 Agent에 전달하는 방식을 구현합니다. 이후 위 Native 실행 경로를 연결해 사용자가 원본 명령으로 직접 실행할 수 있도록 합니다. Overview 없는 현재 상태에서 다른 작업 Tab에 Agent를 생성하지 않습니다.

### 구현 진행 흐름 — 2026-11-01 기준

아래 표는 사용자 검증을 기능마다 요구하는 단계별 게이트가 아니라, **구현 의존성 및 남은 작업 순서**입니다. 실제 완료는 사용자 실사용 검증을 거쳐 판단합니다.

| 순서 | 개발 영역 | 현재 구현 / 남은 계약 |
| --- | --- | --- |
| **1** | Pi 원본 Fork·Handoff·Ghostty 제어 | Native 코드 및 임시 명령 작성, **실행·통합 미검증** |
| **2 (현재)** | `pic` 전용 Overview TUI·탐색 | 공식 `@earendil-works/pi-tui` 기반 관리 화면 코드 작성. 프로덕트/전체 Agent/메시지 보기, **명시적으로 기록된 생성 요청 관계에 따른 Main·Work·Support 중첩 계층**, **기록된 Terminal UUID를 통한 기존 Surface 포커스** 연결. 실행 미검증 |
| **3** | Main 명시 선택·새 실행/복원 + Work/Support 직접 위임 | Overview ID→정확한 Agent 생성·Terminal 연결 미구현. Main 복원은 입력 대기까지만. 생성 결과/실패 보존 필요 |
| **4** | `@세션`·Git Worktree | 같은 프로덕트의 저장 세션 검색·완료 leaf와 `>>`의 호출 Agent HEAD 기준 Worktree, 실패/충돌 처리 미구현 |
| **5** | Agent 수명·실시간 상태·탐색 | 실행/선택 대기/종료/오류 이벤트, 기존 Surface 이동 후 포커스, 종료·Resume·백그라운드 선택 미구현 |
| **6** | Summary Overlay·Handoff 실제 UI | 경량 근거 요약·포커스 아웃 30초/종료 시 Overlay·공유 후보/대상 선택·메시지 Sidebar 통합 미구현 |
| **7** | 설치·사용 흐름 정리와 전체 실사용 검증 | 사용자 직접 실제 Ghostty/Pi 흐름 검증 및 후속 관찰 개선. 자동 PR 병합/CI 추가 없음 |

**Overview 현재 코드 경계:** `bin/pic.mjs`의 인자 없는 실행을 `src/overview.ts`로 라우팅하고, Pi 1.4.0의 `SessionManager.listAll()` + `getEntries()`에서 **명시적으로 기록된 Compose Agent 신원**만 읽습니다. Ghostty 1.3.1 Terminal 목록에서 정확한 UUID가 발견된 경우에만 기존 Surface를 포커스합니다. 실시간 실행 상태·최근 사용자 확인 여부·Main 승인 여부를 추측하지 않습니다. 다른 Ghostty Tab에는 Overview TUI를 만들지 않습니다. 사용자가 종료하거나 다시 여는 기록은 아직 미구현입니다. 현재 첫 Main 생성/선택이 연결되지 않아 **제품을 처음부터 사용할 수 있는 상태가 아닙니다.**

### 이후 사용자 실사용 검증

전체 구현 배치를 마친 뒤 사용자가 실제 개발 흐름(위임→Overview의 새 Split→포커스·30초 Overlay→결과·확인 필요→종료·재개→Handoff)으로 확인합니다. **새 테스트 코드/CI 작성, PR 병합, 기능별 검증 반복은 사용자가 별도로 요청하기 전까지 진행하지 않습니다.** 실사용에서 발견한 실패/불편 사항을 모아 후속 개선합니다.

## 3. 반드시 지킬 경계

- 사용자 실행 선택 없이 Work/Support 자동 시작 금지. **명시적 빠른 위임/자연어 실행 요청 자체는 시작 승인**이므로 별도의 중복 확인을 강제하지 않음. **Agent 스스로 자율적으로 다단계 위임하는 권한**은 사용자 직접 위임과 별개이며, 추가 설계 전 임의 활성화 금지.
- Fork를 요약 프롬프트/같은 세션 Resume로 위장 금지. Main 원본 변경 금지.
- Summary가 모델 컨텍스트에 자동 삽입되는 것 금지. **화면 표시와 정보 전달 분리**. 경량 요약은 30초 정기 호출/매 Tool 호출이 아니며, 포커스 시 즉시 Overlay를 해제해야 함.
- 새 Work 생성 시 미전달 중요 결정 자동 경고·동기화 금지. Work 간 전달은 **사용자가 대상과 전송을 선택할 때만** 실행하며, 수신 Work가 응답 중이면 **현재 Pi 턴 종료 후** 모델에 반영. 기능 개발 완료를 별도로 판별하거나 대기하지 않음. `pi-intercom` 재사용 범위를 넘는 범용 메시지 시스템을 만들지 않음.
- **Agent별 고유 Ghostty Surface·Pi 프로세스를 유지**합니다. 새 Work/Support는 Overview에 생성 순서대로 추가하지만 기존 입력 포커스를 가져오지 않습니다. Sidebar는 계층·위치를 유지하고 상태만 갱신합니다. Overview의 Split 또는 별도 작업 Tab은 **표시 위치**일 뿐입니다. 기존 Pi 실행을 재시작하거나 Resume/미러링해 이동을 흉내 내지 않습니다. **첫 버전은 Ghostty 기본 수동 드래그**를 사용하고 메뉴 한 번으로 자동 Surface 이동하는 기능은 후속 과제로 둡니다. Herdr App·herdr-core 및 별도 멀티플렉서/실행 관리 계층은 도입하지 않습니다.
- 문서 자동 갱신은 사용자 승인과 중요한 기존 제약의 변경 여부에 근거. 새 문서 생성은 확인.
- Work의 문서 수정 범위, Work 간 **턴 종료 이벤트 연동·수신 확인·실패 처리 세부 및 메시지 사이드바 목록·조작**은 미확정. 구현자가 임의로 선택하지 않음.
- Git 병합·Worktree 정리·사용자 파일/세션 삭제는 자동 실행하지 않음. Agent 목록 제거와 세션 데이터 삭제를 혼동하지 않음.

## 4. 완료 판단의 기준

1. Main·Work·Support 어느 Agent에서든 다른 Work/Support를 위임할 수 있고, Work는 **현재 Agent 또는 같은 프로덕트의 `@세션`**에서 실제 완료 분기를 Fork합니다. Support는 독립 세션이며, 생성 요청 관계·Fork 원본·Git Workspace 분리가 정확함을 사용자가 확인할 수 있습니다.
2. Overview에서는 여러 **실제 Pi TUI Split**을 볼 수 있고, **Main 포함 Agent를 기존 Surface 그대로 다른 작업 Tab으로 옮긴 뒤 다시 Overview로 배치**할 수 있어야 합니다. 이동 전후 Pi 프로세스/세션 연속성이 유지되고, 사이드바에서 실제 Tab 위치로 포커스해야 합니다. Main이 이동해도 Overview 관리 TUI가 유지되며, **프로덕트 안 여러 Main, 전체 Agent 보기, 별도 메시지 관리 사이드바**를 탐색할 수 있어야 합니다.
3. 종료 요청에서 사용자가 **백그라운드 유지 또는 Agent 종료**를 선택할 수 있어야 하며, 각 선택의 실제 프로세스 동작·다시 열기·기존 기록 보존이 의도대로 동작해야 합니다.
4. Work에서 여러 번 개발·수정해도 Main에 긴 실행 로그가 자동 유입되지 않습니다. 직접 위임은 명령을 입력한 **어느 Agent의 모델 대화에도** 지시를 기록하지 않고 원문을 새 Agent에 보냅니다. 일반 자연어 위임은 입력한 Agent 대화에 남을 수 있습니다.
5. Summary는 포커스 아웃 30초·비포커스 응답 종료 시 나타나고, 포커스 시 즉시 사라집니다. **현재 활동·결과·필요한 결정**이 확인 가능한 근거와 함께 보이며, 중요한 결정 후보는 자동 표시해도 Main 수신은 사용자 요청 없이 일어나지 않습니다.
6. Sidebar의 위치/계층이 상태에 따라 바뀌지 않고, **생성 실패한 Agent도 Sidebar에 남습니다**. Agent 종료가 Pi 기록·Git 데이터 삭제로 이어지지 않으며, 종료/오류 Agent 클릭 시 **기존 Pi 세션만 입력 대기로 열고** 작업은 자동으로 재시작하지 않습니다. 임의의 새 Fork·자동 재전송을 하지 않습니다.
7. 명령별 Workspace가 예측 가능합니다: `>`는 입력 Agent cwd 공유, `>>`는 입력 Agent 현재 브랜치 HEAD에서 새 Worktree를 생성합니다. 미커밋 파일은 복사하지 않으며 Git 병합/삭제를 자동 실행하지 않습니다.
8. 문서화로 새 문서·중복 계약·불필요한 사용자 승인 Gate가 무분별하게 늘지 않습니다.

이 문서 자체는 어떤 완료 기준도 충족했다는 뜻이 아닙니다. 실제 환경에서 확인되지 않은 결과를 성공으로 주장하지 않습니다.
