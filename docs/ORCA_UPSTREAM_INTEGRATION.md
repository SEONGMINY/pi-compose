# Pi Compose × Orca — upstream 기반 첫 실행

**이 브랜치는 기존 PR #7–#10에서 구현했던 자체 Electron UI를 계속 확장하지 않습니다.**
Orca 소스를 실제 Electron ADE로 실행하고, Pi Compose는 별도 Pi Extension으로
**정확한 Main Fork / 독립 Support / 컨텍스트 출처**만 연결합니다.

## 무엇이 실제로 Orca인가요?

- **Orca 원본:** https://github.com/stablyai/orca
- **고정 커밋:** `4a39d186da72a496b29a9ec5c523bbbf0a3460d8`
- **라이선스:** Orca는 MIT. 원본 체크아웃의 LICENSE와 저작권 고지를 유지합니다.
- **Orca 제공:** 프로젝트·Worktree 탐색, 터미널·탭·분할, Pi 실행 및 상태, 코드 Diff, 자체 계정 연동
- **Pi Compose 제공:** 아래 3가지 세션 역할과 Fork 계보/실행 지시. Pi 자체 모델·인증·Extension은 재구현하지 않습니다.

Orca의 코드를 모사한 UI가 아니라 **실제 Orca 소스의 개발 실행**입니다.
이 단계는 GitHub 네트워크의 Fork 저장소는 아닙니다. 접근 가능한 GitHub 연결 기능이
새 원격 Fork 생성은 지원하지 않으므로 **업스트림 버전을 고정한 체크아웃 + 별도 Extension**으로 시작합니다.

## 설치/실행 (macOS)

Node.js 24, pnpm(Corepack), Git, Pi, 기존 모델 인증이 필요합니다.

```sh
git fetch origin
git switch feat/orca-upstream-foundation
npm install
npm run orca:prepare       # Orca 원본 shallow clone + 고정 SHA checkout
npm run orca:dev           # Orca 원본 pnpm dev (처음에는 pnpm install)
```

작업 브랜치 기존 파일이나 Main Pi 세션, Git Worktree는 삭제하지 않습니다.
Orca 원본은 `.cache/orca-upstream`에 위치하며 기존 화면 코드를 대체하는 것이 아닙니다.
`pnpm dev`는 Orca가 제공하는 기존 소스를 실행합니다.

Orca의 터미널을 열고 Git 프로젝트에 진입한 다음 다음 명령으로 Pi를 시작합니다.

```sh
pic-orca
```

Orca 개발 프로세스의 PATH에 `pic-orca` 래퍼를 추가합니다.
Orca 터미널에서 명령을 찾지 못한다면 Pi Compose 체크아웃의 절대 경로를 사용할 수 있습니다.

```sh
node /absolute/path/to/pi-compose/bin/pic-orca.mjs
```

이 명령은 Pi를 **실제 TUI**로 실행하면서 `extensions/orca-compose.ts`만 추가로 로드합니다.
Orca의 Pi RPC 모드나 다른 CLI/Extension 사용을 대체하지 않습니다.

## 실제 작업 흐름

예: 호환성 제약을 논의할 프로젝트에 Main Pi 대화를 먼저 생성합니다.
Pi 대화에 의사결정이 저장된 뒤 다음 명령을 입력합니다.

```text
/compose-main 회원가입 API 설계
```

이는 현재 **정확한 Pi 세션 ID + JSONL 파일**을 Main으로 기록합니다. Main을 전역 하나로 제한하지 않습니다.

Work Agent를 준비합니다.

```text
/compose-work 기존 label 필드를 유지하면서 신규 API를 구현해줘
```

Git Worktree 또는 기존 공유 폴더를 선택합니다.
Pi Compose가 원본 Pi JSONL을 정확히 복제한 별도 세션을 생성하고 기록을 대조합니다.
**원본 Main 대화를 요약해 새로운 Agent에게 짧게 전달하지 않습니다.**

Support Agent는 별도 컨텍스트로 준비합니다.

