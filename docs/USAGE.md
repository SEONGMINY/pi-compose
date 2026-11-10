# Pi Compose 사용 가이드

**현재 동작**과 **다음 버전의 목표 UX**를 분리합니다. 기준은 `main` 커밋 `da99d71` (2026-11-11 확인)입니다.

## 1. 현재 `main`의 사용법

macOS Ghostty에서 Pi Compose가 설치된 상태로 프로젝트 디렉터리에서 실행합니다.

```bash
cd /path/to/project
pic
```

`pic`은 현재 **Overview TUI**를 시작하고 이 프로젝트의 Main을 별도 Ghostty Split으로 열거나 기존 Split에 포커스하려고 시도합니다. 동일 디렉터리의 저장된 Main이 여러 개이거나 프로세스 상태가 불확실하면 자동 재개하지 않고 사용자 선택을 요청합니다.

| Overview 조작 | 실제 동작 |
| --- | --- |
| `n` | 제품·표시 이름·작업 디렉터리를 입력해 새 Main 생성 요청 |
| `o` | 저장된 Pi Main 세션을 명시적으로 선택·복구 |
| `1` / `2` / `3` | 프로젝트 / Agent / 메시지 목록 |
| `r` | 실행·세션 목록 다시 확인 |
| `v` | 선택한 Agent의 출처 기반 요약 확인 |
| `q` | 실행 Agent 유지 또는 확인된 Agent 종료 등 종료 옵션 선택 |

Main Split이 생겼다는 사실이 Pi 프로세스 시작·모델 로그인·업무 완료를 증명하지는 않습니다. 실패한 경우 실제 Ghostty Terminal과 Pi 출력에서 상태를 확인하세요.

`pic -r`과 `pic -c`는 Overview 대신 **Pi 자체의 세션 선택/최근 세션 재개 옵션**으로 전달됩니다. 최근 세션이 반드시 Main은 아닙니다. `main`에 남아 있는 이전 `>w`·`<` 구현을 아래 목표 동작과 동일하다고 간주하지 마세요.

## 2. 다음 버전의 목표 사용 흐름 — 현재 `main` 미반영

| 입력 | 목표 |
| --- | --- |
| `pic` | 별도 Overview 없이 새 Main 직접 시작 |
| `>w 작업` / `>>w 작업` | 현재 Pi 완료 분기를 실제 Fork한 Work, 또는 Worktree 분리 |
| `>s 작업` / `>>s 작업` | 독립 Support, 또는 Worktree 분리 |
| `>w @세션 작업` | 같은 프로젝트의 명시적으로 선택한 세션 Fork |
| Work의 `<` | 대상·결과·필수 근거를 검토한 뒤 명시적 승인으로 발송 |
| Main의 결과 알림 | 자동 컨텍스트 주입 없이 수신; 사용자가 확인·선택해 반영 |

Git Worktree는 미커밋 변경을 자동 복제하지 않으며, Handoff와 Git 병합은 별개입니다. Work 결과도 사용자 승인된 정책이나 실제 테스트 통과로 자동 승격되지 않습니다. 전체 제품 계약은 [PRD](PRD.md)를 기준으로 합니다.

## 3. 구현·검증 상태는 어디서 확인하나요?

- **현재 실행 가능한 코드:** `main`의 `bin/pic.mjs`와 실제 설치 환경
- **진행 중인 직접 Main/Handoff 구현:** [Draft PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)의 최신 Diff·CI·검증 기록
- **과거 P1–P5 감사:** [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md) — 해당 시점의 코드/실험 자료이며 최신 PR 전체 검증이 아님
- **남은 확인 항목:** [Implementation Plan](IMPLEMENTATION_PLAN.md)

새 흐름의 상세 테스트 키 조합은 실제 코드 변경에 따라 달라질 수 있으므로 이 문서에서 고정하지 않습니다.
