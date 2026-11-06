# Pi Compose

**설계와 의사결정의 맥락을 Main에 유지하고, 구현은 그 대화를 정확히 이어받은 Work에서 진행하는 Pi 기반 Coding Agent Harness입니다.**

## 왜 만들까요?

서비스를 개발할 때는 요구사항뿐 아니라 선택의 이유, 도메인 정책, 버린 대안과 강한 금지사항까지 함께 논의합니다. 이를 짧은 위임 프롬프트로 다시 전달하면 중요한 뉘앙스가 사라질 수 있습니다.

반대로 Main에서 코드 탐색·구현·테스트·긴 오류 로그까지 모두 처리하면, 이후 의사결정에 필요한 컨텍스트가 소모됩니다.

Pi Compose는 **실제 Pi 세션 Fork**로 두 문제를 분리합니다.

## 어떻게 사용하나요? (설계된 경험)

```text
Main  ── 실제 Pi 세션 Fork ──▶ Work · 구현 / 테스트 코드 작성
  │                              │
  │                              └─ Handoff 검토
  │                                 └─ 사용자가 선택해 Main에 필요한 결정 전달
  └─ 설계와 다음 의사결정을 이어감

Support · 탐색 / 자료 조사 / 테스트 실행 / 독립 검증
         └─ 맥락이 불필요한 작업은 독립 Pi 세션에서 수행
```

- **Main:** 문제 정의, 도메인 스토리텔링, 기획, API, 아키텍처, 제약, 결정과 그 이유를 축적합니다. 여러 Main을 사용할 수 있습니다.
- **Work:** 사용자가 지정한 Main의 활성 완료 대화 지점을 정확히 Fork합니다. 개발과 디버깅의 전체 기록을 Main에 자동으로 쌓지 않습니다.
- **Support:** 전체 Main 맥락이 필요 없는 독립 조사·테스트 실행 등을 처리합니다.
- **Handoff 검토:** Work의 Pi 입력창에서 `<`로 받는 곳을 고릅니다. Pi 원본을 근거로 만든 초안을 사용자가 확인한 뒤 Main에 전송을 요청합니다.

## 현재 제품 방향

