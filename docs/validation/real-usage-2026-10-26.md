# PR #3 — 2026-10-26 UX 실사용 진단과 핵심 흐름 복구

> 상태: **코드 수정 반영 / macOS 실제 사용·Pi 모델·workmux 연동 검증 미실행**. 사용자 제공 진단 JSON에서 확인한 사실, 코드 원인, 추론과 확인 불가를 구분한다.

## 1. 기준 및 스택 PR

- 분석 파일: 사용자 제공 `pi-compose-ux-test.json`의 JSON export (`generatedAt: 2026-10-26T13:28:14.963Z`, 총 97 이벤트).
- 최초 코드 기준: `868dbc9a38f81aa2d41ea26b1620b2399a092e8b`.
- PR #2: `feat/main-focused-tui-navigation` → `main` (Open, Draft, unmerged).
- PR #3: `feat/task-hub-ghostty` → `feat/main-focused-tui-navigation` (Open, Draft, unmerged).
- 새 변경은 PR #3에만 추가. 기존 PR #2와 `main`은 변경하지 않음.

## 2. 데이터에서 직접 확인한 사실

| 구분 | 관측 | 해석 |
| --- | ---: | --- |
| 전체 이벤트 | 97 | 진단된 Compose 이벤트만 |
| Preview 시도 | 6 | 성공 2, 실패 3, 취소 1. **개발 Agent 실행 아님** |
| 실제 위임 경로(자연어 + Launch) | 10 | 디스패치 성공 1, 실패 4, 취소 4, unavailable 1. 테스트성 이벤트 포함 |
| Child Pi 정확한 연결 | 1 | Pi Session ID와 실제 대상 연결 확인, 구현 성공 증거 아님 |
| 결과 미존재 열람 | 1 | 해당 작업에 Handoff/Review 기록이 없었음 |
| 저장 대화 탐색 `sessions.opened` | 0 | 관측 경로 없음; 사용자가 탐색하지 않았다는 뜻 아님 |

12:54:56~12:54:57 UTC의 여러 약 0~6ms 이벤트는 매우 짧은 시간에 반복됐다. 검증성/합성 이벤트일 가능성이 높으나 파일만으로 생성 이유는 확정 불가. 실제 사용자 행동 비율의 분모로 사용하지 않는다.

**실사용 후보 구간(13:17~13:24 UTC):**

1. Fork/Worktree Preview가 10.535초, 10.727초, 3.171초 후 실패했다. Preview는 `planLaunch()`만 호출하므로 실패 위치는 계획/검증 경로로 좁힐 수 있다. 정확한 실패 메시지는 기록하지 않았다.
2. 13:21:09~13:21:28 UTC, Fork/Worktree `/compose launch` 승인 후 디스패치 성공. 13:21:30 UTC 같은 flow ID로 `launch.agent_linked` 발생. **디스패치·연결 성공은 모델 지시 처리나 코드 변경 완료를 보장하지 않는다.**
3. 13:22 UTC 추가 Launch는 승인 취소.
4. 13:23 UTC `/compose`의 해당 Task에서 `result.unavailable`. 이어 Agent 화면으로 tmux 전환 성공 명령이 반환됐다. 결과 부재는 구현 실패나 보고 누락의 직접 증거가 아님.
5. 13:24 UTC `/compose launch`가 33.835초 후 실패. 이 흐름에는 `launch.approval` 기록이 없다. 정상적인 이벤트 기록이라는 전제에서는 승인 이전 계획 단계 또는 승인 UI 오류일 가능성이 높다. **workmux 실행이 실패했다고 단정하지 않는다.**

## 3. 코드에서 확인한 문제

| 코드 | 문제 | 조치 |
| --- | --- | --- |
| `extensions/work-return.ts:showSavedSessions` | 검색 함수 `matches()`와 결과 배열 `const matches`가 같은 이름. 저장 세션 필터 실행 때 초기화 전 지역 변수를 호출하면서 `ReferenceError` 가능 | 배열명을 `savedSessions`로 변경. 전환 오류 안내 추가, 관련 Unit Test 추가 |
| `src/diagnostics.mjs:analyzeDiagnostics` | Preview `launch.finished`를 실제 Agent 디스패치 성공률에 포함 | 실제 Launch 및 Preview 지표 분리. 개인정보 제외된 `launch.stage` 분류 추가 |
| `extensions/compose.ts:showLaunchWizard` | 실패 단계 없이 `launch.finished=failure`만 남음. 디스패치 성공을 사용자가 준비 완료로 오인할 수 있고 복구 안내 부족 | 계획/승인/디스패치/대상 검증 단계 기록, 안전한 실패 유형, 기존 리소스 보호/복구 안내, Child 화면 이동 안내 |
| `extensions/task-hub.ts:taskActions` | Handoff/Verify가 없는 작업에서도 결과 확인 동작을 제시하여 `result.unavailable` 유발 | 보고서가 기록된 작업에만 결과 메뉴 표시 |
| `extensions/task-hub.ts:showTaskHub` | Launch 시작 동작이 작업 목록 뒤에 있음 | `+ 새 Agent에게 작업 위임`을 작업 목록 위로 이동 |

