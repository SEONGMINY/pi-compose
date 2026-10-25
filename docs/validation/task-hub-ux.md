# Pi Compose — Task Hub · Main 복귀 2차 검증 가이드

> PR #3의 후속 개선입니다. 이 문서는 **구현 계약, 직접 확인한 범위, 사용자가 검증할 항목**을 구분합니다. TypeScript 통과는 macOS Pi/Ghostty 실사용 성공을 의미하지 않습니다.

## 1. 실제 개발 흐름

```bash
cd ~/projects/my-app
pic
```

Main에서 요구사항을 논의한 뒤 사용자가 명시적으로 다음 중 하나로 실행합니다.

- 자연어: **"현재 대화 내용을 이어서 새 개발 에이전트에게 회원 API 구현을 맡겨줘. 별도 Worktree로 진행해줘."**
- 직접 명령: `/compose launch 회원 API 구현`
- 명령어 없이: 입력창 하단의 안내를 보고 **Alt+W** → **새 에이전트에게 맡기기**

다음과 같은 **검토 질문**은 실행 지시가 아닙니다.

> "회원 API 작업을 다른 에이전트에 맡기는 게 좋을까?"

명시적인 실행 요청이 있더라도 Fork/Independent와 Shared/Worktree는 독립적으로 선택할 수 있습니다. 실제 실행 전에 필요한 조건과 경로를 확인합니다. 자동 병합·삭제·Worktree 정리는 하지 않습니다.

## 2. 작업 Hub 탐색과 복귀

- `Alt+W` 또는 `/compose`로 작업 Hub를 엽니다. macOS에서 Option 키가 문자로 입력되면 `/compose`를 사용하세요.
- **현재 화면**을 표시합니다. 이번 `pic` 진입점에서 실행 중인 원본은 **Main**으로 표시됩니다.
- 새로 만든 작업은 **실행 요청 이름 기준으로 하나의 행**으로 표시합니다. 이름이 같으면 짧은 작업 ID를 추가해 구분합니다.
- 정확한 Main 출처가 확인된 개발 Agent에서 Hub를 열면 **← Main으로 돌아가기**가 첫 항목입니다.
- 기존 저장 대화, PR #2/초기 PR #3 작업 기록, 다른 터미널 자원은 **다른 대화·이전 작업 찾기 (고급)**를 이용합니다. 옛 기록을 작업 이름만으로 새 실행 대상에 결합하지 않습니다.
- 최근 승인된 작업 최대 15개를 기본 Hub에 표시합니다. 오래된 기록과 기타 실행 자원은 고급 탐색에서 찾을 수 있습니다.
- `/compose back`은 이전 사용자를 위한 호환 명령입니다. 일상적인 작업 전환에는 새 Hub를 사용합니다.

### Worktree 안의 Pi에도 동일한 Hub 사용

기본 `pic`은 이미 Compose Extension을 명시적으로 로드합니다. `workmux --agent pi`로 실행하는 **개발 Agent**는 그렇지 않을 수 있습니다. 해당 Pi에서도 작업 Hub를 사용하려면 한 번만 명시적으로 설치하세요.

```bash
pic navigation enable
```

이 명령은 Pi가 제공하는 `pi install`을 통해 **탐색 전용 Extension**을 개인 Pi 설정에 등록합니다. 원치 않으면 `pic navigation disable`로 해제할 수 있습니다. 변경 후 기존에 열려 있는 Pi Agent는 재시작하거나 `/reload`해야 합니다. **사용자의 Pi 설정을 몰래 수정하지 않습니다.**

탐색 전용 Extension은 기본 `pic` 프로세스에서는 등록을 건너뛰어 명령어/단축키 충돌을 피합니다. 새 Agent에서는 동일한 `Alt+W` / `/compose`를 제공하며 **새 에이전트에게 맡기기**도 기존 선택 UI로 이어집니다.

설치하지 않은 기존 Child Pi 안에서는 Hub가 자동 제공되지 않습니다. 이 경우 Main 또는 tmux/workmux의 기존 탐색 방식이 필요합니다.

## 3. 어떻게 잘못된 작업으로 이동하지 않는가?

새로 실행한 작업에 대해 `~/.pi/compose/tasks/<프로젝트 해시>/<UUID>.json`에 **최소 실행 연결 정보**를 저장합니다.

- 사용자 작업명과 Context/Workspace
- 명시적으로 선택한 Pi Fork 원본 Session ID(해당 경우)
- workmux 실행에 지정한 고유 `--target-name`, 조회된 Worktree 경로·handle
- **해당 실행의 tmux 세션 이름과 창 ID**
- `pic`에서 직접 시작했거나 같은 작업에서 관계를 복원한 **원래 Main의 세션·창 ID**

이 파일은 Pi 대화나 모델 응답을 저장하지 않습니다. 프로세스 상태의 Source of Truth가 아닙니다.

