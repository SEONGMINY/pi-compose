# ADR 0004 — 이전 선택형 workmux View 결정 (대체됨)

- 당시 결정: 2026-10-25
- 현재 상태: **2026-10-30 Ghostty 단독 실행 방향으로 대체**
- 현재 정책: [PRD](../PRD.md) · [Architecture](../ARCHITECTURE.md)

## 이전에 해결하려던 문제

기존 `/compose` 명령과 tmux/workmux Dashboard를 분리하면 Pi의 Extension 유연성을 유지하면서 원치 않는 화면·상태 관리 의존성을 줄일 수 있다고 판단했습니다. 이에 기본 Launch와 선택형 View의 경계를 나눴습니다.

## 왜 변경했나?

실사용 결과, 명령어를 발견하고 Agent 작업 상태를 확인하고 결과를 Main으로 연결하는 경험이 불편했습니다. Orca 같은 별도 UI를 검토했지만 제품 전체를 이해하고 유지하는 비용이 커졌습니다.

사용자는 Pi의 실제 대화와 Extension 유연성을 유지하고 **Ghostty 하나에서 Main과 Work/Support를 확인**하기로 결정했습니다. 완료된 Work의 **Summary Overlay는 필수**이며, 별도 GUI는 필요성이 확인될 때 다시 논의합니다.

## 지금도 유지되는 원칙

- Pi의 세션·TUI·Extension을 최대한 그대로 사용합니다.
- 사용자 실행 선택과 Main 컨텍스트 보호가 우선합니다.
- 새로운 자체 런타임·대시보드를 선제적으로 만들지 않습니다.

**이전 workmux View 설치·사용 지침과 로딩 방법은 더 이상 현행 구현 계획이 아닙니다.** 과거 결정과 구현 코드는 Git 이력에 보존됩니다.
