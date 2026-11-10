# Pi Compose

Pi Compose는 **Main에서 결정과 이유를 보존하고, 실제 개발을 별도 Work로 분리하는 Pi 기반 Coding Agent Harness**입니다. Work는 Pi 대화의 선택한 완료 지점을 실제 Fork하고, Support는 독립적인 탐색·검증을 수행합니다. Main의 맥락과 사용자의 의사결정권을 훼손하지 않으며 Pi Extension의 유연성을 유지합니다.

## Top-level building blocks

- `bin/` — `pic`과 실행 진입점
- `extensions/` — Pi Extension, 위임 및 Handoff
- `src/` — 세션·Fork·Ghostty·Git 및 Handoff 데이터 처리
- `packages/optional/` — 선택형 기능
- `test/` — 검증 코드
- `docs/` — 비전·문제·요구사항·설계·결정·검증 기록

관련 문서의 역할과 위치는 [docs/README.md](docs/README.md)를 참고합니다.
