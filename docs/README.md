# Pi Compose 문서 안내

문서는 **현재 합의와 역사적 기록을 분리**합니다. 한 가지 결정의 현재 내용은 한 곳에서 관리하고, 다른 문서는 링크합니다. 기술 문서나 과거 ADR에 적힌 이전 UI를 최신 제품 정책으로 해석하지 않습니다.

## 현재 기준 문서

| 문서 | 단일 책임 |
| --- | --- |
| [Vision](VISION.md) | 만들고 싶은 개발 경험과 지속할 가치 |
| [Problem Statements](PROBLEM_STATEMENTS.md) | 사용자의 직접 발화, 문제 상태와 출처 |
| [PRD](PRD.md) | 승인된 제품 요구사항, 비목표와 미결정 |
| [Architecture](ARCHITECTURE.md) | 컴포넌트 책임과 데이터·컨텍스트 흐름 |
| [TRD](TRD.md) | 구현 기술 계약과 확인할 검증 경계 |
| [Usage](USAGE.md) | 사용자 흐름: 확정된 목표와 아직 구현되지 않은 동작을 구분 |
| [Implementation Plan](IMPLEMENTATION_PLAN.md) | 실제 남은 작업·순서·완료 조건 |
| [Handoff 구현 감사](HANDOFF_IMPLEMENTATION_AUDIT.md) | PR #25의 코드·검증 근거 및 최신 UX와의 차이 |

## 결정과 과거 기록

- [ADR 0001–0006](adr/): 결정 배경과 채택·부분 대체·역사적 상태. 최신 요구사항의 정본이 아님
- [Domain Stories](domain-stories/): 초기 업무 흐름 분석과 과거 목표 시나리오. 직접 사용자 인용의 정본은 Problem Statements
- [Validation](validation/): 당시 환경에서 수행한 실험·검증 기록. 현재 Pi Compose 전체 E2E 검증으로 일반화하지 않음

루트 [AGENTS.md](../AGENTS.md)는 핵심 비전과 코드 위치만 소개합니다. 자세한 제품·개발 정책은 여기서 해당 정본으로 이동해 확인합니다.

## 문서 운영

확정된 제품 정책 변경은 PRD, 중요한 기술 계약 변경은 관련 Architecture/TRD, 구현 사용법은 Usage를 우선 갱신합니다. 중요한 결정의 선택 이유가 사라지지 않도록 필요한 경우 ADR에 근거를 남깁니다. Work는 구현에 부속된 설명만 수정하며 중요한 정책의 승격·변경은 Main에서 사용자 승인을 확인한 뒤 갱신합니다.

**2026-11-10 최신 결정:** Work `<` 명시적 전송 → Main 수신 알림만 → 명시적 반영; 별도 Inbox 명령을 목표 UX에 두지 않습니다. PR #25의 기존 구현·감사 기록은 이 변경이 아직 코드에 적용되지 않은 상태를 설명합니다.
