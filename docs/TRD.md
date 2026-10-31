# TRD — Pi Compose 기술 설계와 검증 항목

- 기준: [PRD](PRD.md), 2026-10-31 합의
- 상태: **기술 방향은 일부 확정, 새 Ghostty 구현과 실사용은 미검증**

## 1. 도구와 책임

| 도구 | 역할 | 현재 상태 |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | 실제 Pi 대화 트리·세션 Fork/Resume·모델·Compaction·Extension·TUI | **유지 확정** |
| Ghostty | **Agent별 고유 Surface 유지**, Overview에서는 여러 실제 Pi TUI를 Split으로 함께 표시, Main 포함 수동 드래그로 다른 작업 Tab 이동, 포커스·최소화/숨김·종료 | **유일한 실행/표시 기반으로 확정**; Tab 간 왕복 이동·Surface 식별·프로세스 유지 실사용 미검증 |
| Git | Shared Directory·Git Worktree·변경 이력·통합 | 기존 기능 사용 |
| `AGENTS.md` + 기존 `docs/*` | 가벼운 지침 + 중요한 프로젝트 계약의 원본 | **문서 원칙 확정**, 실제 지침 내용/도구 검증 필요 |
| Pi Skill | 명시적 요청으로 필요한 프로젝트 문서 선택적 읽기 | **구현 후보**, 명령 이름·정확한 동작 미정 |
| Pi Extension | 원본 세션 Fork/작업 연결 및 Summary Overlay 등 최소 추가 기능 | 확정된 기능에 필요한 만큼만 검토 |

**Orca 통합, tmux/workmux, Herdr App·herdr-core, 별도 멀티플렉서/프로세스 실행 계층, 별도 데스크톱 GUI를 현행 제품에 사용하지 않습니다.** 이전 코드·CI·설치 스크립트에 다른 도구가 남아 있어도 현재 제품 방향은 바뀌지 않습니다.

## 2. 반드시 검증할 기술 계약

**2026-11-01 기술 조사·코드 진척:** Pi 1.4.0 CLI `--fork`/`SessionManager.forkFrom()`는 JSONL 전체 엔트리를 복사하므로, 이를 선택한 활성 완료 분기의 정확한 Fork로 바로 간주하지 않습니다. Native `createBranchedSession(leafId)`는 명시적으로 지정한 분기의 엔트리·Compaction·ContextEdit 등을 복제할 수 있습니다. Draft PR #15의 `src/native-work-fork.ts`는 원본을 읽기 전용으로 열고 새 대상 세션 파일을 만들며, 헤더 ID·leaf·마지막 Assistant `stop`을 확인합니다. `src/agent-bootstrap.ts` + `extensions/agent-identity.ts`는 새 세션의 ID와 launch ticket가 맞을 때만 Agent 역할/프로덕트/생성 요청자/Fork 출처를 해당 **새 Pi 세션에만** custom entry로 기록합니다. `src/agent-relationships.ts`는 명시적인 native Split 생성 영수증(request ID + 자식 세션 ID + Terminal UUID)이 있는 경우에만 Surface를 결합합니다. **각 코드의 실행·통합 검증 전이며 현재 Ghostty Split 실행 경로는 아직 연결되지 않았습니다.**

### 정확한 Pi 세션 Fork

1. 직접 위임을 입력한 **현재 Agent**를 기본 Fork 원본으로 삼거나, `>w @세션`/`>>w @세션`에서 선택한 **같은 프로덕트**의 Pi 세션 ID/활성 분기를 정확히 식별합니다. 원본은 Main·Work·Support 모두 가능하며 실행 중/종료된 저장 세션 모두 후보입니다.
2. 원본 세션의 최신 **완료된** 활성 대화 지점까지 별도 Pi 세션으로 Fork합니다. 진행 중인 응답·미완료 입력은 포함하지 않고, 실행 종료 세션은 기록의 유효성을 확인합니다.
3. **원본 Pi JSONL을 수정하지 않고** 원본 세션 ID·완료 branch/leaf·새 Work 세션 ID, **생성 요청 Agent와 실제 Fork 원본의 구분**, 프로덕트 소속을 보존합니다. Compaction/ContextEdit 등 실제 컨텍스트 처리 보존을 검증합니다.
4. Fork는 Git 작업 공간이나 미커밋 파일 복제를 뜻하지 않습니다. 현재 cwd와 선택한 원본 세션의 cwd/Worktree가 달라도 **`>`·`>>` Workspace 명령 정책**을 우선하며 `AGENTS.md` 차이를 검증합니다. 다른 프로덕트 세션의 선택/Fork는 허용하지 않습니다.

