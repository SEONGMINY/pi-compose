# Pi Compose

> **현재 `main`과 차이:** 기본 `main`의 `pic` 실행 방식은 이 문서의 목표 UX와 다릅니다. 직접 Main 진입 및 Work Handoff는 [Draft PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에 있고, 자동 승인 정책 전파와 Work-owned Handoff 개선은 [후속 Draft PR #37](https://github.com/SEONGMINY/pi-compose/pull/37)에 작성 중입니다. 후속 구현의 CI 및 실제 macOS/Ghostty 검증은 미완료입니다.


**Main의 설계·결정 맥락을 지키면서, 실제 개발은 그 대화를 Fork한 Work에서 진행하는 Pi 기반 Coding Agent Harness입니다.**

Pi와 Ghostty의 기존 세션·Extension·터미널 기능을 조합합니다. 별도 Sidebar, Overview, 서버나 데스크톱 GUI를 만들지 않는 방향입니다.

## 개발 흐름

```text
Main    문제·계약·선택 이유·확정된 결정
  │
  ├── Work     실제 Pi 대화 Fork → 구현·수정·테스트 코드 작성
  └── Support  독립 탐색·조사·테스트 실행

Main 확정 결정 → 해당 Work의 변경분 조회·적용 검토
Work 결과 → Work < 정확한 Brief 한 번 승인 → 계보·본문 검증 후 Main 참고 보고 자동 수신
```

## 목표 명령과 위임 (현재 main 미지원)

```bash
pic                  # 새 Main
pic -r               # Pi 기본 저장 세션 선택
```

Pi 입력창의 `>w 작업`은 현재 완료 대화를 Fork한 Work, `>s 작업`은 독립 Support를 시작합니다. `>>w`, `>>s`는 각각 새 Git Worktree에서 시작합니다. 세션과 파일 작업 공간은 서로 다른 선택입니다.

PR #37에서 `>r`은 기존 Work를 선택해 **같은 세션을 Ghostty Split에서 재개**합니다(Fork 아님). `>r @Work`로 이름·ID 검색이 가능하며, `>p`는 **Main에서** 미해결 정책 승인 후보를 UI로 확인·분류합니다. Work 위젯에서 승인 후보 경고가 뜨면 Main의 `>p`를 사용합니다. 이 단축어들은 모델 실행을 요구하지 않습니다.

## 정책 최신성과 Handoff의 목표 경험

Main에서 사용자가 기존 제안의 B안을 명확히 확정하면 추가 등록 조작 없이 결정의 원본·적용 범위를 확인해 관련 Work에 변경을 전달합니다. Work는 원래 Fork 세션을 유지하고 다음 안전한 모델 호출에서 변경분만 받아 자신의 개발 판단을 조정합니다. 변경이 없으면 추가 의미 분석을 시작하지 않습니다.

Work는 `<`에서 결과·WHY·검증 및 정책 최신성 상태를 확인하고 **Main에 추가될 정확한 Brief를 한 번 승인**합니다. Main은 정상적인 수신에서 의미를 다시 평가하지 않고, 원본 대상·계보·본문 해시·중복만 기계적으로 검사해 참고 보고로 기록합니다. 보고는 정책 채택이나 Git 병합이 아닙니다.

**구현 및 검증:** [Draft PR #37](https://github.com/SEONGMINY/pi-compose/pull/37)는 이 경로의 코드 구현을 포함하지만 자동 자연어 감지의 정확도·실제 Pi Hook 동작·macOS/Ghostty E2E는 아직 검증해야 합니다. 요구사항별 현황은 [정책 동기화 검증 JSON](docs/validation/policy-sync-20261111.json)에 구분합니다.

[사용 흐름](docs/USAGE.md) · [문서 안내](docs/README.md) · [제품 요구사항](docs/PRD.md)
