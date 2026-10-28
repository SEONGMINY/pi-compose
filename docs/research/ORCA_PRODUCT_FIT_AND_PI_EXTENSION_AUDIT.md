# Pi Compose × Orca — 원본 기반 제품·아키텍처 적합성 조사

> 상태: **조사·설계 제안 / 구현 미승인** · 2026-10-28
> 작업 원칙: **Pi Compose 핵심 가치 > Orca 기능 보존 > 신규 기능 추가**
> 이 브랜치는 분석 문서만 보유한다. 기존 feature 브랜치, 원본 Pi 세션, Worktree, CI, 테스트 코드는 변경하지 않는다.

## 0. 조사 범위와 신뢰 수준

- Orca 공식 docs/site의 First Session, Worktrees, Agents & Sessions, Agent Session History, Tabs/Panes, Settings, Orchestration, Chat UI, Hooks, hibernation, Diff, UX 스타일 가이드를 읽었다.
- Orca 소스에서 Pi RPC launch/session/resolution/history, agent hooks, Plugin manifest/host API, sidebar, terminal/tab 생성, Worktree 계보·연결 코드를 확인했다.
- 기준 Orca 버전은 기존 실험이 고정한 **4a39d186da72a496b29a9ec5c523bbbf0a3460d8**. 현재 `main`은 조사 시점 기준 해당 버전보다 159개 커밋 앞서 있어 업스트림 업데이트 비용을 별도로 고려한다.
- Pi v1.4.0의 Session, SDK, Extension, RPC 및 Extension UI 문서를 확인했다.
- 기존 Pi Compose ADR 0001/0002/0003과 feat/orca-predictable-workflows 구현을 비교했다.
- 저장소 전체 모든 코드 실행 경로·모든 파일을 읽거나 macOS GUI에서 실기 검증한 것은 아니다. 파일 트리와 관련 기능의 원본 구현을 중심으로 확인했다. 소스가 뒷받침하지 않는 결론은 추론이라고 명시한다.

## 1. 사용자 가치와 변경 불가 계약

1. **고품질 Main 컨텍스트**: 요구사항·설계·금지 근거·우선순위 및 배제한 대안을 원본 Pi 대화에 축적한다. 한 제품에 여러 Main이 있을 수 있다.
2. **Work의 정확한 계승**: 특정 Main의 명시된 활성 세션 분기 지점에서 별도의 Pi 대화를 생성한다. 간단한 위임 요약으로 대체하지 않는다. Main 대화는 개발 로그로 오염시키지 않는다.
3. **Support의 독립성**: 탐색·리서치·테스트·검증은 독립 Pi 컨텍스트. 관련 Main 아래에 표시할 수 있지만 '상속'으로 취급하지 않는다.
4. **Pi Extension 유연성**: 사용자가 설치·구성한 모델, Tool, Extension, Skill, MCP, 가상 모델 등 Pi 기능을 IDE가 임의로 제거·대체하지 않는다.
5. **정책의 독립성**: Fork/Independent vs Shared/Worktree vs 순차/병렬은 별개 선택. 사용자 승인 없이 Agent 생성·병합·정리·계약 변경 금지.
6. **사실에 근거한 완료·상태**: Pi turn 종료, Orca idle, Git diff 존재, Work handoff, 계약 검증, 코드 병합은 서로 다르다.

## 2. Orca가 이미 제공하는 것 (다시 만들지 않기)

| 기능 | 공식/코드 근거 | 보존할 동작 |
| --- | --- | --- |
| 프로젝트와 Worktree | `docs/site/content/docs/model/worktrees.mdx` | 생성·상태·계보·검색·표시·복구·사용자 확인 후 정리 |
| 기존 Agent 세션 | `docs/site/content/docs/model/agents-sessions.mdx` | 세션 이름, 표시, 실행/대기/완료, Restart, 대시보드 |
| 과거 Pi 대화 찾기 | `docs/site/content/docs/agents/session-history.mdx` | 탐색·검색·프로젝트 범위·원본 경로·실제 `pi --session <path>` Resume·드래그 |
| 탭·분할·복원 | `docs/site/content/docs/model/tabs-panes-splits.mdx` | 기존 탭 이동, drag split, Worktree별 레이아웃 기억 |
| 코드 리뷰 | `docs/site/content/docs/review/annotate-ai-diff.mdx` | 파일별 diff, 라인 댓글, 한 번에 Agent에게 전달 |
| Agent 상태 통합 | `src/main/agent-hooks/README.md` | Pi OSC 7501 상태 지원 및 기존 hook 우선순위 |
| Pi RPC 구조화 Chat | `src/main/pi/rpc-launch.ts`, `rpc-session.ts`, `rpc-launch-resolution.ts` | native chat, 명시적 Pi 세션 resume/fork, history와 provider 링크 관리 |
| 역할과 실행 관리 | `docs/site/content/docs/cli/orchestration.mdx` | Run/Task/Dispatch/Worker/Message/Gate. 필요할 때만 사용, 기본 자동 위임 금지 |
| Plugin 시스템 | `src/shared/plugins/plugin-manifest.ts`, `plugin-host-api.ts` | 기존 manifest, out-of-process worker, panels/commands/events/capabilities |
| Worktree 환경과 설정 | `docs/site/content/docs/model/orca-yaml.mdx`, `docs/site/content/docs/settings.mdx` | 설정 스크립트, 공유 경로, 시작 탭, 단축키, Provider 설정 |

