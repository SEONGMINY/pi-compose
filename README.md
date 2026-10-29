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
  │                              └─ 결과 Summary Overlay
  │                                 └─ 사용자가 선택해 Main에 필요한 결정 전달
  └─ 설계와 다음 의사결정을 이어감

Support · 탐색 / 자료 조사 / 테스트 실행 / 독립 검증
         └─ 맥락이 불필요한 작업은 독립 Pi 세션에서 수행
```

- **Main:** 문제 정의, 도메인 스토리텔링, 기획, API, 아키텍처, 제약, 결정과 그 이유를 축적합니다. 여러 Main을 사용할 수 있습니다.
- **Work:** 사용자가 지정한 Main의 활성 완료 대화 지점을 정확히 Fork합니다. 개발과 디버깅의 전체 기록을 Main에 자동으로 쌓지 않습니다.
- **Support:** 전체 Main 맥락이 필요 없는 독립 조사·테스트 실행 등을 처리합니다.
- **Summary Overlay:** Work의 결과와 공유할 만한 중요한 결정을 **사용자에게 자동으로 표시**합니다. 선택하면 원본 Pi 터미널 화면을 확인합니다. Main으로의 전달은 사용자 요청이 있을 때만 이루어집니다.

## 현재 제품 방향

| 항목 | 방향 |
| --- | --- |
| Agent 런타임 | [Pi](https://github.com/earendil-works/pi)와 기존 Extension 활용 |
| 터미널 | Ghostty 단독 사용; Main은 계속 보이고 실행 중인 Work/Support를 분할 표시 |
| 작업 공간 | Shared Directory 또는 Git Worktree를 작업에 맞게 선택 |
| 시작/재접속 | 사용자가 명시적으로 Agent 실행 및 이전 Main 세션 선택 |
| Main 재접속 | 선택한 Main만 실행; 과거 Work/Support는 자동 시작하지 않음 |
| 종료 | Ghostty 앱 종료 시 실행 중인 Agent도 종료; 저장된 대화·코드 삭제 아님 |
| 맥락 보존 | 원본 Pi 대화 + 기존 `docs/*` 문서; 작은 `AGENTS.md`는 문서 안내 |
| 문서화 | 명확하게 승인한 중요한 결정은 기존 문서에 즉시 반영; 새 문서는 사용자 확인 |
| Handoff | 사용자 요청 전에는 Work의 메시지·로그·결정을 Main 모델에 자동 입력하지 않음 |

**Orca 통합 및 tmux/workmux 도입은 중단했습니다.** 별도 데스크톱 GUI도 현재 개발하지 않습니다. 복잡성이나 시각적 비교의 필요성이 실제로 생길 때 다시 검토합니다.

## 구현 상태

**이 README는 새 제품 방향을 설명하는 설계 문서입니다.** 기존 코드에는 이전 tmux/workmux 기반 CLI와 Orca 실험이 남아 있고, 위 Ghostty 중심 흐름과 Summary Overlay가 실제로 완성·검증됐다는 뜻은 아닙니다. 과거 설치·명령을 새 제품의 사용법처럼 안내하지 않습니다.

현재 확정된 계약과 결정하지 않은 항목은 [PRD](docs/PRD.md)를 기준으로 확인해 주세요. 기술적 책임과 검증 범위는 [Architecture](docs/ARCHITECTURE.md)와 [TRD](docs/TRD.md), 앞으로의 구현 순서는 [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)에 정리했습니다. 기존 CLI 구현과 기록은 Git 이력에 보존합니다.
