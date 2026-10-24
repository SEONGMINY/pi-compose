# pi-compose 설계 문서

> **A composable coding agent harness built on Pi.**

- 작성 기준일: 2026-10-25 (KST)
- 범위: 합의된 제품 설계와 첫 구현 계획. **구현 코드·패키지 채택·실행 검증이 완료됐다는 뜻이 아니다.**
- 대상: 개인용이지만 여러 프로젝트·개발 환경에서 재사용할 수 있는 범용 코딩 에이전트 Harness.

## 읽는 순서

| 문서 | 책임 |
| --- | --- |
| [AS-IS와 문제](domain-stories/01-as-is-and-pain-points.md) | 실제 에이전트 사용 경험, 문제가 발생한 이유 |
| [TO-BE와 업무 시나리오](domain-stories/02-to-be-and-scenarios.md) | 사용자가 달성하려는 개발 흐름 |
| [PRD](PRD.md) | **제품 계약의 기준:** 요구사항, 비요구사항, 사용자 흐름, 수용 기준 |
| [TRD](TRD.md) | 기술 후보, 지원·미검증의 구분, 검증 전략 |
| [Architecture](ARCHITECTURE.md) | 책임·경계, 세션/작업공간/검증 흐름 |
| [Implementation Plan](IMPLEMENTATION_PLAN.md) | 순서, 검증·완료 조건, 의존성과 롤백 |
| [Phase 0 검증 기록](validation/phase0-baseline.md) | Git 사전검사 결과와 **기술 연동 검증의 비차단 연기** |
| [Phase 1 Launch](validation/phase1-launch.md) | 공통 실행 명령 첫 구현, 단위 테스트, 알려진 제약과 남은 연동 |
| [Phase 2 Dashboard](validation/phase2-dashboard.md) | 기존 workmux 대시보드 연결, 실행 검증 범위, 상태 Hook 제약 |
| [ADR 0001](adr/0001-context-and-delegation.md) | 고품질 컨텍스트, Fork와 독립 세션의 구분 |
| [ADR 0002](adr/0002-user-controlled-execution.md) | 사용자 통제와 실행 옵션의 독립성 |
| [ADR 0003](adr/0003-composable-execution-and-verification.md) | 기존 도구의 조합, Handoff, 독립 검증 |

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
- **미검증:** 최신 Pi와 workmux의 실사용 통합, Shared Directory 재개·대시보드 관찰, Fork 후 계약 맥락 보존, Handoff와 기본 검사 연결.
- **현재 진행:** Phase 0은 부분 검증 상태로 종료. Phase 1 Launch CLI(`bin/pi-compose.ts`, `src/launch.ts`)·Pi Extension(`extensions/compose.ts`)를 TypeScript로 전환하고 Zod 경계 검증을 적용. `tsc --noEmit` 및 24개 테스트 통과. Pi Session Manager 기반 Fork 원본 선택과 사용자 확인형 자연어 Launch Tool도 구현. Phase 2는 기존 workmux 대시보드를 CLI·Pi 명령에서 여는 연결을 추가하고, 대시보드 위임 테스트 6개를 실실행해 통과했다. 전체 타입 검사·Pi 실연동은 미검증. 실제 Pi/workmux 실행·대시보드 연동은 아직 미검증.

이 문서가 프로젝트별 `AGENTS.md`의 대체물이라는 뜻은 아니다. 구현 단계에서는 레포의 실제 구조와 규칙을 확인한 뒤 필요한 최소 진입점만 추가한다.