### Ghostty와 Pi UI

- Overview에서는 여러 Agent의 **실제 Pi TUI**를 Split으로 보여줍니다. Main도 Work/Support처럼 별도 작업 Tab에 이동할 수 있으며, Overview 관리 TUI는 그대로 남아야 합니다. **모든 Agent를 Overview에 상시 표시한다는 과거 정책은 적용하지 않습니다.**
- Summary Overlay는 **실제 Agent의 Pi TUI 위에 겹쳐 보이는 사용자용 정보층**입니다. Pi TUI/Surface는 계속 살아 있어야 합니다. 포커스가 오면 즉시 해제하고, 별도 토글·'터미널 열기' 버튼·가짜 터미널 미러링은 만들지 않습니다. **Ghostty Surface 위 Overlay/포커스 전달을 실제로 구현할 수 있는지 미검증**입니다.
- **`pic` Overview Tab에만 사이드바를 표시**합니다. 프로덕트별/전체 Agent별 보기와 별도 메시지 관리를 그 안에서 전환합니다. 별도 작업 Tab에는 사이드바를 주입하지 않으며, Overview로 돌아오면 기존 관리 TUI를 확인할 수 있어야 합니다.
- **구현 방향 확정**: `pic` Overview의 관리 TUI와, 각 Main·Work·Support의 **고유 Ghostty Surface에서 실행 중인 Pi TUI**를 분리합니다. 초기 Overview에는 여러 Pi TUI가 Split으로 표시됩니다. 사용자가 **Ghostty 기본 드래그로 기존 Surface를 다른 Tab에 이동하거나 Overview로 복귀**할 수 있습니다. Agent 선택은 현재 Surface가 속한 Tab/Window에 포커스하며, 어느 경우에도 Pi를 새로 실행하거나 Resume하여 이동을 흉내 내지 않습니다. **메뉴 한 번으로 자동 이동하는 기능·동일 TUI 미러링·별도 멀티플렉서는 초기 범위 밖**입니다.
- **식별자 검증 주의**: Ghostty 1.4의 프로세스 환경변수 `GHOSTTY_SURFACE_ID`는 내부 `u64` 값을 16진수 문자열로 내보내지만, macOS AppleScript의 `terminal.id`는 `SurfaceView` UUID를 내보냅니다. **둘을 같은 ID로 취급하면 안 됩니다.** 실행 중 실제 Pi의 TTY와 AppleScript `terminal.tty` 등을 이용해 매핑을 검증하고, 이동 후 같은 `terminal.id`/TTY가 다른 Tab 아래 존재하는지 확인해야 합니다. `terminal.pid`는 *foreground PID*여서 영구적인 Agent 식별자로 사용하지 않습니다. Tab/Window ID도 재실행 후 유효하다고 가정하지 않습니다.
- **수동 이동 기술 검증 항목**: Ghostty 1.4.x/macOS에서 Overview → 미리 생성된 대상 Tab의 터미널 영역 → Overview 왕복, 이동 전후 Pi 입력·출력·세션/프로세스 연속성, 이동 후 임시 기본 셸을 안전하게 정리하는 동작, Main만 이동해도 Overview 관리 TUI가 유지되는지, 한 Tab의 마지막 Surface 이동·Tab 자동 닫힘 여부, `drag-handle`/전체화면/타이틀바 설정 차이를 **사용자 실사용으로 확인**합니다. 드래그 중 다른 Tab의 대상 영역을 실제 선택할 수 있는지도 확인 전에는 지원 완료라고 표시하지 않습니다.
- Pi 응답 종료, 사용자 명시 완료 보고, 작업 실패, 테스트 통과를 구분합니다. Summary가 성공을 추측하지 않게 합니다.
- **`pic` 내부에서만 '백그라운드 유지(최소화/숨김)' 또는 '실행 Agent 종료' 선택 UI**를 제공합니다. 유지 시 Ghostty와 기존 Agent Surface를 보존하고, 종료 시 Pi 대화·Git 데이터는 삭제하지 않습니다. Ghostty의 **`Cmd+Q` 및 일반 창 닫기는 가로채지 않습니다**. 숨김·최소화 시 실제 Pi 프로세스 유지와 내부 종료 동작을 검증합니다.
- 재접속 시 선택한 Main만 다시 열고 관련 Work/Support를 자동 재실행하지 않습니다. 무단 중복 세션·자동 새 Fork는 금지합니다.

