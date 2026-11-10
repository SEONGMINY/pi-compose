# Pi Compose

> **현재 `main` 코드 기준:** `pic`을 인자 없이 실행하면 아직 **Overview**가 열립니다. 아래에 설명하는 `pic` 직접 Main 진입, `>w`/ `>s` 직접 위임과 간소화된 Work `<` → Main 수신 알림은 **목표 UX**입니다. 새 실행 흐름은 [Draft PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에 코드로 작성 중이고, `main`에는 아직 병합되지 않았습니다. 이 문서 병합만으로 실행 동작은 바뀌지 않습니다.


**Main의 설계·결정 맥락을 지키면서, 실제 개발은 그 대화를 Fork한 Work에서 진행하는 Pi 기반 Coding Agent Harness입니다.**

Pi와 Ghostty의 기존 세션·Extension·터미널 기능을 조합합니다. 별도 Sidebar, Overview, 서버나 데스크톱 GUI를 만들지 않는 방향입니다.

## 개발 흐름

```text
Main    문제·계약·선택 이유·확정된 결정
  │
  ├── Work     실제 Pi 대화 Fork → 구현·수정·테스트 코드 작성
  └── Support  독립 탐색·조사·테스트 실행

Work 결과 → 사용자 검토 → Main에는 수신 알림만
                         └── 사용자가 선택한 내용만 명시적 반영
```

## 목표 명령과 위임 (현재 main 미지원)

```bash
pic                  # 새 Main
pic -r               # Pi 기본 저장 세션 선택
```

Pi 입력창의 `>w 작업`은 현재 완료 대화를 Fork한 Work, `>s 작업`은 독립 Support를 시작합니다. `>>w`, `>>s`는 각각 새 Git Worktree에서 시작합니다. 세션과 파일 작업 공간은 서로 다른 선택입니다.

## Handoff의 목표 경험

Work의 `<`에서 **전달할 결과와 근거를 확인하고 Main에 보냅니다.** Main은 결과가 도착했다는 알림만 표시하고, 본문을 자동으로 모델 컨텍스트에 넣지 않습니다. 사용자가 결과를 확인하고 명시적으로 반영합니다. 별도 Inbox 명령을 필수 경로로 만들지 않습니다.

**구현 상태:** [Draft PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에서 명시적 `<` Context Review 및 Main `<` 수신 경로를 코드로 연결했습니다. 자동 `ask_user` 및 `/compose inbox`는 최신 실행 경로에서 사용하지 않습니다. **검증은 별개**이며 macOS/Ghostty E2E 완료 전에는 프로덕션 준비가 끝났다고 주장하지 않습니다.

[사용 흐름](docs/USAGE.md) · [문서 안내](docs/README.md) · [제품 요구사항](docs/PRD.md)
