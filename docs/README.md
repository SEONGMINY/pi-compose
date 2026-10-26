# pi-compose 설계 문서

> **A composable coding agent harness built on Pi.**

- 작성 기준일: 2026-10-25 (KST)
- 범위: 합의된 제품 설계와 첫 구현 계획. **구현 코드·패키지 채택·실행 검증이 완료됐다는 뜻이 아니다.**
- 대상: 개인용이지만 여러 프로젝트·개발 환경에서 재사용할 수 있는 범용 코딩 에이전트 Harness.

## 읽는 순서

| 문서 | 책임 |
| --- | --- |
| [사용 가이드](USAGE.md) | **처음 사용하기:** 실행, Fork/Independent, 이전 작업 복귀, 선택형 Handoff·검증 명령 |
| [AS-IS와 문제](domain-stories/01-as-is-and-pain-points.md) | 실제 에이전트 사용 경험, 문제가 발생한 이유 |
| [TO-BE와 업무 시나리오](domain-stories/02-to-be-and-scenarios.md) | 사용자가 달성하려는 개발 흐름 |
| [PRD](PRD.md) | **제품 계약의 기준:** 요구사항, 비요구사항, 사용자 흐름, 수용 기준 |
| [TRD](TRD.md) | 기술 후보, 지원·미검증의 구분, 검증 전략 |
| [Architecture](ARCHITECTURE.md) | 책임·경계, 세션/작업공간/검증 흐름 |
| [Implementation Plan](IMPLEMENTATION_PLAN.md) | 순서, 검증·완료 조건, 의존성과 롤백 |
| [Phase 0 검증 기록](validation/phase0-baseline.md) | Git 사전검사 결과와 **기술 연동 검증의 비차단 연기** |
| [Phase 1 Launch](validation/phase1-launch.md) | 공통 실행 명령 첫 구현, 알려진 제약과 남은 연동 |
| [Phase 2 Dashboard](validation/phase2-dashboard.md) | **기본 Launch와 선택형 workmux View 분리**, 실행 검증 범위, 상태 Hook 제약 |
| [Phase 3 Resume](validation/phase3-resume.md) | 기존 Worktree 상태 확인, 정확한 Pi 세션 재개, 안전한 재시도 및 남은 한계 |
| [Phase 6 통합](validation/phase6-integration.md) | 격리된 Git API/UI 통합 결과, 실제 다중 에이전트 미검증 범위, 사용 흐름 |
| [ADR 0001](adr/0001-context-and-delegation.md) | 고품질 컨텍스트, Fork와 독립 세션의 구분 |
| [ADR 0002](adr/0002-user-controlled-execution.md) | 사용자 통제와 실행 옵션의 독립성 |
| [ADR 0003](adr/0003-composable-execution-and-verification.md) | 기존 도구의 조합, Handoff, 독립 검증 |
| [ADR 0004](adr/0004-pi-native-optional-views.md) | 사용자 확정: Pi 기본 Package 중심 조합, 선택형 View와 비필수 Dashboard |
| [ADR 0005](adr/0005-pic-entry-and-pi-settings.md) | 단일 전역 `pic` 진입점과 Pi 설정 공유, 선택형 Package 구성 |
| [ADR 0006](adr/0006-github-installer.md) | macOS 한 줄 설치·업데이트, 기존 Pi 환경 보존 |
| [설치·진단](SETUP.md) | 최초 1회 승인, 버전별 설치, 중복 방지, 장애 복구 |
| [다섯 가지 실전 시나리오](SCENARIOS.md) | Fork 개발, 독립 조사, 기능/프로젝트 전환, Handoff·Verify |
| [UX 진단 및 지표](UX_DIAGNOSTICS.md) | 로컬 행동 이벤트·내보내기·지표·분석 한계 |
| [ADR 0009](adr/0009-automatic-default-and-ux-diagnostics.md) | 기본 자동 설치·외부 Hook 승인·프라이버시 진단 |
| [ADR 0008](adr/0008-first-run-setup.md) | 최초 실행 권장 구성·설정 승인·Pi/workmux 정본 활용 |
| [ADR 0007](adr/0007-reference-led-navigation.md) | **PR #3 B안:** Pi Native 선택, workmux Dashboard, Pi 세션 탐색, Handoff 결과 회수와 책임 경계 |

## 문서 간 우선순위와 변경 원칙