**현재 구현 진척 (Draft PR #15, 실행 미검증):** Ghostty 1.3.1 AppleScript의 `terminal.id`, Window/Tab/Terminal 계층을 이용해 실제 Terminal을 조회하고 UUID로 정확히 포커스하는 `src/ghostty-native.ts` 및 임시 `/compose surfaces`를 작성했습니다. 같은 어댑터에 실제 Split 생성 API도 있으나, 확정된 Agent 생성·Fork 흐름과 아직 연결하지 않았습니다. **1.3.1에는 `terminal.tty`/`terminal.pid`가 없으며**, `GHOSTTY_SURFACE_ID`를 AppleScript UUID처럼 사용하거나 cwd/타이틀로 Agent를 매칭하지 않습니다. `src/agent-relationships.ts`는 명시적으로 기록된 본인 Pi 세션의 역할·프로덕트·생성 요청자·Fork 출처만 읽는 코드이며, 이러한 메타데이터 생성과 Overview 렌더링은 미구현입니다. Ghostty 1.4.0에서 추가된 TTY/PID로 1.3.1의 API를 가정하지 않습니다.

### 빠른 실행과 Agent 탐색
- Pi 기본 에디터를 유지합니다. **입력 첫머리의 `>w`, `>s`, `>>w`, `>>s` + 자연어**를 직접 위임 명령으로 해석합니다. Main·Work·Support 모두 같은 Extension 동작을 사용하고 역할별 생성 금지/임의 중첩 깊이 제한을 두지 않습니다. Pi `input` 이벤트의 `handled` 처리를 통해 **입력 Agent의 모델 호출과 대화 기록 이전**에 가로챕니다. `@세션` 탐색에는 Pi 기존 자동완성 확장 API를 조사하며 **Compose `registerShortcut` 바인딩/키 설정 변경은 제외**합니다.
- Work는 **현재 Agent 또는 `@세션`으로 지정한 같은 프로덕트의 Pi 세션**의 활성 완료 지점 Fork → 새 세션/Surface 생성 → 사용자 지시 원문 전송 및 실행합니다. Support는 `>s`/`>>s`로 새 독립 세션에서 실행합니다. **단축어·선택용 `@세션`을 제외한 지시 원문**을 전송하며, 모델 요약으로 다시 쓰거나 미완료 응답·직접 위임 입력을 원본 컨텍스트에 유입하지 않습니다.
- 일반 자연어 위임은 **요청을 받은 Agent의 모델 대화**에 남는 것이 허용됩니다. 명시적 실행 의도 없이 모호한 자연어에서 Agent를 만들지 않고 필요한 정보가 불명확할 때만 확인합니다. 사용자 위임과 모델의 자율적 다단계 위임은 구분하며 후자의 권한은 미확정입니다. 전송 실패 시 **중복 생성·중복 지시**를 막고 원문을 보존합니다.
- **명령 문법은 `>w`/`>s` = 현재 cwd의 Shared Directory, `>>w`/`>>s` = 새 Git Worktree**입니다. 마지막 선택을 기억하지 않으며 추가 Workspace 선택 UI를 도입하지 않습니다. `>w`/`>>w`는 기본적으로 명령 입력 Agent를 Fork하고, **`@세션` 선택 시에만 Fork 원본을 변경**합니다. `>s`/`>>s`는 Independent이므로 원본 `@세션`이 필요하지 않습니다.
- `>w @`/`>>w @` 세션 검색은 **현재 프로덕트**로 제한하고 **Main/Work/Support, 실행 중/종료된 Pi 세션**을 대상으로 합니다. 세션 이름·최근 작업 한 줄·cwd/Worktree 정보를 표시하고 이름 및 최근 작업 내용으로 검색하며, 선택은 **표시 이름이 아닌 저장된 세션 ID**로 확정합니다. 기존 근거 기반 Summary를 재사용하거나 의미 있는 최근 실제 지시를 사용하고 **입력마다 LLM 요약을 호출하지 않습니다**. 입력 시작부에서만 이 패턴을 인식하여 **일반 Pi `@` 파일 참조를 유지**합니다. 자동완성 선택·이름 중복·종료 세션 참조와 Pi 자동완성 API 호환성을 검증합니다.
- Pi의 `/`, `!`/`!!`, `@`, Shell 리다이렉션 등 기존 문법·Ghostty/macOS IME·여러 줄 입력과 취소/오류 시 텍스트 보존을 검증합니다. 작업 지시가 없으면 생성하지 않습니다. **Compose 전용 키보드 단축키는 추가하지 않습니다.**
- Work/Support를 생성해 Overview의 새 실제 Split에 붙여도 **현재 Agent/Tab의 포커스를 훔치지 않습니다**. Sidebar에서 선택하면 동일 Pi 프로세스/Surface의 실제 위치로 포커스하고, 직접 Split 클릭도 가능합니다. 별도 Tab에 Sidebar를 삽입하지 않습니다.
- Sidebar 계층·위치·생성 순서를 고정하고 상태 변화로 재정렬하지 않습니다. **요청한 Agent와 Fork 원본 Agent의 관계를 별도 보존**합니다. 새 Split은 마지막 생성 Agent 옆에 추가하고, Resize/Zoom/수동 드래그는 Ghostty가 담당합니다. Agent 역할·중첩 깊이에 임의 제한이나 자동 이동/정리는 두지 않습니다. 최소 Surface 크기 등 실제 리소스 제약으로 생성 실패 시 오류를 노출하고 기존 Surface를 무단 종료/이동하지 않습니다.

### Git Workspace 선택·생성
- `>`는 **명령어를 입력한 Agent의 cwd를 그대로 공유**합니다. `@세션`이 다른 Worktree에 있더라도 파일 작업 공간은 따라가지 않으며, Fork 컨텍스트와 파일 상태 차이를 사용자에게 인지시킬 수 있도록 검색 결과에 Workspace 정보를 표시합니다.
- `>>`는 **명령어를 입력한 Agent의 현재 체크아웃 브랜치 HEAD 커밋**을 시작점으로 **새 독립 브랜치와 Git Worktree**를 생성합니다. `@세션`이 지정됐어도 시작 커밋은 Fork 원본이 아닌 **명령 입력 Agent 기준**입니다. 원본의 브랜치·디렉터리는 변경하지 않고 미커밋 변경을 복사하지 않습니다.
- 입력 Agent에 미커밋 변경이 있으면 **복사되지 않는다는 안내만 제공**하고 반복 확인이나 자동 커밋을 강제하지 않습니다. Git Merge·Cherry-pick·Worktree 삭제를 자동화하지 않습니다. detached HEAD·브랜치명 충돌·동시 생성·저장소 판별·Worktree 생성 실패 같은 Git 기술 예외는 조사하고, 기존 데이터 훼손 없이 처리합니다.

### 상태 이벤트·경량 Summary 생성
- 실행 중/입력 대기/선택 대기/정상 종료/비정상 종료/오류를 실제 Pi/프로세스 이벤트로 추적합니다. `agent_end`만으로 종료를 확정하지 않습니다. 자동 재시도·followUp 종료 후의 `agent_settled`를 참고하되 **Pi 응답 종료와 도메인 작업 완료를 구분**합니다. 명시적 `ui_prompt_start/end`는 사용자 조작 대기의 근거가 됩니다.
- Overview에서 Agent가 포커스를 잃으면 단조 증가 시간 기준 **30초 후** Summary Overlay 표시, 재포커스 때 타이머 취소·Overlay 즉시 제거, 포커스 아웃 재발생 시 타이머 재시작. 포커스가 없는 Agent에서 응답이 완료되면 즉시 결과 Summary를 보여줍니다. 포커스 최우선이며 완료 이벤트가 입력 화면을 가리지 않습니다.
- Tool 시작/종료, 메시지/최종 답변, 원래 지시, 검증 가능한 Git 정보를 **근거 이벤트로 수집**합니다. 별도 **경량 모델**은 제한된 최근 사실을 바탕으로 가장 중요한 현재 활동/결과/필요한 결정 한 줄과 핵심 근거 1~2개를 생성합니다. 중요한 활동 변화 또는 응답 종료에만 갱신하고 반복 호출·30초 주기 폴링·매 Tool 호출 요약은 금지합니다. 요약은 Main/Work의 Pi 대화에 넣지 않습니다.
- 모델이 생성한 설명은 **사실 확인 신호를 대체하지 않습니다**. Shared Directory에서는 Git 변경을 특정 Agent 성과로 단정하지 않습니다. 작업 진행률 수치·검증 성공·실제 구현 완료를 추측하지 않습니다. 사용자 선택 UI나 실제 막힘 근거가 없으면 일반적인 질문을 `확인 필요`로 오분류하지 않습니다.
- `새 응답`은 사용자가 포커스해 확인할 때 해제할 수 있지만 `확인 필요`는 클릭만으로 사라지지 않습니다. 답변 이후 실제 진행 신호를 확인합니다. 요약 정확도·지연·요금·동시 Agent 수·요약 실패 시 기존 사실 표시·정보 보호 정책을 기술 조사에서 구체화해야 합니다.

### 종료·재개·관리 목록 정리
- Pi 내에서 현재 응답을 중단할 때는 기본 `Esc`를 이용합니다. Agent 자체 종료는 Sidebar에서 실제 Pi 프로세스/Surface를 종료하며, 진행 중이면 위험 안내/확인, 유휴면 추가 확인 없이 처리합니다.
- 사용자가 Pi에서 직접 exit하거나 Ghostty Split을 닫는 경로까지 포함해 **실제 프로세스 수명과 Compose Sidebar 상태**를 연결하고 정상/비정상 종료를 구분합니다. 종료 중 이미 변경된 Git 파일·Pi 기록은 유지하고 외부 명령을 자동 재실행하지 않습니다.
- 종료된 Agent는 기존 생성 요청 Agent·프로덕트 관계와 Sidebar 위치를 유지합니다. **종료된 행 클릭은 해당 Pi 세션의 새 프로세스+Surface 복원 및 포커스**를 바로 수행하되 **Pi는 입력 대기로 시작**해야 합니다. **작업을 다시 진행하는 것은 사용자가 새 지시를 직접 보낸 경우에만** 가능합니다. 정상/비정상 종료 모두 동일하며 Work 재개는 **원본 Pi 세션의 재-Fork가 아니며** 이전 최초 작업 지시·중단된 Tool/명령을 자동 재전송·재실행하지 않습니다. 실패 시 빈 세션을 대신 만들지 않습니다.
- **종료된 Agent만** Compose Sidebar 목록에서 제거할 수 있습니다. Pi 세션이나 Git 파일/Worktree를 실제 삭제하지 않습니다. 별도 Archive/Unarchive 관리 계층은 만들지 않습니다.
- **생성 중 실패한 Agent 항목은 Sidebar에 남깁니다.** 생성 요청 Agent·프로덕트 관계와 사용자 입력 원문을 가능한 범위에서 보존하고, 실제 Pi 세션 존재 여부와 프로세스 상태를 근거로 표시합니다. 생성·최초 지시 전달·실행의 단계별 상태가 불명확하면 **중복 생성 또는 최초 지시 자동 재전송을 하지 않습니다**. Sidebar에 별도 재시도 버튼/복구 화면을 만들지 않고, 오류 원인은 기존 Overview/터미널 표현에서 확인할 수 있게 합니다. 세부 실패 판별은 기술 설계에서 결정합니다.
- `pic` 자체의 종료 UI(백그라운드 유지 vs 실행 Agent 종료)와 개별 Agent 종료는 별도 동작입니다. Ghostty Cmd+Q·일반 창 닫기를 가로채지 않는 기존 계약을 유지합니다.

### 문서화와 컨텍스트 관리

- Pi의 짧은 프로젝트 지침과 기본 파일 도구로 시작합니다. Main이 사용자의 **명확한 승인**을 확인한 중요 결정을 기존 관련 문서에 **즉시** 반영합니다.
- 중요한 업무/기술 계약과 그 선택 이유를 비교합니다. 변경이 기존 목적을 훼손할 수 있고 의도적 승인 여부가 불분명할 때만 확인합니다.
- 새 문서 작성은 사용자 확인이 필요합니다. 과거 결정과 동일한 정보를 별도 DB·새 문서·ADR에 자동 복제하지 않습니다.
- 문서 변경 결과를 긴 Diff 전체로 Main에 다시 넣지 않는 방식을 우선 검토합니다. **짧은 지침 방식은 누락 가능성**이 있으므로 실사용에서 검증하고, 누락이 확인되기 전에는 별도 감지 Extension을 구축하지 않습니다.
- 맥락이 부족한 세션에서만 **사용자가 요청할 때** `AGENTS.md`가 가리키는 관련 문서를 읽는 방식을 검토합니다. Skill은 적합한 후보이나 모든 작업에 문서 전체를 자동 주입하지 않습니다.

### Work 결과와 Handoff

- Work의 실행 로그·전체 Diff·테스트 오류·중간 추론은 Main 모델에 **자동 입력하지 않습니다**.
- Work Summary는 공유할 만한 중요한 결정의 **후보를 자동 표시**합니다. 해당 결정이 실제로 Main에 반영됐는지 자동으로 안다고 주장하지 않습니다.
- 사용자가 명시적으로 요청한 경우에만 Main에 필요한 결정, WHY, 영향, 원본 근거를 전달합니다.
- **Work→Work 전달은 사용자 선택형**입니다. 사용자가 Work A Summary의 공유 후보와 **수신 Work를 선택**한 경우에만 전송을 요청합니다. **`pi-intercom`의 기존 세션 간 1:1 메시징을 재사용**하며, **작은 Pi Compose Extension**은 Summary/대상 선택/메시지 생성 및 호출 연결만 담당합니다. 별도 메시징 Broker나 새 통신 시스템을 기본안으로 만들지 않습니다.
- **수신 Work가 Pi 응답(턴)을 생성 중이면 해당 턴 종료 뒤 모델에 반영**합니다. 현재 턴 도중 방향을 변경하지 않습니다. `pi-intercom` 0.18.1의 `busyDelivery: "human-first"`는 정상 Pi TUI 턴 종료에서 보류→주입이 작동한 1회 실사용 기록이 있습니다. 이것이 중단·오류·동시 수신 전체를 증명하지는 않습니다. 기능 개발의 전체 완료를 기다리지 않습니다.
- **Draft PR #15 코드:** `extensions/handoff.ts`에서 사용자가 활성 Pi 분기의 근거와 수신 세션·본문을 고르고 `intercom:outbox-request`를 발행하며, `intercom:outbox-result`를 기록합니다. 임시 `/compose handoff` 명령 및 `src/handoff-history.ts` + `/compose messages` 읽기 전용 이력 표시 코드를 작성했습니다. **실행/통합 미검증**, Overview/Summary/Sidebar 연결 전입니다. 전송 결과가 없는 발신 요청은 성공이나 대기로 단정하지 않고 `outcome-unknown`으로 구분합니다. `pi-intercom`의 Outbox 이벤트 API 및 전송 상태 보고는 **연동 수단**입니다. 기존 Broker에 보낸 시점, 수신 Work에 도착한 시점, Work 모델에 반영된 시점은 다를 수 있으므로 단일 '전송 완료'로 혼동하지 않습니다. 기존 `intercom` Tool이 허용하는 Agent 자율 전송은 Pi Compose의 사용자 선택형 Handoff와 **구분해 통제**해야 합니다.
- 독립 작업의 보고는 자체 검증 없이 실제 코드·테스트 성공의 증거로 간주하지 않습니다. Git 통합은 별개입니다.

## 3. 구현 수단 선택 기준

- **기능의 필요성은 제품 요구사항**, 구현 수단은 기존 Pi·Git·Ghostty의 API로 먼저 검증합니다.
- Skill은 모델에게 특정 맥락 로드 절차를 요청할 때, Extension은 Pi TUI/명령·이벤트 연결이 실제로 필요할 때 검토합니다.
- MCP는 외부 데이터/시스템 연동이 필요할 때 고려합니다. 로컬 프로젝트 문서를 다룬다는 이유만으로 MCP 서버를 만들지 않습니다.
- 외부 도구를 재구현하거나 범용 상태 관리자/계약 DB/문서 감시기를 만드는 것은 현재 범위가 아닙니다.

## 4. 아직 해결되지 않은 기술·제품 질문

1. `pi-intercom` 0.18.1 `human-first` 정상 턴 종료 경계는 **외부 TUI 실행 1회 관찰**. **Compose Outbox와 실제 설치/설정 조합은 미검증**이며, 중단·오류의 수신 및 Broker 전송·대기·주입·실제 모델 처리의 관찰 범위는 구현 연결 시 확인합니다. Outbox `sent`는 수신 모델이 읽음/승인함을 뜻하지 않습니다.
2. Summary의 상태·30초·우선 정보 구조는 승인됐으며, **Overlay를 실제 Ghostty Surface 위에 보여주는 방법·경량 요약 호출 정책/성능**, **프로덕트/Agent 사이드바 및 메시지 관리의 필터·전달 상태·사용자 조치**의 구현 지원 범위가 미검증입니다.
3. Work 자체의 문서 수정 권한, 병렬 Worktree의 문서 변경 통합·충돌과 문서 갱신 실패 처리.
4. Support→Work 전달 범위와 사용자 명시 수신 경험, Work→Work 지연 수신의 실제 UX 및 대상 식별·재전송·중복 처리.
5. **`>w @` 세션 자동완성 API·실제 Pi 세션 ID/Fork leaf 식별, 현재 프로덕트 범위 판별, 다중 Agent 중첩, 현재 Agent cwd와 원본 cwd 불일치, `>>` Worktree 생성/원본 브랜치 HEAD, 미커밋 안내·Git 예외**를 확인합니다.
6. Ghostty의 **Overview 초기 Split 생성 순서·Surface ID/TTY/Pi 세션 매핑·기본 드래그의 Tab 간 왕복·현재 위치 기반 포커스·Split 최소 크기·Zoom·Overlay 가능성**을 확인합니다. `pic` 내부 종료 UI·최소화/숨김 중 Agent 생존을 검증하며, Cmd+Q/일반 창 닫기 가로채기는 제외합니다. 별도 상주 실행 계층으로 우회하지 않습니다.

> 이전 tmux/workmux/Handoff Extension과 기존 CI 검증 내역은 **구현 역사**입니다. 새 방향의 동작을 증명하지 않습니다. 사용자가 별도 요청하지 않은 테스트·CI 추가나 PR 병합은 진행하지 않습니다.
