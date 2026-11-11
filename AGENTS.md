# Pi Compose

## Vision

AI Coding Agent와 장기간 협업하더라도 **설계와 결정의 맥락을 잃지 않고**, 실제 개발을 분리해 수행하며 다음 판단을 이어갈 수 있는 개발 환경을 만듭니다.

## Core Principles

- **Context Fidelity:** 결정의 이유·강한 제약·승인 여부를 전달 과정에서도 정확히 보존합니다.
- **Main Protection:** 구현·탐색·테스트 기록을 Main에 자동으로 쌓지 않고, 필요한 결과만 사용자 선택에 따라 반영합니다.
- **User Control:** Agent의 제안·보고·검증 주장과 실제 사용자 승인을 구별합니다.
- **Pi Extensibility:** Pi의 실제 세션·Fork·Extension을 활용하며 독자적인 Agent 런타임을 불필요하게 재구현하지 않습니다.

비전의 배경·대상 사용자·성공 기준의 정본은 [docs/VISION.md](docs/VISION.md)입니다.

## Top-level Building Blocks

- `bin/` — `pic` CLI와 진입점
- `extensions/` — Pi Extension 및 위임·Handoff 연결
- `src/` — 세션·Fork·Ghostty·Git·Handoff 처리
- `packages/optional/` — 선택형 기능
- `tools/development-harness/` — 내부 유지보수 계측·분석 하네스 프로토타입 (제품 런타임과 분리)
- `test/` — 검증 코드
- `docs/` — 비전·문제·요구사항·설계·결정·검증 기록

더 자세한 제품·기술 문서의 위치는 [docs/README.md](docs/README.md)를 참고합니다.
