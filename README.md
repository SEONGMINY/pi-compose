# Pi Compose

**Main에 결정과 이유를 남기고, 실제 구현은 Main의 Pi 대화를 정확히 Fork한 Work에서 수행하는 Coding Agent Harness입니다.**

Pi와 Ghostty를 그대로 사용합니다. 별도 Sidebar, Overview, 서버, 데스크톱 GUI는 두지 않습니다.

## 시작

프로젝트 디렉터리에서:

```bash
pic                 # 매번 새로운 Main 세션
pic -r              # Pi 세션 선택 후 재개
pic -c              # 가장 최근 Pi 세션 재개 (Main이라고 보장하지 않음)
pic --session <ID>   # 명시한 Pi 세션 선택
```

`pic`은 현재 터미널에서 Pi TUI를 시작합니다. 기존 세션의 복구는 Pi의 기본 기능에 맡깁니다. Work/Support를 재개하면 원래 역할이 유지되며 Main으로 바뀌지 않습니다.

## 개발 흐름

```text
Main — 요구사항, 금지 조건, 선택의 이유, 승인된 결정
  |
  +--- >w 구현할 작업           Work: 완료된 현재 Pi 대화에서 실제 Fork
  +--- >>w 별도 작업            Work + 새 Git Worktree
  +--- >s 독립 조사             Support: 독립 Pi 세션
  +--- >>s 격리된 독립 조사     Support + 새 Git Worktree
          |
          +--- <                Handoff: 사용자 요청 -> 근거 검토 -> 명시적 전송
```

각 Agent는 별도 Ghostty Split으로 실행됩니다. Split 생성 시 원래 Pi 터미널로 포커스를 돌려놓으려고 시도하며, 새 Pi의 준비나 첫 작업 완료를 보장하지는 않습니다.

- `>w @세션ID 작업`은 명시적으로 선택한 같은 프로젝트의 완료된 Pi 분기를 Fork합니다.
- Work의 원본 Pi 세션, 원본 Main의 JSONL 및 결정은 변경하지 않습니다.
- Work/Support의 개발 로그나 결과를 Main으로 자동 전송하지 않습니다.
- `< @세션`으로 Handoff 수신자를 지정할 수 있습니다. `<<`는 지원하지 않습니다.

## 완료 후 자동 후보 준비, 나중에 검토 (2026-11-09 A안)

Work가 **작업 완료를 명시적으로 보고한 것으로 판정된 경우**에만, 별도 모델 호출로 Main 공유 후보(최대 5개)를 준비합니다. 원문 Pi Entry ID와 인용문의 일치 여부를 검사하고, 결과를 **현재 Work Pi 세션의 비컨텍스트 기록에 저장**합니다. 이는 완료·테스트 성공을 독립적으로 검증했다는 뜻이 아닙니다. `agent_settled` 자체는 작업 완료 신호로 간주하지 않습니다.

`pi-ask-user`의 `ask_user` 도구가 활성화돼 있으면 Work 화면에서 **다중 선택·추가 방향 입력**을 위한 질문을 자동 요청합니다. 질문이 열린 Work 터미널로 **포커스를 옮기지 않습니다**. 다른 Agent에서 작업하던 사용자는 나중에 Work로 돌아와 응답하면 됩니다. 도구가 없다면 후보는 저장된 채로 유지되며, 도구 활성화 후 `/compose review`로 다시 열 수 있습니다. 질문 중에는 다른 모델 도구를 비활성화합니다.

`<`는 별도의 수동 Handoff 경로로 유지합니다. 저장된 후보·검토 결과를 우선 불러와 **Pi 기본 에디터 수정 → 전송 확인 → pi-intercom 요청** 순서로 진행합니다. 어느 단계에서도 사용자 승인 없이 Main으로 자동 전송하지 않습니다. 메시지 전달 성공과 Main 모델의 처리·정책 채택은 별개입니다.

## 설계와 검증 상태

- 기준: Pi 1.4.0, Ghostty의 macOS Native Split, pi-intercom 0.18.1
- 새로운 실행·Split·진행 중 Handoff 요청 코드는 [작업 브랜치](https://github.com/SEONGMINY/pi-compose/tree/feat/pic-direct-main-handoff-20261109)에 반영 중이며 **실제 macOS Ghostty/Pi 통합 검증은 아직 완료되지 않았습니다.**
- `pi-ask-user`와 연결된 모델 전용 질문 경로 및 후보 저장 코드는 작성했습니다. **사용자 Mac의 실제 Pi·ask_user 턴 통합 검증은 아직 필요**합니다.
- Main 컨텍스트를 임의로 수정하거나 정책 변경을 자동 승인하는 것은 비목표입니다.
- Orca, tmux, workmux, Herdr App/core 및 별도 멀티플렉서·서버는 도입하지 않습니다.

자세한 사용 흐름은 [Usage](docs/USAGE.md), 정책 원본은 [PRD](docs/PRD.md), 기술적 책임과 검증 항목은 [TRD](docs/TRD.md) 및 [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)을 참고하세요.
