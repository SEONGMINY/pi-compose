# Pi Compose ADE — 빠른 Core MVP

macOS에 집중한 첫 데스크톱 구현입니다. 완성형 IDE가 아니라 **설계(Main) → Fork → 구현(Child) → 관찰 → 코드 검토**라는 개발 방식의 첫 수직 구현입니다.

## 코드 경계

| 디렉터리 / 패키지 | 책임 | 의존하지 않는 것 |
| --- | --- | --- |
| packages/compose-core (@pi-compose/core) | 실제 Pi SDK 세션, 정확한 Fork, Git Worktree 생성, 메시지/도구 이벤트, 세션 저장·재개, Git Diff | React, Electron, UI 배치 |
| packages/compose-workbench (@pi-compose/workbench) | React 세션 목록, Main/Child 분할, TODO 영역, 실제 이벤트 및 Diff 보기 | Pi SDK, Git CLI, macOS/Electron API |
| apps/compose-desktop (@pi-compose/desktop) | Electron 앱 창, 로컬 폴더 선택, 안전한 IPC, 알림, 앱 종료 시 Agent 중단 | Fork/도메인 로직, React 컴포넌트 |

기존 TUI 경로와 PR #2~#5는 변경하지 않았습니다. 기존 TUI 코드를 통째로 마이그레이션하거나 기존 CLI를 폐기하지 않습니다. 작동하는 경계를 먼저 만들고 반복 검증 후 확장합니다.

## macOS에서 바로 실행

- Node >= 22.19.0, Git, macOS.
- Pi를 기존 CLI에서 /login과 /model로 설정한 상태여야 모델 실행이 가능합니다. Electron은 해당 Pi 설정을 재사용합니다.
- 저장소 브랜치: feat/ade-minimal-workbench.

    npm install
    npm run ade:dev

배포 파일을 만들기 전의 로컬 실행:

    npm run ade:start

첫 화면에서 Git 프로젝트를 선택하고 **새 Main**을 만듭니다. Main에서 실제 모델에 설계를 논의해 저장된 뒤 **Child에 위임**으로 작업을 입력하면, 같은 Main 세션 파일에서 Pi SessionManager.forkFrom()을 사용해 별도 Git Worktree의 Child를 생성하고 곧바로 Agent 실행을 시작합니다.

프로젝트마다 Main을 여러 개 만들 수 있습니다. 좌측에는 Main/Child 관계가, 가운데 Main/Child는 동시에 나타납니다. Child 상단은 실제 위임받은 작업과 응답 상태이며, 아래에서는 Pi의 모델/도구 이벤트를 관찰합니다. Child의 **변경 파일**에서 실제 Git Diff를 볼 수 있습니다. 코드나 계획을 추측해 만들어서 보여주지 않습니다.

Main의 실제 Pi 세션 파일은 Child 실행으로 바뀌지 않습니다. Child 개발 지시, 도구 출력과 Diff는 Main 모델 메시지에 자동 추가되지 않습니다.

## MVP에 포함한 것

- 명시적으로 생성한 여러 Main 및 정확한 Main Fork Child
- Pi 설정 재사용, 모델 대화, 텍스트 스트리밍, 도구 호출 및 출력
- Child별 새 Git Worktree, 시작 base SHA 기준 tracked Diff와 untracked 파일 목록
- Main/Child 분할, Child 상단 현재 작업, 멀티라인 프롬프트, Child 중단
- 세션 인덱스만 app userData에 저장, 실제 대화는 Pi JSONL이 정본
- Cmd+W/창 닫기: 앱 생존 및 Agent 계속 실행. Cmd+Q: 실행 중단 후 기록·Worktree 보존. 다음 실행은 세션을 복원하지만 모델을 자동 실행하지 않음
- Child 응답 종료 및 모델 실행 실패에 대한 로컬 알림

## 의도적으로 다음 단계로 둔 것

- 배포용 .dmg/notarization 및 자동 업데이트
- Orca 수준의 줄 단위 Diff 주석/의견 일괄 전송
- Pi Extension 기반 정형 TODO 추출, 대규모 대시보드, 세션 검색/이름 변경
- Shared Directory / Independent 등의 고급 실행 조합을 ADE UI에 노출
- Git 통합·Worktree 제거 UI (현재 **자동 실행하지 않음**)
- 다중 창/자유로운 3분할 드래그·드롭; 현재는 기본 Main+Child 분할 비율 조절
- 인증 모델 실행, macOS 앱 종료 및 알림 실기 E2E 검증

### 정확히 구분할 것

- Pi Agent 응답 종료 = 구현 완료가 아닙니다.
- 실제 Git Diff = 요구사항 검증 완료가 아닙니다.
- Fork parentSession 기록 = 모델이 강한 계약을 의미적으로 준수했다는 증거가 아닙니다.
- Child가 생성된 뒤 Worktree 준비가 성공했지만 Pi 초기화가 실패할 수 있습니다. 그때 Worktree는 사용자 코드를 지키기 위해 자동 삭제하지 않습니다.
- Main의 미커밋 파일은 새 Worktree로 복사되지 않습니다.
- 이번 환경에서는 npm 패키지 설치 및 macOS 실행 E2E가 불가능해 **실기 실행 성공으로 보고하지 않습니다.**

## 다음 1회 실사용 검증

1. 인증된 Pi로 Main에서 "기존 name은 호환성 때문에 절대 삭제 금지" 등의 설계 대화를 나눕니다.
2. 같은 Main에서 Child를 Fork해 구현합니다. Main은 왼쪽에 그대로 두고 오른쪽 Child에서 실제 모델/도구 출력을 관찰합니다.
3. Child가 파일을 수정하면 변경 파일에서 Diff를 확인하고, Child에 수정 지시를 보냅니다.
4. Main Pi 세션의 대화가 자동 변경되지 않았는지, 앱 종료 후 JSONL과 Worktree가 남아 있는지 확인합니다.

사용자에게 선택을 반복 요구하지 않고 이 수직 흐름을 먼저 실사용 평가합니다.