```text
/compose-support 테스트를 실행하고 실패 원인과 근거만 조사해줘
```

이는 Main 대화가 복제되지 않은 새 Pi 세션 ID를 준비합니다.
Work/Support 모두 Main 작업과의 **관계만** 외부 상태 파일에 기록합니다.

각 명령은 다음과 같은 안내를 표시합니다.

```text
Work Agent 준비됨 (Main의 Pi 대화 Fork 복제)
Orca에서 새 터미널을 열고 다음 명령을 실행하세요:
sh '/Users/you/.local/state/pi-compose/orca/launchers/<agent-id>.sh'
```

Orca 새 터미널에서 표시된 명령을 실행하면 **실제 Pi TUI가 시작**됩니다.
처음 명령만 준비한 시점에는 작업이 실행된 것처럼 표시하지 않습니다.

```text
/compose-agents
```

으로 관련 Main/Work/Support와 Fork 기록 일치 개수를 확인할 수 있습니다.
세션 기록 자체는 Pi JSONL이 정본입니다. 관계 정보는 기본적으로
`~/.local/state/pi-compose/orca/agents`에 있고 Git 소스 코드와 섞이지 않습니다.

## 컨텍스트 보호 계약

1. Main Agent는 제품/기능/작업 단위로 여러 개 만들 수 있습니다.
2. Work Agent는 **현재 Main의 정확한 원본 세션 파일**만 Fork합니다. 원본 파일이 없으면 중단합니다.
3. Work의 실행 로그, 테스트 출력, 발견 사항은 Main Pi 대화로 자동 유입되지 않습니다.
4. Support는 새 Pi 세션으로 시작하며 Main 기록을 복제하지 않습니다.
5. **Fork vs 독립 컨텍스트** 및 **공유 디렉터리 vs Git Worktree**는 별개 옵션입니다.
6. 생성/실행은 사용자 요청으로만 진행합니다. 자동 병합·정리·Worktree 삭제는 없습니다.
7. Fork의 모든 기록 일치를 확인해도 Compaction 이후의 **실제 활성 모델 컨텍스트나 의미적 이해까지 보증하지 않습니다.**
8. Pi 모델 인증/선택은 Pi가, 탭/종료/분할/로그인은 Orca가 담당합니다. 자체 로그인 모달을 만들지 않습니다.

## 지금 되는 것 / 이어서 연결할 것

**현재 구현된 최소 연결:**
- 실제 Orca UI 사용 (업스트림 코드를 고정 커밋으로 실행)
- Orca 터미널의 실제 Pi TUI에서 현재 Pi 세션을 Main으로 지정
- 정확한 JSONL 전체 복제 Work 및 별도 Support 준비
- Worktree/공유 폴더 선택, Git 브랜치 생성·보존
- Orca 새 터미널에서 명시적인 명령으로 실행
- 기록의 Fork 계보와 복제 개수 확인

**아직 안 되는 것:**
- Orca 사이드바에서 Main/Work/Support를 별도로 중첩해서 표시
- Work/Support 준비 직후 별도의 새 Orca 탭을 **자동 생성/실행**
- Orca 원본의 계정 및 Agent 상태를 Pi Compose 역할과 자동 연동
- 기존 자체 Electron 데스크톱 UI에 저장한 관계 데이터의 자동 마이그레이션
- macOS 실기에서 Pi 모델 인증→Fork→실행→코드 검토 E2E 검증

위 항목은 Orca 내부 작업/세션 API의 실제 연동 지점을 확인한 뒤
**작은 업스트림 패치**로 해결할 대상입니다. 범용 오케스트레이터나 별도 UI Shell을 선행 구현하지 않습니다.

## 검증

```sh
npm run test:orca
```

macOS GitHub Actions에서 Fork/독립 세션 및 Worktree 분리 계약을 검사합니다.
실제 Orca 앱의 화면과 Pi 모델까지 검증한 결과로 오해하지 않습니다.

기존 독립 Electron ADE 실험은 PR #7~#10에 **보존**하며 자동으로 삭제/병합하지 않습니다.