### 이미 존재하지만 곧바로 재사용해서는 안 되는 부분

- Orca의 **Parent workspace**는 사이드바 계보일 뿐 Git 역사도, Pi 대화 상속도 바꾸지 않는다. 단지 Worktree의 부모가 Main 컨텍스트의 부모인 것은 아니다.
- Orca의 **Orchestration worker-start**는 Dispatch·추가 지침·worker_done·메시지 동작을 포함한다. 자동 전제가 추가될 수 있으므로 Work가 정확한 Main Fork를 필요로 할 때 이를 기본 실행 경로로 간주할 수 없다.
- Orca의 Agent Dashboard 상태는 `working/waiting/done/idle` 등 실행 신호다. 사용자의 요구사항 준수·작업 완료 승인을 뜻하지 않는다.
- Orca의 Worktree 삭제는 디렉터리·브랜치 제거 가능성이 있다. 사용자가 보존 중인 Main/Work Pi 대화와 Git 변경의 생명주기에 동일한 삭제를 묶지 않는다.
- Orca의 세션 복귀와 Pi SDK의 정확한 Fork는 별개다. 같은 cwd에서 `--session`은 원본을 다시 열 수 있으므로 Work는 반드시 **새 세션**으로 만들어야 한다.

## 3. Pi Extension과 Orca Plugin은 다른 계층

### Pi의 기능 (출처: Pi v1.4.0)

`packages/coding-agent/docs/extensions.md`에 따르면 Pi Extension은 다음을 할 수 있다.

- `registerTool`, `registerCommand`, `registerProvider`, `registerMcpServer`, `registerVirtualModel` 및 이벤트 훅
- 세션 상태 변경, 컨텍스트·시스템 프롬프트의 조건부 제어, Pi TUI의 사용자 정의 UI
- Pi 설정에서 사용자·프로젝트별로 직접 로딩되며 CLI 인수 `--extension`도 지원

`packages/coding-agent/docs/sessions.md` / `sdk.md`에 따르면 Pi는 원본 JSONL **활성 브랜치**를 다음 모델 요청의 히스토리로 사용한다. Pi의 실제 모델 컨텍스트에는 이 대화뿐 아니라 **시스템 프롬프트, 발견된 컨텍스트 파일, 도구와 Skill/Extension**이 영향을 준다. Compaction은 원문을 삭제하지 않지만 모델에 보내는 활성 내용을 축약할 수 있다.

**중요:** JSONL 복제 증명은 컨텍스트의 동일성 전체를 보증하지 않는다. cwd나 프로젝트 자원·Extension 설정이 달라질 경우 실제 모델 입력이 달라질 수 있다. 'Fork 완료 = 의미적 충실도 보장'은 금지 표현이다.

### Orca Plugin의 공개 API 제한

`src/shared/plugins/plugin-host-api.ts`의 실제 호스트 메서드는 workspace read, 특정 terminal로 text 전송, 알림, 저장소/시크릿/설정, 이벤트 구독 중심이다. `plugin-manifest.ts`는 패널/명령/agent profile을 선언할 수 있지만 **임의의 Main Pi 세션 선택과 정확한 Fork, 새로운 Orca workspace·agent lifecycle 생성**을 공개 API만으로 완성할 수 있다고 확인되지 않았다. Plugin API도 experimental이다.

따라서 **'모두 Orca Plugin으로 해결'은 현재 근거가 부족**하다. Plugin/설정으로 해결 가능한 부분은 재사용하고, 부족한 세션·실행 연결은 최소 Orca host patch + 독립된 Pi Compose domain 모듈로 검토하는 것이 합리적이다.

### Pi Chat UI의 실제 호환성 경계

`packages/coding-agent/docs/rpc-extension-ui.md`: RPC는 `select/confirm/input/editor`, `notify/setStatus/setWidget/setTitle` 일부를 전달하지만 `ctx.ui.custom()`, TUI 입력 훅, Header/Footer, 사용자 에디터 등은 비지원 또는 no-op이다.

