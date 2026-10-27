# Pi Compose ADE — 실제 Pi TUI 우선 MVP

> 브랜치: feat/ade-pi-tui-agents. GitHub에 코드를 구현했지만 **macOS 실기 구동·Pi 모델 E2E 검증 전**입니다. 완성이나 배포를 의미하지 않습니다.

## 핵심 가치

여러 **Main Agent**의 고품질 요구사항·설계·의사결정 맥락을 보존하면서 다음 두 종류의 일을 분리해 실행하고 쉽게 관리합니다.

| 화면 이름 | Pi 세션 방식 | 주된 목적 | Main 컨텍스트 처리 |
| --- | --- | --- | --- |
| Main Agent | 별도 저장 대화, 프로젝트당 여러 개 가능 | 설계·의사결정 | 원본 보존 |
| Work Agent | 선택한 Main **정확한 저장 세션 Fork** | 개발 | 복제된 별도 대화 사용. 작업 로그는 Main에 쓰지 않음 |
| Support Agent | **새 Pi 대화** | 탐색·조사·테스트·검증 | 원본 상속 없음. 결과 자동 주입 없음 |

Work / Support 모두 연결된 Main 아래에 **작업 관련성**으로 표시될 수 있습니다. Support의 관련 관계는 Pi 세션의 부모-자식 관계가 아닙니다.

Fork/Independent 컨텍스트와 Shared/Worktree 작업 공간은 별도로 선택할 수 있습니다. 기본은 Work Agent에 별도 Worktree, Support Agent에 기존 작업 폴더입니다. Shared 작업 공간에서 Git 변경을 작성자별로 귀속시키지 않습니다.

## 실제 구성

- **compose-core**: Pi SessionManager, 정확한 세션 ID·원본 Fork, Git 기준 SHA·Worktree, 최소 관계 인덱스
- **compose-workbench**: React 작업 목록·탭/분할 및 Ghostty WASM 터미널과 Git 검토
- **compose-desktop**: Electron 창, node-pty, 실제 Pi TUI 프로세스, 입력·출력 이벤트 및 앱 종료 제어
- Pi JSONL이 대화 원본입니다. Compose 저장 파일은 Main/Work/Support의 관계만 담고 실제 대화·계약을 복제하지 않습니다.

로컬 개발 시에만 Vite 서버를 사용합니다. 실제 Pi는 node-pty 자식 프로세스로 실행됩니다. 렌더러에 터미널 바이트를 보내는 행위는 다른 Pi 세션의 모델 컨텍스트에 메시지를 보내는 행위가 아닙니다.

## 실행

macOS, Node >=22.19.0, Git, Pi v1.4.0 설치 및 Pi 모델 로그인이 필요합니다.

    git fetch origin
    git switch feat/ade-pi-tui-agents
    npm install
    npm run ade:dev

Pi 실행 파일 경로가 자동 발견되지 않으면:

    PIC_PI_BIN=/absolute/path/to/pi npm run ade:dev

Node-pty의 Electron용 네이티브 재빌드를 위해 Electron rebuild를 구성했습니다. macOS에 Xcode Command Line Tools가 필요할 수 있습니다.

정적·기존 검사 (macOS 환경에서 설치 후):

    npm run ade:check
    npm run ade:build

## 사용하는 방법

1. Git 프로젝트를 엽니다.
2. **Main Agent**를 생성해 실제 Pi TUI에서 설계를 논의합니다. 프로젝트·기능·작업별로 Main을 여러 개 만들 수 있습니다.
3. 선택된 Main의 대화를 저장한 뒤 **Work Agent**를 생성합니다. Pi Compose는 정확한 원본 JSONL을 찾고 새 Work 대화를 Fork합니다. 별도 Git Worktree에서 Pi TUI를 실행하면서 개발 지시를 전달합니다.
4. **Support Agent**를 생성하면, 관련 Main 아래에 표시되지만 실제 Pi 대화는 완전히 새로운 세션에서 시작합니다. 원본 대화나 실행 로그가 자동 전달되지 않습니다.
5. Main과 Work/Support의 **실제 Pi 터미널을 동시에 보고 입력**합니다. Git 변경 탭은 정해진 시작 커밋부터의 Diff와 미추적 파일을 보여줍니다.
6. 앱 창 닫기는 Agent를 종료하지 않고, Cmd+Q 종료 시 Pi 프로세스 중단을 시도합니다. 다음 실행 시 Agent는 **자동 재시작되지 않으며**, 사용자가 해당 세션을 다시 실행해야 합니다.

## 컨텍스트 보존의 경계

- 정확한 원본 Main JSONL을 찾지 못하면 Work Agent의 Fork를 거절합니다. 가장 최근 세션으로 임의 대체하지 않습니다.
- Pi TUI 내부에서 다른 대화로 바뀌었는지 최소한 확인하기 위해 **읽기 전용 Pi Extension**이 현재 세션 식별자만 앱 저장 공간에 기록합니다. 메인 대화 내용·도구 로그를 이 Extension으로 전송하지 않습니다. 확인된 활성 대화가 ADE의 Main 세션과 다르면 Fork를 거절합니다.
- 원본 기록 Fork는 모델이 이유·강한 금지를 모두 의미적으로 준수했다는 증거는 아닙니다. 실제 코드 검토가 필요합니다.
- Work Agent의 Fork 시점 이후 Main에서 새로 결정한 내용은 자동 전달되지 않습니다.
- Support Agent의 결과는 자신의 실제 Pi 터미널에서 확인합니다. Main에 보내려면 사용자가 직접 선별해 지시해야 합니다. 자동 Handoff와 TODO는 후속 기능입니다.
- Main의 미커밋 파일은 별도 Worktree로 복제되지 않습니다.
- Pi /new 또는 /resume로 활성 대화를 바꾸는 행위는 ADE가 선택한 Main 정본과 다를 수 있습니다. 그런 경우 잘못된 Fork를 막고 새 Main을 생성하거나 원본 대화로 되돌아가도록 안내합니다.
- Git 검토는 구현 완료·계약 준수 또는 병합 승인이 아닙니다. 자동 병합·Worktree 제거는 없습니다.

## 이번 범위에서 제외한 것

Orca 수준의 Diff 줄 단위 댓글, TODO, 자동 상태 진단·자동 요약, 다른 Agent로 자동 메시지 전송, 자체 Pi 채팅 UI, .dmg 패키징/공증, 임의 다중 창. 사용하며 문제가 확인되면 필요한 순서로 추가합니다.

## 검증 상태

- **소스 확인**: Pi 1.4.0 SessionManager의 forkFrom, findById 및 CLI --session-id / --session / --extension 지원.
- **코드 구현**: 세 역할·컨텍스트 분리·PTY 실행·Ghostty WASM 터미널·화면 전환·Git Diff.
- **아직 미실행**: npm install 및 TypeScript 전체 검사, Electron 네이티브 node-pty 재빌드, macOS Pi 실제 인증 실행·Fork·개발·수정 E2E. Linux 제한 환경에서 실제 실행 성공을 주장하지 않습니다.

가장 먼저 macOS에서 **Main 설계 → Work Fork → 실제 Pi TUI 작업 → Support 별도 대화 → Main 확인 → Git Diff** 흐름을 실행하며 오류를 수정합니다.