1. **사용자의 명시적인 결정·금지사항이 최우선**이다. 에이전트의 관찰이나 제안, Handoff, 검사 통과는 사용자의 새 승인으로 취급하지 않는다.
2. **제품 요구사항은 [PRD](PRD.md)** 에서 관리한다. 다른 문서는 계약을 임의로 확대하거나 약화시키지 않고 PRD를 참조한다.
3. 기술 선택·공개 패키지의 상태는 [TRD](TRD.md)에서 관리한다. 제품 요구사항이 충족되지 않는다고 해서 기능을 조용히 제거하지 않는다.
4. **ADR은 실제 영향이 큰 결정에만** 작성한다. 사소한 선택마다 파일을 만들지 않는다.
5. 새 프로젝트에 적용할 때는 **그 프로젝트의 기존 `AGENTS.md`·명세·코드**를 발견·존중한다. pi-compose가 모든 프로젝트의 계약을 복제·대체하지 않는다.
6. **확정 / 추천 / 검증 필요 / 제외**를 구분한다. 공개 소스에 기능이 있다는 사실과 현재 환경에서 실제 동작했다는 사실을 혼동하지 않는다.
7. 문서 자체가 필수 Gate·체크리스트 관료주의가 되지 않게 한다. 목적은 정확한 의사결정과 재작업 감소다.

## 설계의 변하지 않는 기준

- Main Agent의 고품질 컨텍스트, 특히 **결정의 이유와 강한 금지의 뉘앙스**를 보호한다.
- 맥락 의존 개발은 Main 컨텍스트 Fork, 독립 조사·탐색·테스트·검증은 독립 컨텍스트를 우선 검토한다.
- **컨텍스트 모드 / 작업 공간 / 실행 순서·병렬성은 서로 독립**으로 선택할 수 있어야 한다.
- 개발 에이전트는 사용자가 **명시적으로 요청·선택한 경우에만** 실행한다. Main이 자체적으로 개발 작업을 스케줄링하지 않는다.
- 사용자의 반복적인 Pi·Git·tmux 조작을 줄이되, 자체 Runtime·범용 작업 관리 엔진을 만들지 않는다.
- 코드 인계는 간결하게; Main이 대규모 Diff·검사 로그를 직접 소화하지 않도록 독립 검증에서 결론과 근거 위치만 전달한다.
- 검증과 Git 통합은 다르다. **실제 통합 시점은 사용자 선택**이며, 검증은 필요에 비례한다.
- 도구 조합의 실패나 정리 작업으로 사용자 코드를 무단 삭제하지 않는다.

## 상태

- **제품 방향과 핵심 제약:** 합의됨.
- **우선 검토 기술:** Pi, Git, tmux, workmux. 외부 대시보드·통신 패키지는 검증 후 선정.
- **확인:** 격리 Ubuntu runner에서 Pi·workmux·tmux 실설치, Shared Launch·Resume·Worktree 생성 및 최신 TypeScript/Extension 테스트 통과. **미검증:** 사용자 환경의 세션 Fork 의미 보존, Dashboard 관찰, 실제 모델 Handoff·Reviewer 수신/검증.
- **현재 진행:** Phase 0은 부분 검증으로 종료. Launch, 선택형 View, 정확한 Resume, **선택형 Handoff와 선택형 독립 검증**을 구현했으며 일부 Pi/workmux Launch·Resume 연동은 격리 환경에서 검증했으며, 모델이 참여하는 실사용 통합은 해당 시점에 검증한다. 자동 테스트는 **Pi Extension 핵심 동작**에 집중하고, CLI·Git·tmux 조합 테스트는 정리했다. 구체적인 현재 상태는 [Implementation Plan](IMPLEMENTATION_PLAN.md)을 참조한다.

이 문서가 프로젝트별 `AGENTS.md`의 대체물이라는 뜻은 아니다. 구현 단계에서는 레포의 실제 구조와 규칙을 확인한 뒤 필요한 최소 진입점만 추가한다.


## PR #3 기준 구현 참고 (2026-10-26)

초기 설계 기록과 현재 코드는 구분해서 읽어야 합니다. 이후 PR #3의 자동 기본 설치·행동 진단 정책은 ADR 0009가 우선합니다. PR #3은 경량 Agent 선택기로 `/compose`를 사용하고, `/compose monitor`를 workmux Dashboard에 연결합니다. 과거 기능 대화 복귀는 `/compose sessions`(Pi의 기존 세션 저장소), Worktree 결과 확인은 정확히 연결된 Handoff/Verify 증거를 활용합니다. Ghostty 탭 자동화와 별도 상태 파서는 제거했습니다. 자세한 근거는 [ADR 0007](adr/0007-reference-led-navigation.md), 수동 실사용 조건은 [검증표](validation/task-hub-ux.md)를 참고하세요.