Orca는 `src/main/pi/rpc-launch.ts`에서 `--mode rpc`, `--session`/`--fork` 경로를 가지고 있고, `rpc-launch-resolution.ts`에서 현재 cwd와 이전 Pi JSONL의 헤더를 비교해 같은 cwd이면 Resume, 다른 cwd이면 Fork로 분기한다.

**제품 함의:** 사용자의 Pi Extension 다양성을 훼손하지 않으려면 'Pi TUI가 먼저 정상 동작'해야 한다. Native Chat UI는 Extension별 지원 매트릭스가 확인된 뒤 선택적으로 제공해야 한다. 시각적 Chat UI를 기본으로 강제하는 것은 우리의 핵심 가치와 충돌할 수 있다.

## 4. 권장 시스템 경계

```text
Orca UI/Runtime (가능한 한 기존 코드)
  ├─ Repo / Workspace / Worktree / Git
  ├─ Agent Session History / Agent Dashboard / Activity
  ├─ Terminal / Native Chat / Tab Split
  └─ 최소 Pi Compose 진입점·프로비넌스 표시
                 │ 사용자 명시적 요청
                 ▼
Pi Compose Domain (작고 독립적인 부분)
  ├─ Main: 실제 Pi session identity + 사용자 지정 이름
  ├─ Work: selected Main session leaf → exact new Pi fork + 증명
  ├─ Support: 새 독립 Pi session + relatedMainId (UI 관계만)
  └─ session↔Orca workspace/terminal references (원본 대화 중복 저장 없음)
                 │
                 ▼
Pi SDK / Pi TUI / Pi Extensions (사용자의 설치·설정이 정본)
```

**관계는 별개의 3축으로 유지한다.**

1. Pi 대화 계보: `sourceSessionFile`, `sourceEntryId`, `forkedSessionFile`, `parentMainId`
2. Orca UI/Workspace 관계: `projectId`, `workspaceId`, `terminalId`, 표시 계층
3. Git 코드 관계: `cwd`, `worktreePath`, `branch`, `baseCommit`

이 중 하나를 나머지의 원본으로 가정하지 않는다. Main이 Git Worktree 1개여야 할 이유는 없고, Support가 Main 아래 보인다고 대화 상속이 일어난 것도 아니다.

## 5. 첫 사용 경험 — 기존 Orca 위에 자연스럽게 추가

1. Orca에서 프로젝트를 연다. 기존 Orca 프로젝트·Worktree 탐색/생성 UI를 유지한다.
2. Main이 없다면 **현재 Pi 세션을 Main으로 지정**하거나 **새 Main 대화 시작** 중 하나를 찾기 쉽게 노출한다. 기존 Session History의 Pi 대화 탐색·선택을 재사용한다.
3. Main 대화에서 요구사항을 정리한다. 기존 Pi TUI와 Extension/모델 설정 그대로 진행한다.
4. 사용자가 **Work 생성**을 선택하면 Main과 정확한 세션 지점을 보여준다. 별도 선택으로 Shared/Worktree와 필요할 때 동시/순차를 지정한다.
5. Fork 검증 후 Orca의 기존 Agent 실행·탭 수명주기·Git 기능으로 바로 진입한다. 실행 오류 시 Fork/Worktree를 보존하고 '준비됨 vs 실행됨'을 구분한다.
6. Support는 관련 Main 아래 탐색 가능하되 새 Pi 세션으로 시작한다. 긴 리서치·도구 출력은 Main에 자동 전송하지 않는다.
7. Orca의 기존 Agent Dashboard/History/Diff에서 확인한다. Main 복귀 시 모델 대화로 자동 입력하지 않고, 사용자 선택에 의한 짧은 결론 또는 근거만 전달한다.

## 6. 기존 Pi Compose 실험에서 지워야 할 중복 책임

- 자체 Ghostty/Electron 창·터미널 상태·탭/분할 렌더링
- 기존 Orca Agent/Workspace 목록과 별도 경쟁하는 전체 프로젝트 트리
- Pi OAuth 흐름을 다시 만든 별도 로그인 모달
- Orca Diff/리뷰와 중복되는 자체 Git Diff 화면
- Main 컨텍스트의 자동 '핵심 결정' 추측·무분별한 자동 메모/자동 작업 계획

기존 `src/orca/agent-sessions.mjs`에서 세션 식별·복제 불변식과 Source of Truth 원칙은 **검증 후** 재사용 후보. `orca-overlay/PiComposeMenu`, `PiComposeOutline`, 수동 `createNewTerminalTab()` 및 자체 `git worktree add`는 Orca 공식 실행 경로에 통합 가능한지 재평가해야 한다.

## 7. 확인된 미해결 설계·구현 리스크