**확인된 제한:** `src/launch.ts:planLaunch`는 Fork+Worktree에서 원본 Pi JSONL 헤더의 `cwd`가 Git Root와 다르면 명시적으로 거부한다. 이는 workmux의 원본 프로젝트 기준 Pi Fork 탐색과 관련된 제한이다. 이 제약은 삭제하지 않았으며, 원본을 Repo Root에서 시작하거나 Fork+Shared를 선택하도록 설명한다. 로그에 실패 분류가 없어서 이 제약이 해당 세 건의 직접 원인이라고 확정할 수는 없다.

**로그에 없는 내용:** Pi 인증·모델 사용 상태, 원본 Fork 실제 내용, Child 지시 수신·수정 파일, 사용자의 목적 달성 여부, 외부 터미널 화면, 실패 시 원본 stderr, 원래 설치 패키지 SHA. 이 정보가 없는데 성공했다고 보고하지 않는다.

## 4. 사용자 흐름 수용 기준과 검증 상태

| 시나리오 | 코드/구성에서 확인 | 실제 macOS 수용 |
| --- | --- | --- |
| A. Main 요구사항 → Fork + Worktree 위임 → Child Pi에서 지시 확인 | 계획·실행 명령, 승인, 대상 기록, Child Session 연결 경로 검토 및 안내 개선 | **NOT_RUN** (실제 모델 지시·Git 변경 확인 필요) |
| B. Main ↔ Child Agent 이동 | 정확한 tmux session + window ID 검사, 기존 창 이동(새 Pi 생성 없음) 코드 유지 | **NOT_RUN** (실제 tmux 화면 확인 필요) |
| C. 이전 기능 대화 탐색·전환 | 지역 변수 그림자 버그 수정; SessionManager.list()/switchSession() 경로와 테스트 소스 확인 | **NOT_RUN** (macOS Pi 세션 디렉터리에서 재검증 필요) |
| D. Preview/Launch 실패와 안전한 복구 | 단계·실패 분류, 리소스 삭제 없음, 재시도 전 Worktree 확인 안내 추가 | **NOT_RUN** (실제 실패 유도/복구 확인 필요) |

## 5. 다음 실사용 확인

```bash
pic doctor
# 문제일 때만:
pic setup
# Pi를 새로 시작하거나 기존 Pi에서 /reload
pic
```

Main에서 /login, /model 확인 → 요구사항 논의 → `/compose` → **+ 새 Agent에게 작업 위임** → **Fork existing Pi session** → **Git Worktree** → **Current Pi session** → 브랜치 입력 및 승인 → 메시지가 `실행 요청 전달`임을 확인 → `/compose` → 해당 Agent 화면 이동 → 원본 맥락/지시 확인 → Main 복귀. 작업 보고서 확인은 Child Agent가 `/compose-handoff`를 명시적으로 작성한 뒤.

이전 대화: 같은 `cwd`에서 `/compose sessions 검색어`, 다른 폴더의 경우 Pi 자체 `/resume`의 범위 옵션을 확인.

실패: 화면에 표시된 실패 단계와 메시지를 메모하고 `git worktree list`·`pic doctor`를 점검한다. 기존 Worktree, tmux 창, Pi 세션 파일은 사용자 승인 없이 삭제·초기화하지 않는다.

진단 내보내기:

```bash
pic diagnostics status
pic diagnostics export --days 1
# 전체 여정을 비교할 때 --run으로 한 프로세스만 제한하지 않을 것:
pic diagnostics export --days 7
```

**보안:** Event whitelist와 익명화 ID만 저장하며 프롬프트, 원본 cwd, 원시 stderr, 인증 토큰은 export에서 제외한다. 실패 원인은 `stage`와 `failureKind`로만 수집한다. 수집하지 않은 사용자 행동은 기록 부재로 입증할 수 없다.

## 6. 검증 기록과 경계

- 업로드 진단 JSON 전체 구조 및 개별 타임라인 읽기: **PASS**.
- GitHub PR #2/#3 실제 HEAD, Base, Open/Draft/Merge 상태 확인: **PASS**.
- 소스의 저장 세션 탐색 변수 가림 결함 분석: **PASS**, 재현 조건을 독립 JavaScript 표현식으로 재확인.
- 관련 기능 단위 테스트 **소스 추가**: **PASS** (작성 확인만).
- Pi Compose 전체 TypeScript, Node Unit Tests: **NOT_RUN** (검증 환경에서 저장소 Checkout/의존성 설치가 불가능하며 로컬 Node 22.16.0은 요구 `>=22.19.0` 미충족).
- GitHub Actions와 E2E: **NOT_RUN** (사용자 요청).
- 실macOS/인증 Pi/실제 workmux·tmux·Ghostty와 모델 처리 검증: **NOT_RUN**.
- 실제 설치 버전 확인: **NOT_AVAILABLE** (사용자 macOS에 접근 불가).

**결론:** 코드에 존재했던 저장 대화 탐색 결함과 결과/지표 표시의 혼동을 수정했다. 그러나 최초 사용자 경험이 실제 환경에서 끝까지 성공하는지는 확인하지 않았다. PR #3은 계속 Draft 유지하며, 다음 macOS 시나리오 A~D를 확인하기 전 '실사용 완성' 판정을 하지 않는다.