| 항목 | 방향 |
| --- | --- |
| Agent 런타임 | [Pi](https://github.com/earendil-works/pi)와 기존 Extension 활용 |
| 터미널 | **Ghostty만 사용**. `pic` 탭에서 관리 사이드바와 실제 Main·Work·Support Pi TUI를 **각각 독립 Split**으로 배치. 실행 중 Agent마다 Split을 유지하고 사이드바에서 해당 Split으로 포커스 이동. 배치·규모에 따른 화면 제약은 수용 |
| 사이드바 | **`pic` 실행 화면에서만 표시**. 프로덕트별 보기 / 전체 Agent 보기 / 별도 메시지 관리. Main·Work·Support를 전환해도 유지하고, 일반 Ghostty 탭에는 표시하지 않음. Main 이름에는 `Main ·` 접두어를 붙이지 않음 |
| 작업 공간 | Shared Directory 또는 Git Worktree를 작업에 맞게 선택 |
| 시작/재접속 | 사용자가 명시적으로 Agent 실행 및 이전 Main 세션 선택 |
| Main 재접속 | 선택한 Main만 실행; 과거 Work/Support는 자동 시작하지 않음 |
| 종료 요청 | **백그라운드로 유지(최소화/숨김) / 실행 중인 Agent 종료**를 사용자에게 선택받는 UX. **백그라운드 유지 시 Ghostty 자체를 종료하지 않고 살려두는 방향**이며, 창 닫기·앱 Quit 연결은 검증 필요 |
| 맥락 보존 | 원본 Pi 대화 + 기존 `docs/*` 문서; 작은 `AGENTS.md`는 문서 안내 |
| 문서화 | 명확하게 승인한 중요한 결정은 기존 문서에 즉시 반영; 새 문서는 사용자 확인 |
| Handoff | 사용자 요청 전에는 Work의 메시지·로그·결정을 Main 모델에 자동 입력하지 않음. 메시지 대기·전달·실패 등은 별도 사이드바에서 확인·관리하는 방향 |

**Orca 통합 및 tmux/workmux 도입은 중단했습니다.** **Herdr App·herdr-core·별도 멀티플렉서/프로세스 실행 계층도 현재 도입하지 않습니다.** 별도 데스크톱 GUI도 현재 개발하지 않습니다. 복잡성이나 시각적 비교의 필요성이 실제로 생길 때 다시 검토합니다.

## 구현 상태

**Draft PR #15 — 현재 4단계 코드 작성:**
- `pic` 전용 Overview의 프로덕트/Agent/메시지 탐색, `n` 새 Main 생성, `o` 저장 Pi Main 명시적 재개, Ghostty의 기존 Terminal UUID로 포커스
- Pi 1.4.0 활성 완료 분기 기반 Native Work Fork와 독립 Support, `>w`·`>s` 직접 위임, **같은 프로덕트의 `>w @` / `>>w @` 원본 선택·Pi 에디터 자동완성**
- `>>w`·`>>s`는 **명령 입력 Agent의 Git HEAD**에서 새로운 Worktree/브랜치 생성. 원본 미커밋 변경은 복사하지 않으며, 생성 브랜치·HEAD·경로를 새 Pi 신원 기록에 남김
- 사용자 선택형 `/compose handoff`, Pi 기록 기반 `/compose messages`, 실제 Ghostty Terminal 포커스 `/compose surfaces`

**모든 항목은 코드 작성이며 타입체크·macOS Ghostty/Pi/Git 실사용 통합 검증 전입니다.** 실제 Pi 프로세스/Agent 수명 관리, Summary의 경량 모델 의미 요약·중요 결정 후보, 완성된 메시지 Sidebar와 Handoff UX, 설치·종료·복구 흐름은 남았습니다. 코드가 작성됐다는 이유로 제품 전체 동작을 보장하지 않습니다. 남은 순서는 [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)을 확인해 주세요.

**5단계 Draft 코드:** Native Pi 자식 실행 래퍼에 OS 프로세스 시작/종료 영수증을 남기고, Overview에서 **Session ID + Launch ID + Terminal UUID + PID 시작 시각**을 대조해 확인된 실행 사실만 표시하도록 추가했습니다. `q` 종료 선택에서는 Agent 유지·Ghostty 숨김, **재확인된 Pi 프로세스의 Surface만 사용자 승인 후 닫기**, 취소를 구분합니다. 상태 불명 Agent를 임의로 종료하거나 저장된 Pi 대화/Git Worktree를 삭제하지 않습니다. Main 저장 세션 재개 시 실제 OS 프로세스가 관찰되면 **중복 실행을 거부**하고, 실행 여부가 불명확하면 위험을 명시적으로 확인한 사용자에게만 재개를 허용하도록 보완했습니다. **실시간 모델 상태·완전한 종료/복구는 미완성이며 Summary 사실 정보층 코드는 작성됐으나 타입/실사용 검증 전입니다.**

**Handoff 초안:** Work의 `<`에 같은 프로덕트의 수신자 추천과 원문 발췌 초안 검토를 연결했습니다. `/compose handoff`로 기존 수동 본문과 비교할 수 있습니다. Overview의 `v`는 저장된 근거 조회용입니다.

**이 README는 새 제품 방향을 설명하는 설계 문서입니다.** 기존 코드에는 이전 tmux/workmux 기반 CLI와 Orca 실험이 남아 있고, 위 Ghostty 중심 흐름, 제품/Agent 사이드바, 메시지 관리, 종료 선택 UX와 Handoff가 실제로 완성·검증됐다는 뜻은 아닙니다. 과거 설치·명령을 새 제품의 사용법처럼 안내하지 않습니다.

현재 확정된 계약과 결정하지 않은 항목은 [PRD](docs/PRD.md)를 기준으로 확인해 주세요. 기술적 책임과 검증 범위는 [Architecture](docs/ARCHITECTURE.md)와 [TRD](docs/TRD.md), 앞으로의 구현 순서는 [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)에 정리했습니다. 기존 CLI 구현과 기록은 Git 이력에 보존합니다.