| 항목 | 현재 상태 | 개발 전 확인/결정 |
| --- | --- | --- |
| Main의 소속 | 여러 Main이 가능하나 Orca Worktree와 다른 객체 | **Main=Pi 세션**, Worktree=선택적 실행 장소가 타당한지 사용자 합의 |
| 정확한 Fork | Pi JSONL과 Orca RPC 모두 Fork 수단 존재 | 동일 cwd/다른 cwd에서 원본 오염 없이 fork, branch leaf 및 file 존재 확인 |
| Extension 호환 | TUI는 Pi 전용 UI까지, RPC는 일부 no-op | Pi 설정·툴·Provider/Extension을 유지할 기본 실행 방식 결정 |
| 기존 UI 재사용 | Orca Session History/Agent Dashboard/Tab split 보유 | 핵심 경로 추가만으로 완료 가능한 화면/필수 host hook 구분 |
| Orchestration | Run/Dispatch/preamble·자동 worker 관리 기능 보유 | 명시 실행 계약과 충돌하므로 MVP 기본 위임 금지 권고 |
| 작업 폴더 | Orca Worktree는 작업과 Git 실행 중심 | Shared/Fork 등 4조합 모두 허용, UI 계보와 코드 경로 별도 |
| 확인/완료 | Orca status와 Work handoff는 다름 | 상태별 증거와 사용자 다음 행동 별도 표기 |
| 재시작·복귀 | Orca Pi resume/hibernation 지원 | 최초 지시 재전송 방지, 세션 복귀와 새 Fork 구분 |
| 원본 보존 | Orca Worktree delete/sleep descendants 존재 | Pi Main·Work 영속성과 Git 삭제 범위 분리 |
| 업스트림 | pinned SHA와 `main` 사이 여러 변경 | 최신 고정 버전과 작은 host patch, 수정 포인트 목록 관리 |

## 8. 비교한 개발 방향

| 방법 | Orca 기능 보존 | Pi 핵심 가치 보존 | 장기 비용 | 평가 |
| --- | --- | --- | --- | --- |
| Orca Plugin만 사용 | 높음 | 세션·생성 API 공백 가능 | 낮음 | 현재 공개 API만으로는 불충분 |
| **Orca 기반 최소 host patch + 독립 Pi Compose Domain** | 높음 | 정확한 세션 경계 보장 가능 | 중간 | **권장** |
| Orca UI를 재구현한 Pi Compose 앱 | 낮음 | 구현 가능하지만 UX 중복 큼 | 매우 높음 | 기존 실패 방식, 지양 |
| Orca Orchestration으로 전면 위임 | 높음 | 추가 preamble·자동 위임/역할 혼동 가능 | 중간 | Core default로 부적합, 필요할 때만 선택 |

## 9. 개발 전에 사용자와 합의할 첫 결정

**제안 A(권장): Main Agent는 Git Worktree가 아닌 '영속적인 Pi 설계 대화' 자체를 가리킨다.** Orca의 Worktree는 선택한 Agent의 파일 실행 위치이며, Pi 대화의 부모 관계와 분리한다. 이는 기존 ADR 0001/0002의 다중 Main·Fork/Workspace 독립성에 부합한다.

대안 B: Main을 Orca의 특정 Worktree와 반드시 1:1로 연결한다. Orca UI는 단순하지만 여러 Main을 한 프로젝트에서 운용하거나 Shared/Fork 조합을 사용할 때 제약과 중복을 초래한다.

A에 합의하면 다음에 기존 Session History·Agent Dashboard·Orca launcher를 정확히 연결하는 최소 host 변경안을 파일 단위로 제시한다. **지금은 기능 구현·테스트·CI 없이 방향만 결정한다.**

## 근거 URL (버전 고정)

- Orca Worktrees: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/model/worktrees.mdx
- Orca Agents & Sessions: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/model/agents-sessions.mdx
- Orca Session History: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/agents/session-history.mdx
- Orca Tabs/Panes: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/model/tabs-panes-splits.mdx
- Orca Orchestration: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/site/content/docs/cli/orchestration.mdx
- Orca Pi RPC launch: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/rpc-launch.ts
- Orca Pi RPC resolution: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/pi/rpc-launch-resolution.ts
- Orca Plugin API: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/plugins/plugin-host-api.ts
- Orca Plugin manifest: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/shared/plugins/plugin-manifest.ts
- Orca Agent status: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/src/main/agent-hooks/README.md
- Orca UX rubric: https://github.com/stablyai/orca/blob/4a39d186da72a496b29a9ec5c523bbbf0a3460d8/docs/styleguide/ux-review-rubric.md
- Pi Sessions v1.4.0: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sessions.md
- Pi SDK v1.4.0: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md
- Pi Extensions v1.4.0: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md
- Pi RPC UI limitations v1.4.0: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-extension-ui.md
- 기존 제품 계약: https://github.com/SEONGMINY/pi-compose/tree/feat/orca-predictable-workflows/docs/adr
