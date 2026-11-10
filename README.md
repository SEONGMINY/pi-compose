# Pi Compose

**Main에서 중요한 결정과 이유를 보존하고, 맥락이 필요한 구현은 실제 Pi 대화를 Fork한 Work에서 진행하는 Coding Agent Harness입니다.** 독립 조사·테스트는 Support로 분리하며, 결과를 Main에 반영할지는 사용자가 결정합니다.

## 현재 `main`에서 실행

> **코드 기준:** `main` `da99d71` (2026-11-11 확인). 아래는 현재 진입점의 실제 동작이며, 다음 목표 UX와 다릅니다.

macOS Ghostty에서 Pi와 Pi Compose를 설치한 뒤 프로젝트 디렉터리에서 실행합니다.

```bash
cd /path/to/project
pic
```

현재 `pic`은 **Overview를 표시**하고 현재 프로젝트의 Main을 별도 Ghostty Split에서 열거나 포커스하려고 시도합니다. 기존 Main이 여러 개이거나 실행 상태를 확정할 수 없다면 자동 선택하지 않습니다. Split 생성과 모델 실행 성공도 서로 다른 상태입니다.

Overview에서는 `n`으로 새 Main, `o`로 저장된 Main 선택, `r`로 목록 갱신, `q`로 종료 동작 선택을 할 수 있습니다. 현재 버전의 상세 절차는 [Usage](docs/USAGE.md)를 참고하세요.

## 다음 목표: Main에 바로 진입

Overview/Sidebar 없이 `pic`에서 Main을 직접 시작하고, 필요할 때 `>w`(실제 Pi Fork), `>s`(독립 Support), `>>w`/`>>s`(별도 Git Worktree)를 사용합니다. Work의 `<`에서 결과·근거를 검토해 전송하고, Main에는 수신 알림만 표시하며 사용자가 명시적으로 필요한 맥락만 반영합니다.

**이 흐름은 현재 `main`의 사용법이 아닙니다.** [Draft PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에서 구현을 검토 중이며, 코드 작성과 macOS/Pi/Ghostty 실사용 검증은 별개입니다. 세부 구현 현황은 해당 PR에서 확인하고, 완료된 기능으로 추정하지 마세요.

[Vision](docs/VISION.md) · [제품 요구사항](docs/PRD.md) · [문서 안내](docs/README.md)