- workmux 대상이 하나로 특정되지 않으면 잘못 연결하지 않고 **연결 정보 없음**을 표시합니다.
- 이전 버전의 작업 기록에 정확한 실행 ID가 없다면 현재 브랜치와 이름이 같아도 **예전 Agent라고 추정하지 않습니다.**
- Main과 Agent가 **같은 tmux 세션의 다른 창**이어도 창 ID를 확인하고 이동합니다.
- 창이 닫혔거나 Worktree 연결이 바뀌면 새 에이전트를 암묵적으로 실행하지 않습니다. 기존 고급 탐색을 통해 명시적으로 재개할 수 있습니다.
- 시작 시 실행 대상 조회가 실패할 경우 Worktree/프로세스가 **부분 생성되었을 수 있으므로**, 목록과 `git worktree list`를 검사한 뒤 재시도해야 합니다.

## 4. 상태 정보의 경계

기본 상태는 **대상 열림 / 닫힘 또는 확인 불가**입니다.

추가로 기존 workmux의 `workmux status --json`이 **정상 종료되고**, 해당 프로젝트 및 작업 디렉터리의 **정확히 하나의 Agent**가 관측된 경우에만 보조 상태를 보여줍니다.

- `working` → **AI 동작 중 (workmux 관측)**
- `done` → **최근 응답 종료 · 개발 완료 미확인**
- `waiting` → **입력 대기 (workmux 관측)** (Pi의 workmux Hook은 이 상태를 지원하지 않으므로 Pi에 대해서는 추정하지 않음)
- Hook 없음, 손상된 보고, 여러 Agent가 혼재, 대상 식별 불가 → **AI 상태 미확인**

이 상태는 Hub를 열었을 때 조회합니다. 별도 실시간 데몬이나 작업 DB는 추가하지 않았습니다. 개발 완료와 Handoff, Git 병합은 서로 별개의 판단입니다.

workmux Hook을 설치하려면 사용자가 공식 `workmux setup`을 직접 실행해야 합니다. Pi Compose가 자동 설치하지 않습니다.

## 5. Ghostty는 선택 사항

macOS Ghostty 1.3 이상에서 자동화 권한이 허용돼 있다면:

```bash
cd ~/projects/my-app
PIC_GHOSTTY_TABS=1 pic
```

Shared 실행은 기존 tmux 세션을, Ghostty 모드로 새로 실행한 Worktree는 **workmux session 모드**의 기존 tmux 세션을 탭에서 열려고 시도합니다. 이미 같은 작업의 태그가 있는 탭은 재사용하려고 합니다.

- Ghostty 1.3의 AppleScript는 macOS 권한에 영향을 받으며 실제 탭 열기/포커스는 아직 사용자 환경에서 E2E 검증되지 않았습니다.
- Ghostty가 없거나 실패하면 정확한 기존 tmux 창으로 전환합니다. 새 Pi를 만들지 않습니다.
- window 모드 Worktree의 새 Ghostty 탭 생성은 수행하지 않습니다. 기본 tmux 창 전환을 이용합니다.
- `PIC_GHOSTTY_TABS`를 설정하지 않으면 기존 workmux 실행 설정과 Pane 구성을 유지합니다.
- 옵션 활성화 시 **새 Worktree는 session 모드**로 실행됩니다. 사용자의 기존 session/window 배치와 다른 결과일 수 있습니다.

Ghostty 없이도 작업 탐색과 Main 복귀 기능 자체는 제공하는 것이 목표입니다.

## 6. 실사용 검증 체크리스트

1. 프로젝트에서 `pic` 실행 → Main 위치가 명료하게 표시되는가?
2. 자연어로 새 Agent 실행 → 승인한 실행 조건대로 **한 번만** 생성되는가?
3. "다른 Agent에게 맡기는 게 좋을까?"에 새 Agent가 생성되지 않는가?
4. `Alt+W` 또는 `/compose`에서 작업 한 개를 한 번만 볼 수 있는가?
5. 같은 이름의 작업 두 개를 구분할 수 있는가?
6. `pic navigation enable` 후 Child Pi 재시작 → Hub가 표시되는가?
7. Child에서 **Main으로 돌아가기** → 정확한 원래 Main 창으로 이동하는가?
8. Worktree window/session 두 모드에서 기존 Pi가 **중복 생성되지 않는가?**
9. 닫힌 창/옛 작업은 확인 불가로 표시하고 자동 Resume하지 않는가?
10. Ghostty on/off에서 동일한 핵심 작업 탐색·복귀가 가능한가?
11. workmux Hook이 없는 환경에서 AI 작업 중·완료를 거짓으로 표시하지 않는가?

실제 macOS Ghostty 및 인증된 다중 Pi 모델의 E2E는 별도 검증 대상입니다.
