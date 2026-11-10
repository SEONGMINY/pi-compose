# Pi Compose

Pi Compose는 **설계와 의사결정의 맥락을 Main에 보존하면서 실제 개발을 분리하는 Pi 기반 Coding Agent Harness**입니다. Main은 중요한 사실·제약·결정과 이유를 유지하고, Work는 선택한 Pi 대화의 완료 지점을 실제 Fork하여 구현하며, Support는 맥락을 상속하지 않는 독립 작업을 수행합니다. Work의 결과가 Main의 새로운 결정으로 자동 채택되어서는 안 됩니다.

## 주요 구성 요소

- `bin/` — `pic` 등 사용자 실행 진입점
- `extensions/` — Pi Extension 및 Agent 위임·Handoff 상호작용
- `src/` — 세션·Fork·Git 작업 공간·Ghostty 실행과 상태 관리
- `packages/optional/` — 선택형 Pi 기능
- `test/` — 동작 검증
- `docs/` — 제품 문제·요구사항·기술 설계·결정의 원본 문서

## 필요한 문서 찾기

- [Vision](docs/VISION.md): 프로젝트가 지향하는 개발 경험
- [Problem Statements](docs/PROBLEM_STATEMENTS.md): 사용자가 실제로 표현한 문제
- [PRD](docs/PRD.md): 현재 제품 요구사항과 결정 상태
- [Architecture](docs/ARCHITECTURE.md) / [TRD](docs/TRD.md): 구조와 기술 계약
- [문서 안내](docs/README.md): 나머지 문서의 위치와 역할
