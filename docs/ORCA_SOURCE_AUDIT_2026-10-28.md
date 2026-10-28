# Pi Compose × Orca: 원본 조사 및 핵심 가치 설계 논의안

> 상태: **분석·제안만 포함**. 최종 아키텍처 확정 전이며 기능 구현/마이그레이션 지시가 아니다.
> 조사일: 2026-10-28 (KST)
> 기준: Orca upstream `4a39d186da72a496b29a9ec5c523bbbf0a3460d8` (기존 Pi Compose Orca 브랜치에서 고정한 커밋), Orca 공개 문서와 현재 저장소의 관련 코드, Pi v1.4.0.
> 범위: 제품에서 사용하는 프로젝트·세션·Worktree·Pi RPC·확장·UI·Git 경로. Orca 전체 약 4만 개 파일을 모두 한 줄씩 검토했다는 뜻은 아니다. 핵심 실행 경로의 구조 및 공식 문서 근거를 확인했고, 아래 미해결 사항은 별도로 표시했다.

## 0. 제품의 바꿀 수 없는 두 가지 가치

1. **고품질 Main 컨텍스트를 축적하고 그 컨텍스트로 개발**: Main은 제품/기능/과제별로 여러 개 만들 수 있는 장기 Pi 대화. 요구사항·설계·결정 이유·강한 제약이 보존된다. Work는 사용자가 지정한 정확한 Main의 Pi 세션을 Fork한다. Support는 Main 대화를 상속하지 않는 독립 세션. Work/Support의 로그와 결과를 Main 모델 대화에 자동으로 삽입하지 않는다.
2. **Pi의 유연성**: Pi의 Extension(도구·명령·이벤트·프로바이더·모델·UI·세션 상태)을 개발자가 자유롭게 조합할 수 있어야 한다. 새 전용 런처/번들로 기존 Pi Extension 발견·설정·기능을 축소해서는 안 된다.

판단 우선순위: **이 두 가치 > Orca의 기존 구현 보존 > 새로운 편의 기능**. 터미널 렌더러·Electron·특정 UI 스타일은 이 가치 자체가 아니다.

## 1. Orca의 기존 기능과 실제 소유자

