# Implementation Plan — Pi + Ghostty 재설계

- 기준: [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [TRD](TRD.md), 최신 UX 합의 2026-10-31
- 상태: **Native Pi/Ghostty 기초 구현 PR #15는 2026-11-01 main에 병합됨**. macOS 실행 중 발견한 부팅 오류 수정은 **Draft PR #18**, Main-first Sidebar UX 재설계는 **Stacked Draft PR #19**에서 코드 작성 중입니다. 사용자 실사용은 초기 Pi TUI 실행까지 확인됐으며 새 Sidebar·중첩 Split UX는 아직 미검증입니다. 의미 Summary·완성 Handoff Sidebar·복구 UX는 미완성입니다. 과거 tmux/workmux/Orca Phase 0–6 계획은 현행 순서가 아닙니다.
- 원칙: 사용자 검증을 위해 기능 구현과 별도로 테스트/CI/PR 병합을 자동 실행하지 않습니다. 이전 구현 코드와 사용자 세션·Worktree는 보존합니다.

## 2026-11-02 실제 촬영 시도에서 확인한 문제와 Main-first 개선

사용자가 README 영상 촬영을 위해 macOS Ghostty에서 `pic`을 실제 실행하면서 아래를 확인했습니다.

1. `LIST_TERMINALS` AppleScript `records`가 `every record`로 해석돼 Overview 실행 실패. 수정 후 **사용자 Overview 실행 확인**.
2. Split 환경변수 regex에서 `r/n/0`을 거부하여 Main 생성 실패. 수정 후 **실제 Ghostty Split 생성 확인**.
3. 새 Split의 PATH에서 npm/nvm `pi`를 찾지 못할 가능성으로 런처 실패. 원래 터미널 PATH 전달과 오류 메시지 표시를 작성. **사용자 Pi TUI 실행 확인**.
4. 전역 설치된 이전 Pi Compose `navigator.ts`와 로컬 Compose Extension 도구명이 충돌. 사용자가 Pi 설정에서 중복 Extension을 조정한 뒤 **Pi Main TUI 실행 확인**.
5. 실제 화면은 **Overview(반쪽) → `n` → Main(반쪽)**이어서 목표 Sidebar가 아닌 관리 TUI에 가까웠습니다. **README 미디어 촬영 중단, UX 재정의 승인.**

**새 Draft 구현 배치(실행/UX 검증 전):**
- `pic` 초기 Main 자동 준비: 현재 디렉터리의 신원 확인된 Compose Main 0/1/복수에 따라 신규/기존/명시 선택.
- 첫 Main 옆에 폭이 좁은 Sidebar를 유지하도록 Ghostty 기존 Split의 `resize_split`을 요청(실패해도 Agent 재시도 금지). Pi 입력에 포커스를 두고 시작.
- 후속 `>w`/`>s`/`>>w`/`>>s`는 요청자의 **진짜 Pi Terminal UUID**를 기준으로 같은 pic Tab 내 작업 영역을 Split; Main이 다른 Tab이면 pic Tab에 남은 확인 가능한 Agent를 우선 사용.
- Sidebar는 프로덕트/Agent/메시지의 간결한 목록, 원본 영수증 근거 상태, 5초 간격의 조용한 조회를 사용. 원본 Pi TUI를 Sidebar에서 미러링하지 않음.
- 새 PR은 시작 오류 수정 PR #18 위에 쌓는 **stacked PR**로 분리. README 미디어 Draft PR #16과 별도.

**남은 실사용 검증:** `pic` 직후 Main 포커스, 실제 Sidebar 초기 폭, 두 번째·세 번째 Native Split이 오른쪽에서만 중첩되는지, Sidebar 폭 유지, 다중 Main 선택/실행 중 Main 재사용, `>w` Native Fork/Worktree 실제 동작, 메시지/상태 표시/Resizing/이동 UX. **테스트 코드·타입체크·CI는 사용자 요청에 따라 이번 구현에서 실행하지 않음.**

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
| Pi `input` 직접 위임 명령 선처리 | `extensions/direct-delegation.ts` 작성 | 네 가지 `>`/`>>` 명령과 `@세션` 코드를 작성; Overview ID 없으면 원문 복원 |
| 진행 중 응답/명령 실패 시 원문 보존 | `handled`·`setEditorText()` 코드 작성 | 실제 Pi TUI 검증 전 |
| 완료한 Work leaf 복제와 Support ID 생성 | Native Pi API 연결 코드 작성 | 실행/원본 불변 검증 전 |
| Ghostty Split 발행·반환 UUID 확보·기존 포커스 복원 | `src/native-agent-launch.ts` 작성 | Ghostty 1.3.1 macOS 통합 검증 전 |
| 자식 Pi 시작·초기 작업 지시 원문 | 일회성 Ticket + `bin/native-agent-entry.mjs` 작성 | 실제 Pi readiness·지시 전달 검증 전 |
| 자식 세션 identity/Terminal binding | `extensions/agent-identity.ts` 연결 | 실제 부모-자식-UUID 검증 전 |
| `pic` 전용 Overview TUI·관리 Terminal ID | **Draft PR #15 코드 작성** | Main/Work/Support 실행 통합 검증 전 |
| `>>w`/`>>s` Worktree, `>w @세션`, `>>w @세션` | **Draft PR #15 코드 작성** | Pi 자동완성·Git Worktree 실행 통합 미검증; 오류 시 자동 재시도/삭제 없음 |

**완료한 코드 연결:** `pic` Overview TUI에서 Native Terminal UUID를 확인해 Main을 생성/명시적 재개하고, 자식 Pi에 Overview ID를 전달해 직접 위임 시 Ghostty Overview Split을 생성하도록 코드를 작성했습니다. 기존 작업 Tab에 우회 Split을 생성하지 않습니다. **실제 연결·오류·중복 실행 검증 전**입니다.

### 구현 진행 흐름 — 2026-11-01 기준

아래 표는 사용자 검증을 기능마다 요구하는 단계별 게이트가 아니라, **구현 의존성 및 남은 작업 순서**입니다. 실제 완료는 사용자 실사용 검증을 거쳐 판단합니다.

| 순서 | 개발 영역 | 현재 구현 / 남은 계약 |
| --- | --- | --- |
| **1** | Pi 원본 Fork·Handoff·Ghostty 제어 | Native 코드 및 임시 명령 작성, **실행·통합 미검증** |
| **2 (코드 작성)** | `pic` 전용 Overview TUI·탐색 | 공식 `@earendil-works/pi-tui` 기반 관리 화면 코드 작성. 프로덕트/전체 Agent/메시지 보기, **명시적으로 기록된 생성 요청 관계에 따른 Main·Work·Support 중첩 계층**, **기록된 Terminal UUID를 통한 기존 Surface 포커스** 연결. 실행 미검증 |
| **3 (코드 작성)** | Main 명시 생성·저장 세션 선택·재개 및 Work/Support 직접 위임 | `n` 새 Main / `o` 저장 Pi 세션 선택→Main Resume 코드 작성. Ghostty Split UUID를 자식 Pi에 전달해 Overview 직접 위임 Anchor로 사용. **실제 Main·위임 통합 미검증**, 생성 실패·미저장 세션의 영구 목록/중복 실행 보호 보완 필요 |
| **4 (현재)** | `@세션`·Git Worktree | 같은 프로덕트 저장 Pi 세션 선택, 입력창 전용 자동완성, 호출 Agent HEAD 기반 `>>` Worktree 생성 코드 작성. macOS/Pi/Git 통합 검증 전 |
| **5 (현재)** | Agent 수명·상태·종료 선택 | 일회성 Pi 자식 프로세스의 PID+OS 시작 시각·exit 이벤트 영수증, Overview 관찰 상태, `q` 백그라운드 숨김/명시적 확인 후 **확인된 프로세스만** Ghostty Surface 닫기 코드 작성. **실시간 Pi 모델 상태/동시 실행/종료 완료 확인/복구는 여전히 미구현 또는 검증 전** |
| **6 (현재)** | Summary Overlay·Handoff 실제 UI | Pi 1.4.0 원래 TUI의 non-capturing Overlay와 포커스 30초/비포커스 응답 종료 조건, 근거 엔트리 투영 및 Overview `v` 조회 코드 작성. **경량 LLM 의미 요약·중요 결정 자동 후보·Overlay 직접 공유·완성 메시지 Sidebar는 미구현**. 실행 미검증 |
| **7** | 설치·사용 흐름 정리와 전체 실사용 검증 | 사용자 직접 실제 Ghostty/Pi 흐름 검증 및 후속 관찰 개선. 자동 PR 병합/CI 추가 없음 |

### Main 생성·명시적 재개 구현 — 2026-11-01

- Overview `n`: 사용자가 프로덕트·Main 이름·절대 작업 경로 입력 → **초기 프롬프트 없이** Ghostty Overview에 Native Main Split 요청. Pi `--session-id`로 새 대화만 준비하고 사용자 입력을 기다립니다.
- Overview `o`: Pi `SessionManager.listAll()`의 **정확한 세션 ID/경로**로 저장된 Pi 세션을 고릅니다. 기존 Compose Work/Support 세션은 Main 후보로 승격하지 않으며, Compose 소속 없는 세션은 사용자가 프로덕트와 이름을 명시적으로 부여할 때만 Main으로 채택합니다. 기존 Main Surface UUID가 현재 Ghostty에서 확인되면 재실행 대신 그 Surface를 Focus합니다. 신규 Pi 인스턴스는 `--session <사용자가 고른 파일>`로 열고 **이전 프롬프트를 재전송하지 않습니다**.
- 자식 Main의 Launch Ticket는 정확한 Overview Terminal UUID를 전달하여 이후 `>w`/`>s`가 Overview Split을 대상으로 실행할 수 있게 합니다. 기존 Main의 identity/역할/제품은 임의 덮어쓰지 않고 새 Surface 바인딩만 기록합니다.
- **Pi 1.4.0 공식 저장 정책:** 사용자·Assistant 대화 메시지가 없는 새 세션은 JSONL 파일을 생성하지 않습니다. Overview는 현재 실행 중에만 새 Main의 임시 항목을 보유하고, 첫 사용자 메시지가 실제 저장되면 native Pi 기록으로 전환합니다. Overview 종료 전까지 메시지를 보내지 않았다면 미저장 항목은 복구되지 않습니다. 이를 영구 세션이라고 표시하지 않습니다.
- **완료 범위 한계:** 코드 작성 단계이며 실제 Ghostty 실행/설치/타입검증 전입니다. Ghostty 1.3.1에서 Terminal 존재는 실제 Pi 프로세스가 살아 있음을 보장하지 않습니다. 상태 추론·동시 실행 감지/기존 탭 불명확 처리·실패 영구 항목·Main 종료 선택은 다음 수명 관리 단계에서 다룹니다. 생성 시 임의 모델 입력/업무 재개/자동 중복 실행은 금지합니다.

**Overview 현재 코드 경계:** `bin/pic.mjs`의 인자 없는 실행을 `src/overview.ts`로 라우팅하고, Pi 1.4.0의 `SessionManager.listAll()` + `getEntries()`에서 **명시적으로 기록된 Compose Agent 신원**만 읽습니다. Ghostty 1.3.1 Terminal 목록에서 정확한 UUID가 발견된 경우에만 기존 Surface를 포커스합니다. 실시간 실행 상태·최근 사용자 확인 여부·Main 승인 여부를 추측하지 않습니다. 다른 Ghostty Tab에는 Overview TUI를 만들지 않습니다. 사용자가 종료하거나 다시 여는 기록은 아직 미구현입니다. Main 생성/선택 코드도 연결했으나 실제 Ghostty/Pi 실사용 검증 전이며 **제품 사용 가능 상태로 판정하지 않습니다.**

### 4단계 구현 진척 — 같은 프로덕트 세션 선택·Git Worktree

- `src/product-sessions.ts`: Pi `SessionManager.listAll()`에서 실제 Compose 프로덕트 소속과 **마지막 완료 Assistant 지점**이 확인된 Main/Work/Support만 Fork 원본 후보로 조회합니다. 실제 사용자 메시지에서 최근 작업 한 줄을 추출합니다. 세션 ID·이름·원본 cwd/Worktree 경로를 표시하고, 이름·최근 작업·ID 검색을 제공합니다. Compose 신원이 없는 Pi 세션은 프로덕트를 추측하지 않습니다.
- `extensions/direct-delegation.ts`: `>w @검색어 작업` / `>>w @검색어 작업`에서 사용자에게 **정확한 원본 세션 선택**을 요청합니다. Pi 공식 `addAutocompleteProvider`를 사용해 해당 접두어에서만 같은 프로덕트 세션의 ID를 완성합니다. 평소 Pi의 `@파일` 자동완성은 변경하지 않습니다. 선택한 세션의 작업 디렉터리로 자동 이동하지 않고 **호출 Agent의 cwd를 그대로 작업 공간 기준**으로 삼습니다.
- `src/native-worktree.ts`: 호출 Agent의 `git rev-parse HEAD` + `symbolic-ref --short HEAD`를 확보하고, `git worktree add -b <고유 브랜치> <고유 경로> <호출 HEAD>`로 새로운 독립 Worktree를 생성합니다. 원본 브랜치/작업 디렉터리·미커밋 파일에 손대지 않으며, 현재 브랜치가 없는 detached HEAD와 Git repo가 없는 경로는 명확히 실패합니다. 미커밋 파일은 새 Worktree에 복사하지 않으며 확인 가능한 경우 사용자에게 안내합니다.
- Native Pi 자식 Launch Ticket와 identity custom entry에 Worktree 브랜치·원본 HEAD·원본 브랜치·디렉터리를 저장합니다. `>w`/`>s`는 Shared Directory, `>>w`/`>>s`는 새 Worktree입니다.
- **실패/검증 경계:** Worktree 생성 뒤 Pi Fork/네이티브 Split이 실패하면 이미 생성된 Worktree를 자동 삭제하거나 다른 브랜치로 재시도하지 않습니다. 사용자가 결과를 확인할 수 있도록 경로를 남깁니다. 실제 Git CLI·Ghostty 1.3.1·Pi 1.4.0 연동, `@세션` IME·멀티라인, 중복 세션/실행 중 쓰기·생성 순서 검증은 **미실시**입니다. 인자 없는 `pic` Overview에서 실제 Agent를 선택·시작한 후의 전체 동작도 아직 사용자 검증 전입니다.

### 5단계 구현 진척 — Native Pi 수명/종료 선택 (2026-11-01)

- `bin/native-agent-entry.mjs`는 기존 **일회성 자식 Pi 실행 래퍼** 안에서 Pi 자식 프로세스 생성·종료/시작 실패 이벤트를 기록합니다. `src/agent-lifecycle.ts`는 저장된 Launch Request ID, Session ID, Ghostty Terminal UUID와 영수증을 대조하고, 실행 중이라고 표시하려면 **실제 OS PID와 시작 시각 지문이 동일한지** 재조회합니다. **Terminal 존재만으로 Pi 실행·대기·작업 완료를 추정하지 않습니다.** 별도 상주 서버, 메시지 Broker, 세션 DB는 추가하지 않았습니다.
- 프로세스 상태는 `starting-unverified`, `process-observed`, `process-unconfirmed`, `exited-observed`, `launch-failed`, `no-runtime-evidence`로 기록 근거에 따라 구분합니다. 이는 **OS 프로세스의 흔적**이며 Pi 모델의 실제 응답 진행·사용자 입력 대기·작업 성공을 판정하지 않습니다. 현재 Overview는 **수동 `r` 새로고침** 시 이 정보를 반영하며 실시간 구독/30초 Overlay는 미구현입니다.
- `q`/Ctrl+C 종료 선택에는 **Ghostty 숨김(실행 상태 보존)** 또는 **확인된 Pi 프로세스의 Native Surface 닫기** 및 취소를 두었습니다. 종료 선택 시 대상 수를 표시하고 **두 번째 명시적 확인 후** 동일 Session ID/Launch ID/Terminal UUID/OS 시작 지문을 다시 확인한 Surface에만 Ghostty의 `close`를 요청합니다. 상태 불명 Agent/Surface는 건드리지 않습니다. Ghostty 1.3.1의 `close`는 앱 차원 추가 확인이 없으므로 Compose가 먼저 확인합니다.
- 숨김은 macOS System Events의 Ghostty 가시성 조정을 시도하므로 OS 권한 때문에 실패할 수 있습니다. 실패 시 Overview/모든 Agent는 유지되고 사용자는 **Ghostty `Cmd+H`**를 사용할 수 있습니다. Ghostty의 Cmd+Q/창 닫기를 가로채지 않습니다.
- 종료 요청은 **Surface 닫기 응답**까지의 처리이며 Pi 자식 프로세스 exit 확인은 별도 영수증에서 판단합니다. 불명확한 상태가 남으면 Overview를 유지해 확인할 수 있도록 합니다. Pi 대화·Git 파일·Worktree는 자동 삭제하지 않습니다.
- **같은 Pi Main 세션의 중복 재개 보호:** 저장된 Main을 열 때 현재 Ghostty의 Native Surface가 있으면 그 Surface로 이동합니다. Surface는 없지만 **동일 OS Pi 프로세스가 관찰**되면 중복 재개를 차단하고, 생존이 불분명하다면 사용자가 위험을 알고 명시적으로 `RESUME`을 입력한 경우에만 실행을 허용합니다. 이는 Pi 세션 파일에 대한 범용 프로세스 잠금이 아니라 실측 근거 기반 보호이며, 비-Compose/manual Pi 프로세스까지 완전 차단하지는 못합니다.
- **남은 5단계:** 기존 외부에서 실행한 Pi 세션의 실행 여부, 중단/크래시/Wrapper 종료 시 정확한 복구 및 동시 실행 감지, 실시간 Pi turn/UI Prompt 상태, 확정 종료 후 복구 UX, 수동 Ghostty Tab 이동 검증은 미완성입니다. 본 변경은 **코드 작성만 완료**, 타입·실행·macOS 실사용 검증 전입니다.

### 6단계 구현 진척 — Pi 원본 TUI 위 Summary Overlay (2026-11-01)

- **Pi 1.4.0 공식 TUI 재사용:** `extensions/summary-overlay.ts`가 `ctx.ui.custom({overlay:true, overlayOptions:{nonCapturing:true}})`로 각 Agent의 **실제 Pi TUI 위에 직접** 패시브 정보층을 구성하는 코드를 작성했습니다. 기존 Pi 프로세스/Terminal을 복제·Resume·미러링하지 않으며 새 데스크톱 GUI/멀티플렉서를 추가하지 않습니다. 해당 Agent의 `session_start`에 정확한 Pi Session ID와 Ghostty Terminal UUID를 확인할 수 없으면 Overlay를 실행하지 않습니다.
- **표시 조건:** Ghostty 1.3.1 AppleScript의 `frontmost` + selected Tab의 focused Terminal UUID를 읽기 전용으로 관찰합니다. 포커스 아웃 시작점을 **단조 증가 시간**으로 잡고 30초가 경과하면 표시하며, 포커스 없는 상태의 `agent_settled`가 정상 완료면 30초 대기 없이 표시합니다. 재포커스하면 Overlay를 닫고 타이머를 초기화합니다. **현 코드의 포커스 관찰은 Agent당 1초 폴링**이므로 '즉시' 전환의 실제 지연/다수 Agent에서 AppleScript 부하·권한 실패는 사용자 실사용 검증 전입니다. 정확한 이벤트 기반 포커스 전환이 필요하면 기존 Ghostty/터미널 포커스 이벤트 재사용을 별도 검토합니다.
- **현재 사실 기반 Summary:** `src/summary-evidence.ts`는 Pi 활성 분기의 마지막 사용자 요청, 실제 Tool 결과, 최근 Assistant 답변을 **원본 Entry ID가 붙은 사실**로만 보여주고 `responding`/`waiting-for-ui`/`response-ended` 등 이벤트 출처만 표시합니다. `agent_settled`는 응답 종료일 뿐 기능 구현/검증 완료가 아닙니다. Overlay는 Pi 대화에 기록되거나 Main 모델 컨텍스트에 자동 주입되지 않습니다.
- **Overview에서 근거 확인:** `src/overview.ts`의 Agent 행 선택 후 `v`로 같은 Pi Session ID의 근거를 직접 조회합니다. 이는 읽기 전용 정보 확인 기능이며 Agent의 현재 모델 상태를 추측하지 않습니다. 기존 `/compose handoff`는 사용자가 Pi TUI에서 직접 원본·수신자·전달 내용을 선택하는 별개 전송 경로를 유지합니다.
- **현재 미구현 핵심:** 승인된 **경량 모델의 의미 Summary**, 중요 결정 **자동 공유 후보**, 후보 항목을 Overview/Overlay에서 사용자 선택해 바로 pi-intercom Outbox로 보내는 화면, 메시지 Sidebar의 전체 상태·필터/보관, 실제 빠른 포커스 복원/IME/좁은 Split. 이 단계는 UI·근거 수집 기반의 **일부 코드 작성**이며 제품 6단계 완료가 아닙니다.
- **검증:** AppleScript 1초 폴링/동시 Agent 수에 따른 비용, `ctx.ui.custom` 비차단 렌더링과 Pi의 `ui_prompt_*` 이벤트 상호작용, `agent_settled` 표시 시점, 포커스 재획득/원본 TUI 표시, 한글 텍스트/줄바꿈은 모두 사용자 로컬 통합 검증 전입니다.

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