| 영역 | Orca에서 이미 확인한 사실 | 코드·문서 근거 | 권장 처리 |
| --- | --- | --- | --- |
| 프로젝트/Worktree | 생성, start-from ref, 공유 경로, setup, 진행/실패/Retry, parent workspace, 검색/정리/복구. Parent workspace는 **UI 계보이지 Pi 세션 상속이 아님** | [Worktrees](https://www.onorca.dev/docs/model/worktrees), [lineage projection](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/sidebar-list/worktree-lineage-projection.ts) | Orca의 작업 공간을 정본으로 사용. Pi Compose가 중복 Git Worktree 엔진을 만들지 않음 |
| 실제 세션 이력 | 우측 Agent Session History에서 Pi JSONL을 찾고 `pi --session <file>`로 resume. 세션 행 드래그로 workspace에 가져오기 가능. 같은 세션의 파일이 없으면 Resume 거부 | [Session History](https://www.onorca.dev/docs/agents/session-history), [Pi session history adapter](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/pi-session-history.ts) | 자체 세션 목록·파일 스캔·재개 기능을 최소화 |
| 상태/알림 | OSC/agent hooks를 통해 working/waiting/done/idle/failed, Dashboard/Agents Feed, restart chip | [Agents & Sessions](https://www.onorca.dev/docs/model/agents-sessions), [Pi status extension](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/agent-status-extension-source.ts) | 원본 Orca 상태를 활용하고 `prepared` 같은 별도 표시와 혼동하지 않음 |
| 탭/분할/복원 | worktree별 tab group/pane, 드래그 분할, 경계 유지, 앱 재실행 후 레이아웃·실행 중 PTY reattach | [Tabs](https://www.onorca.dev/docs/model/tabs-panes-splits), [Session Restore](https://www.onorca.dev/docs/model/session-restore) | 자체 탭/PTY 렌더러 제거. 서로 다른 worktree의 탭을 한 레이아웃으로 묶는 것은 별도 제약 |
| 실행/결과 | 기존 `agent-launch-executor`가 workspace 준비, structured/terminal 선택, prompt delivery, fallback, 실패 시 복구를 담당. CLI는 중복 실행 방지용 `operationId` 기반 replay 명시 | [launch executor](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/agent-launch/agent-launch-executor.ts), [prompt delivery](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/agent-launch/agent-launch-prompt-delivery.ts), [Orca CLI](https://www.onorca.dev/docs/cli/reference) | Pi Compose 전용 shell launcher가 이를 우회하지 않게 통합 가능성 확인 |
| 리뷰 | Worktree의 start-from ref 대비 Diff, 파일 트리, 줄별 코멘트 묶음 전송, Git commit/push/PR, attribution | [Diff Viewer](https://www.onorca.dev/docs/review/diff-viewer), [Annotate AI Diff](https://www.onorca.dev/docs/review/annotate-ai-diff) | 기존 Git UI 재사용; diff/로그를 Main LLM 컨텍스트에 자동 주입하지 않음 |
| Orca orchestration | Run/Task/Dispatch/worker_done 및 worker ownership 시스템, 완료 판정과 재실행 규칙 | [Orchestration](https://www.onorca.dev/docs/cli/orchestration) | **기본 Main/Work/Support 모델과 동일하지 않음**. 필요하기 전에는 의존하지 않음 |

## 2. Pi 연동과 '확장성'의 두 층위

### 2.1 Pi 자체의 Extension은 핵심

Pi는 `--extension`, 사용자·프로젝트 extension 탐색, `registerTool`, `registerCommand`, 이벤트, 프로바이더, 가상 모델, 세션별 비컨텍스트 데이터, 터미널 UI를 지원한다.

- [Pi Extensions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md)
- [Pi Sessions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sessions.md)
- [Pi Session Format](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/session-format.md)
- [Pi CLI args](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/cli/args.ts)

**제안**: Pi Compose 핵심 세션 계보 정책은 Pi Extension/세션 API를 중심으로 유지한다. Pi 사용자의 기존 Extension 탐색·프로젝트 설정·모델 설정을 없애거나 새 CLI 래퍼 실행만 강요하지 않는다.

### 2.2 Orca의 Pi 통합은 이미 깊다

Orca `src/main/pi/`에는 별도의 RPC launch, session adapter, history, model options, 상태 Extension 구현이 있다. 특히 `buildPiRpcLaunch`는 `forkFile`을 `pi --mode rpc --fork <file>`로 연결하는 코드 경로를 이미 갖고 있다.

- [rpc-launch.ts](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/rpc-launch.ts)
- [rpc-session-adapter.ts](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/rpc-session-adapter.ts)
- [rpc-options.ts](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/rpc-options.ts)
- [agent-status-extension-source.ts](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/agent-status-extension-source.ts)

**주의**: Orca의 Pi structured chat이 `forkFile`을 내부적으로 지원한다는 사실은, 현재 Orca UI에 '정확한 선택 Main → Fork' 기능이 이미 노출돼 있다는 뜻이 아니다. UI/호스트 실제 지원 범위를 별도로 검증해야 한다.

### 2.3 Orca Plugin API는 Pi Extension이 아니다

`pluginApi: 1`은 별도 Orca 프로세스/패널 확장 계층이다. 공개 host API(현재 실험 단계): workspace.readContext, terminal.sendText, notifications.show, plugin 자체 storage/secrets/settings, events.subscribe. manifest는 panels/commands/events/agent profiles 등의 선언형 contributions를 허용한다.

- [Orca plugin host API](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/plugins/plugin-host-api.ts)
- [Plugin capabilities](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/plugins/plugin-capabilities.ts)
- [Plugin manifest](https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/plugins/plugin-manifest.ts)
- [Settings → Plugins](https://www.onorca.dev/docs/settings)

**현재 확인한 한계**: 이 공개 API만으로 특정 Main Pi 세션 Fork, Orca의 네이티브 agent launch, 탭 재배치, Worktree 생성·계보 재지정을 수행하는 메서드는 없다. 플러그인 단독으로 핵심 제품 전체를 만든다고 가정하면 안 된다.

### 2.4 Pi RPC와 TUI Extension UI 차이

Pi RPC Extension UI는 select/confirm/input/editor 및 일부 notify/status/widget을 제공하지만 `ctx.ui.custom()` 등 TUI 전용 기능은 지원하지 않거나 축소된다. Orca의 structured chat UI와 Pi TUI는 같은 경험이라고 볼 수 없다.

- [Pi RPC Extension UI](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-extension-ui.md)
- [Orca Chat UI](https://www.onorca.dev/docs/agents/native-chat)

**설계 결과**: Pi 확장성 보존이 목표이면 우선 실제 Pi TUI를 포함한 실행 경로를 보장하고, structured chat은 Extension 동작 범위를 확인한 뒤 선택 가능한 화면으로 취급하는 것이 안전하다. 전용 로그인 모달이나 모델 목록을 복제하지 말 것.

## 3. 제품 모델: 서로 다른 식별자를 혼동하지 않는다

| 개념 | 정본 | Pi Compose가 추가할 관계 |
| --- | --- | --- |
| Project | Orca Git repository/project | 여러 Main 소속 |
| Workspace | Orca worktree/folder workspace | Agent별 실행 폴더 선택; 컨텍스트와 독립 |
| Main | **Pi 세션의 정확한 ID + 저장 파일 + 활성 leaf** | 사람이 붙인 설계 주제/이름 |
| Work | **Pi가 Main의 특정 시점에서 만든 새 세션** | source Main, source session, fork 시점 leaf, 실행 폴더, Orca session/tab |
| Support | 독립 Pi 세션 | 관련 Main은 navigation 메타데이터일 뿐 내용 상속 아님 |
| Agent 실행 상태 | Orca의 실제 터미널/agent status | 준비됨과 실행 중/응답/완료의 추정치를 혼동하지 않음 |
| 코드 변경 | Git/Orca Diff | Work의 기준 SHA/Worktree와 연결하되 공유 폴더의 귀속을 추정하지 않음 |

**절대 금지**: 같은 Git 폴더 또는 Orca parent Worktree 관계를 Pi 세션 Fork 증거로 취급하는 것. Main에 Work·Support 출력 전체를 자동 주입하는 것. 하나의 Main만 있다고 가정하는 것. UI 터미널 탭 재개를 Pi 대화 신규 생성으로 취급하는 것.

### '고품질 맥락이 보존됨'을 어떻게 확인하는가

- 세션 저장 파일 및 원본 Main ID가 정확한가?
- 사용자가 선택한 **활성 대화 경로의 fork 시점**을 기록했는가?
- Pi의 parentSession 및 원본 fork 시점과 비교 가능한가?
- Compaction 후 실제 모델에 투입되는 맥락이 원본의 **전체 JSONL 텍스트**와 다를 수 있음을 표시하는가?
- Fork 이후 Main이 변경한 내용이 자동으로 Work에 전달된 것처럼 표현하지 않는가?
- 금지 제약과 이유가 모델에 실제로 전달됐는지는 별도 검토 대상으로 취급하는가?

출처: [Pi session format (branch/compaction/parentSession)](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/session-format.md), [Pi session context](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sessions.md).

## 4. 현재 Pi Compose 브랜치에서 보존/폐기/교체할 것

기준 기존 구현: `feat/orca-predictable-workflows` (이 브랜치를 수정하지 않음).

| 기존 구현 | 권장 |
| --- | --- |
| `src/orca/agent-sessions.mjs`의 Main/Work/Support 구분 및 원본 식별 계약 | **의미 유지**. 실제 Pi 세션 계보·fork 시점·JSONL/컴팩션을 기준으로 점검 |
| 독자적인 Git worktree add + Orca 작업 공간 재탐색 | **교체 검토**: Orca의 검증된 Worktree creation pipeline 활용 |
| `scripts/orca-native-bridge.mjs`와 shell launcher의 임의 실행·재개 | **교체 검토**: Orca agent launch / Session History / runtime handle로 실행 소유권 통합 |
| `PiComposeOutline` 및 별도 Agent 상태·검색 | **재설계**: Orca project / Session History / Dashboard / Activity 정보 재사용 |
| `PiComposeMenu`가 기존 '+' 및 신규 다이얼로그를 다시 정의 | **재설계**: Orca 기본 생성 진입점 내 Pi 컨텍스트 옵션 추가 여부 검토 |
| 자체 Electron·Ghostty 기반 PR #7~#10 UI | **기능 재사용 금지 우선**: Orca UI·PTY·로그인·Git Diff를 다시 만들 이유 없음 |
| 기존의 세션·Worktree·사용자 파일 | **그대로 보존**; 자동 migration, 삭제, merge 없음 |

## 5. 제안 아키텍처 (아직 확정 아님)

**Orca가 UI·프로젝트·Worktree·실제 에이전트 실행/중단·세션 이력/탭·상태·Git의 소유자**가 된다.

**Pi는 모델·도구·Extension·세션 JSONL·Fork/Compaction의 소유자**가 된다.

**Pi Compose는 선택한 Main에서 Fork된 Work 계보, 독립 Support의 관련성, 핵심 컨텍스트 보호 정책만 보유**한다.

Orca 공개 Plugin API만으로는 현재 필요한 핵심 세션 조작을 전부 표현할 수 없으므로, 초기에는 **Orca의 작은 정식 실행 경로 확장 + Pi Extension**을 후보로 본다. 기존 코드를 통째로 복제하거나 전용 런처/터미널로 우회하지 않는다. Orca 원본 전체 Fork의 유지비와 이 최소 변경 지점을 비교해야 한다.

Orca의 `orchestration`은 유용하지만 Run/DAG/worker_done 등의 의미를 이미 정의한다. Main 대화 보존이라는 Pi Compose의 핵심을 대체하거나 서브 에이전트 위임 프롬프트를 자동 주입하는 방법으로 **기본 사용하지 않는다**.

**실행 형태에 대한 제안**: 우선 Pi TUI/Extension을 원형대로 사용할 수 있게 하고, Orca Chat UI/RPC는 동일한 extension UX를 제공할 수 있는 기능에만 사용한다. 사용자가 원하면 Main만 채팅 형태로 표시하는 옵션은 이후 논의한다.

## 6. 제품 수준 검증을 위한 시나리오 (테스트 코드 작성 요청 아님)

A. 프로젝트에서 여러 Main 대화를 저장·검색·재개해도 정확한 Pi 세션이 열림.
B. Main에 설계 이유/금지 규칙을 누적 → 특정 시점의 정확한 Fork Work 생성 → Fork 원본/경계 확인.
C. Support는 메인과 관련된 작업으로 보이되 실제 세션은 독립. Support 출력이 Main 컨텍스트에 자동 삽입되지 않음.
D. 같은 Main에서 Shared 폴더 Work와 별도 Worktree Work를 모두 생성·관리.
E. Agent 창/탭 닫기, Orca 종료, 다시 열기에서 **프로세스·Pi 세션·탭 UI가 각각 어떤 상태인지** 예측 가능.
F. Work 완료 주장과 실제 Git 변경을 Orca Diff에서 대조. Main에는 선택한 핵심 판단만 전달.
G. Pi 사용자 Extension을 추가한 뒤 Main/Work/Support에서 원래 도구·명령·모델·사용자 UI가 유지됨.
H. 안전하지 않은 자동 실행, 실패한 launch, 삭제/병합, 다른 프로젝트 세션 선택을 분명히 구별.

사용자가 이전에 요청한 대로 이 단계에서는 **CI·테스트 코드·테스트 실행을 하지 않는다.**

## 7. 사용자와 다음에 합의할 중요한 선택

**우선 결정 1 — Main의 기본 실행 형태**

- **제안 A (권장)**: Main은 *Pi 원본 세션*이고 기본 사용 화면은 Orca가 제공하는 **실제 Pi TUI**. Pi Extension의 커스텀 UI·모델·도구 호환성을 우선한다. UI는 Orca의 기존 tab/history를 사용.
- **대안 B**: Main을 기본적으로 Orca의 **structured Chat UI**에서 구동. Orca-native UX는 강하지만 RPC Extension UI와 Pi TUI 전용 확장 동작이 동등하지 않으므로 기능별 호환성을 먼저 확인해야 한다.

두 안 모두 **Main이 Orca Worktree 자체라는 정의는 피한다**. Main은 Pi 세션이어야 원본 컨텍스트 계보가 보존된다.

선택 후에는 기존 Orca 생성·세션 이력·Agent 상태·Diff를 연결하는 최소 변경 지점을 설계하고, 구현 전 사용자와 다시 검토한다.

## 8. 추가 확인해야 할 사항과 정직한 한계

- Orca에는 상당히 큰 규모의 source tree가 있다. 모든 기능·테스트·실행 환경을 전수 확인한 상태는 아니다. 조사 대상은 사용자가 실제로 사용하는 핵심 경로다.
- 실제 macOS Orca GUI를 조작해 Pi TUI↔Chat UI 전환, Extension UI, 정확한 Main Fork를 재현하지 않았다.
- Orca의 `forkFile` 내부 지원과 현재 공개 GUI/CLI가 해당 옵션을 사용자에게 안전하게 노출하는지는 다르다. 사용자 UX로서의 노출 경로는 설계 단계에서 더 확인해야 한다.
- Orca의 Plugin API는 experimental. 업스트림 변동에 영향을 받으므로 실제 채택 여부를 버전/비용 기준으로 재검토해야 한다.
- Orca 기본 Agent Permissions는 자동 승인 권한을 줄 수 있다. Worktree는 OS 보안 샌드박스가 아니므로 제품의 승인 정책과 분리해 검토해야 한다 ([Supported Agents](https://www.onorca.dev/docs/agents/supported)).
- **이번 문서는 분석/제안이며 현재 Pi Compose 구현이 프로덕션 사용 가능함을 뜻하지 않는다.**
