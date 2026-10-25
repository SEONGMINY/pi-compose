# pi-compose

Pi를 기반으로 한 개인용 **Composable Coding Agent Harness**.

현재는 TypeScript 기반 **Launch·Resume CLI, 기본 Pi Extension 및 선택형 View·Handoff·독립 검증 Extension**을 제공한다. 격리 환경에서는 Pi·tmux·workmux의 Shared Launch·Resume·Worktree 생성과 TypeScript/Extension 테스트를 확인했다. **실제 모델의 Main Fork 맥락 보존, 에이전트 간 Handoff 수신, 독립 검증 결과와 macOS 실사용 흐름은 아직 미검증**이다.

## 핵심 원칙

- Main Agent는 설계·의사결정의 원래 이유와 강한 제약을 보존한다.
- Context(Fork/Independent), Workspace(Shared/Worktree), 실행 시점과 순차·병렬 여부를 독립적으로 선택한다.
- 개발 세션은 **사용자의 명시적 실행 요청**이 있을 때 생성한다.
- Pi·Git·tmux·기존 도구 기능은 재사용하고 반복 준비 작업을 추상화한다.
- Main이 상세 Git Diff·테스트 로그를 직접 분석하도록 강제하지 않는다.
- 완료 Handoff, 검증, 실제 Git 통합, Worktree 정리를 서로 구분한다.

## 시작하기 — `pico`

**최초 한 번 설치한 다음에는 어느 프로젝트에서든 `pico`로 Pi Compose를 시작할 수 있습니다.**

**macOS 설치 또는 업데이트 — 같은 명령을 실행합니다.**

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

설치 이후 어느 프로젝트에서든 다음 명령을 실행합니다.

```bash
cd ~/projects/my-app
pico
```

설치 스크립트는 Node.js 22.19.0 이상과 Git을 확인하고, 필요한 경우에만
Pi를 npm으로 설치하거나 tmux·workmux를 Homebrew로 설치합니다.
Pi Compose는 **GitHub main의 정확한 HEAD 커밋**을 npm으로 전역 설치합니다.
npm Registry 공개 배포나 수동 Git Clone은 필요하지 않습니다.

- 기존 Pi는 **재설치하거나 업데이트하지 않습니다.**
- 사용자 Pi 설정·모델 인증·저장된 세션·선택형 Extension 활성화 상태는 변경하지 않습니다.
- Node.js가 이미 설치됐지만 오래된 경우, 기존 버전 관리 환경을 덮어쓰지 않고 중단하며 업그레이드를 안내합니다.
- 누락된 의존성을 설치해야 하는데 Homebrew가 없으면 설치를 중단하고 안내합니다. **Homebrew 자체는 자동 설치하지 않습니다.**
- npm 권한 문제로 `sudo`를 자동 실행하지 않으며, Shell 설정과 PATH도 수정하지 않습니다.
- 업데이트 때는 동일한 설치 명령을 다시 실행합니다. Pi·tmux·workmux의 기존 설치를 임의로 업그레이드하지 않습니다.
- `scripts/install.sh`는 원격 Shell 스크립트이므로 실행 전 원본을 확인할 수 있습니다.
  [설치 스크립트](scripts/install.sh) · [배포 결정](docs/adr/0006-github-installer.md)

Pi 모델 인증 및 사용자 설정은 **기존 Pi와 공유**합니다.

`pico`는 현재 작업 디렉터리를 유지하고 **기존 `pi` TUI**를 실행하면서
`extensions/compose.ts`만 명시적으로 추가합니다. Pi Runtime·세션 DB·모델 설정을 복제하지 않습니다.
설치 시 Pi의 사용자·프로젝트 `settings.json`을 수정하지 않습니다.

기존 Pi 옵션도 그대로 전달합니다.

```bash
pico --resume
pico --continue
pico --model sonnet:high
pico -e /path/to/my-extension.ts
```

실제 Ubuntu 격리 환경에서 npm 전역 설치, `pico --version`, 인자·cwd·종료 코드 전달,
선택형 Pi Package 등록, 타입 검사·Extension 테스트(24개)를 확인했습니다.
[실행 기록](https://github.com/SEONGMINY/pi-compose/actions/runs/40182260770).
macOS와 `pi config`의 개별 토글 동작은 아직 직접 검증하지 않았습니다.

Pi의 Package 관련 CLI도 직접 사용할 수 있습니다.

```bash
pico config           # Pi 기본 Package/Extension 설정 TUI
pico config --local   # 이 프로젝트의 Pi 설정
pico list             # Pi Package 목록
```

### 선택형 기능 활성화

기본으로는 **Launch·Preview·기존 작업 탐색·복귀·명시적 Resume**를 연결합니다.
Dashboard·Handoff·독립 검증은 Pi의 **별도 선택형 Package**에 담았습니다.
사용자가 직접 활성화할 때만 다음 명령을 실행합니다.

```bash
pico features          # 사용자 범위에서 세 선택형 Extension 추가 → Pi config
pico features --local  # 현재 프로젝트 범위에서 추가 → Pi config
```

이 명령은 자체 설정 시스템이 아닙니다. 설치된 `packages/optional`을
**Pi의 `install` 명령으로 등록하고 `pi config` TUI를 여는 단축 실행**입니다.
최초 등록 시 Dashboard·Handoff·Verify **세 기능 모두 활성화**됩니다.
설정 UI에서 사용하지 않는 Extension을 꺼 주세요.
선택 결과는 Pi의 `settings.json`에 저장돼 이후에도 유지됩니다.

**선택형 설정은 일반 `pi`와 `pico`에 공통 적용됩니다.** 이는 합의한
Pi 설정 공유 방식입니다. 한 번의 실행에만 추가하려면 `pico -e <path>`를 사용하세요.
`pico`로 실행하지 않아도 일반 `pi`는 계속 사용할 수 있습니다.

> 이미 `pi install ~/dev/pi-compose`로 기본 Package를 등록했다면
> 일반 `pi`에서도 `/compose` 명령이 보일 수 있습니다.
> `pico`는 Pi의 리소스 경로 중복 제거를 활용하며 기존 설치나 설정을 자동으로 삭제하지 않습니다.
> 일반 `pi`를 기본 상태로 돌리고 싶다면 `pi list`로 기존 등록을 확인한 뒤
> 사용자 판단으로 `pi remove <등록된 소스>`를 사용하세요.

## TypeScript 실행 및 의존성

- **CLI:** Node.js 22.19.0 이상의 기본 TypeScript type stripping으로 `bin/pi-compose.ts` 직접 실행. 별도 번들·빌드 단계 없음.
- **Pi Extension:** Pi 공식 `jiti` 로더로 `extensions/compose.ts`를 직접 로드. `ExtensionAPI`는 Pi 공식 타입 사용.
- **타입 검사:** `tsc --noEmit` + `strict`.
- **런타임 검증:** Zod 4는 CLI/Extension 공통 Launch 입력, 외부 Pi JSONL 헤더, Git에서 반환된 SHA·저장소 루트의 경계에서만 사용. Git 브랜치 문법은 Git이 검증.
- **의존성:** `zod`(실행), `typescript`·`@types/node`·Pi 공식 타입 패키지(개발). Pi 런타임은 peer 의존성으로 참조해 중복 번들하지 않음.

## 현재 구현: Launch CLI

Node.js `>=22.19.0`을 기준으로 한다. `git`, `pi`, `tmux`, `workmux`는 실행할 조합에 따라 필요하며 **자동 설치되지 않는다**.

```bash
# 실행 환경에 명령만 표시 (리소스 변경 없음)
node bin/pi-compose.ts launch \
  --task "회원 API 구현" \
  --context fork \
  --workspace worktree \
  --cwd /path/to/project \
  --source-session-file /path/to/main-session.jsonl \
  --branch feat/member-api \
  --dry-run

# 실제 실행하려면 --dry-run 제거
# 먼저 실제 사용 환경의 Pi·workmux·tmux 호환성을 확인할 것
```

| Context | Workspace | 실행 계획 |
| --- | --- | --- |
| Fork | Shared Directory | Pi `--fork` + tmux |
| Independent | Shared Directory | 새 Pi + tmux |
| Fork | Git Worktree | workmux `add --fork` |
| Independent | Git Worktree | workmux `add` |

Fork는 정확한 **원본 Pi 세션 JSONL 파일**이 필요하다. 최근 세션을 자동으로 Main으로 취급하지 않는다.

```bash
npm install
npm run check
# 내부적으로 tsc --noEmit + node --test test/*.test.ts
```

**자동 테스트는 직접 구현한 Pi Extension의 사용자 동작을 중심으로 작성합니다.** 기존 도구 연결은 필요한 시점에 실제 명령과 결과로 확인합니다. 타입 검사는 별도로 유지합니다.

## 조합 가능한 Pi Extension

**기본 Pi Compose Package는 Launch만 로드합니다.** Dashboard·View는 필수가 아닙니다.
새로운 View를 만들거나 다른 Extension을 추가할 때 Launch Extension을 수정할 필요가 없도록 구성했습니다.

| 기능 | 로딩 | Pi 명령 |
| --- | --- | --- |
| **기본 작업 관리** | 기본 Package에 포함 | `/compose launch`, `/compose preview`, `/compose back`, `/compose resume` |
| **workmux View** | 사용자가 명시적으로 추가 | `/compose-workmux [agents\|worktrees]` |
| **Handoff** | 사용자가 명시적으로 추가 | `/compose-handoff [recipient]` 및 `compose_handoff` Tool |
| **Independent Verification** | 사용자가 명시적으로 추가 | `/compose-verify [base-ref]` |
| **사용자 정의 TUI / Extension** | Pi 기본 Extension/Package 방식으로 별도 추가 | 각 Extension의 명령 |

### 기존 Pi Package 명령을 직접 사용할 수도 있습니다

`pico features`를 사용하지 않고 기존 Pi 명령으로도 선택형 기능을 설치할 수 있습니다.
예를 들어 로컬 체크아웃을 사용하는 경우 다음과 같습니다.

```bash
pi install ~/dev/pi-compose/packages/optional
pi config
```

지속 여부·사용자/프로젝트 범위는 Pi의 설정이 소유합니다. `pico`는 이를
별도로 저장하거나 원래 Pi의 설정 파일을 덮어쓰지 않습니다.
별도의 코드 기반 View Registry·Plugin Manager를 만들지 않았습니다.

### 기존 workmux Dashboard CLI

명시적으로 workmux를 사용하고 싶다면 **기존 CLI 명령은 그대로 유지**합니다.

```bash
node bin/pi-compose.ts dashboard
node bin/pi-compose.ts dashboard --session
node bin/pi-compose.ts dashboard --tab worktrees
```

Pi 안에서 workmux View를 별도 로드한 경우에는 `/compose-workmux` 또는
`/compose-workmux worktrees` 명령으로 tmux 팝업을 엽니다.
이전 `/compose dashboard` Pi 명령은 분리되었으며, **CLI의 `dashboard` 명령과 구분**됩니다.

workmux와 tmux는 자동 설치되지 않으며, Pi 상태 추적은 별도 workmux Hook 설정이 필요할 수 있습니다.
**View를 닫아도 Pi 세션이나 Git 작업을 삭제하지 않습니다.**

> **현재 제한:** View는 선택 사항이지만 Worktree Launch의 실행 준비는 여전히
> `workmux add`를 사용합니다. 따라서 Worktree Launch를 실제 실행할 때는
> workmux가 필요합니다. 실행 백엔드 교체와 View 교체는 서로 다른 설계 결정입니다.

## Pi 내부 명령

Pi 공식 Extension API를 사용한 `/compose` 명령의 첫 구현이 들어 있다.

```text
/compose preview 회원 API 구현
/compose launch 회원 API 구현
```

Pi UI에서 Context와 Workspace를 선택한다. Fork라면 **현재 Pi 세션 / 같은 프로젝트의 다른 저장 세션 / 직접 파일 지정** 중에서 선택하며, Worktree라면 새 브랜치를 입력한다. **현재 세션을 Main이라고 임의로 취급하지 않는다.**

사용자가 자연어로 새 개발 에이전트 실행을 명시적으로 요청하면 모델이 `compose_launch` Tool을 사용할 수 있다. 이 경로는 **실제 실행 전 사용자 확인을 요구**하며, 확인 UI가 없으면 실행하지 않는다. 명시적 `/compose launch` 명령은 별도 재승인을 요구하지 않는다.

**실제 Pi 로딩과 실행 동작은 해당 환경에서 확인이 필요**하다.

## 기존 작업으로 돌아가기 — `/compose back`

새로운 Agent를 만들 필요가 없다면 Pi에서 다음 명령을 사용합니다.

```text
/compose back
/compose back 회원 API
```

기본 Compose Extension이 **현재 프로젝트의 저장된 Pi 세션**(Pi SessionManager)과
**workmux Worktree 목록**(`workmux list --json`)을 필요한 시점에만 조회하고
Pi의 `select` UI로 후보를 보여줍니다. 별도 세션 Registry/DB를 만들지 않습니다.

- **저장된 Pi 대화 선택:** Pi의 `ctx.switchSession`으로 **현재 Pi 프로세스에서 대화를 전환**합니다. 새로운 tmux Session/모델 프로세스를 만들지 않습니다.
- **workmux Target 열림:** 이름과 브랜치를 확인하고, **사용자 승인 후** 대상을 다시 조회해 `workmux open`으로 이동을 요청합니다. `is_open`은 workmux Target 상태이며, 해당 Pane에서 **어떤 Pi 대화가 실행 중인지까지 확인하지 못합니다**. 검사 이후 Target이 사라지면 workmux가 새 Window를 만들 가능성이 있으므로, 이 동작은 승인 창에 표시합니다.
- **workmux Target 닫힘:** 해당 Worktree의 **저장된 Pi 세션 목록을 다시 조회**하고, 사용자가 재개할 대화를 선택합니다. Git 브랜치·Worktree 경로·세션의 원본 cwd를 검증한 뒤 **명시적 승인 시에만** 기존 `planResume`/`executeResume`으로 새 tmux Pi 프로세스를 시작합니다. 실행 대상이 이미 점유됐거나, Worktree 상태가 달라졌다면 실행하지 않습니다.
- **저장 세션이 없는 Worktree:** 새 대화를 추측하거나 생성하지 않습니다. Pi 기본 세션 디렉터리에서 대화를 찾을 수 없는 경우, 사용자에게 정확한 세션 파일 경로를 선택할 수 있는 기존 `/compose resume`을 안내합니다.
- **조회 범위:** 현재 Pi 프로젝트의 저장된 대화와 현재 저장소에서 workmux가 찾는 Worktree만 포함합니다. 모든 프로젝트·외부 tmux 세션은 통합 검색하지 않습니다.
- **workmux 미설치/조회 실패:** 저장된 Pi 세션 선택은 계속 제공하지만 Worktree 상태는 확인하지 못했다고 표시합니다.

자연어는 **조회와 복귀를 구분**합니다.

- **"회원 API 작업을 찾아줘":** `compose_find_work`는 변경 없이 관련 후보만 간결하게 알려줍니다.
- **"회원 API 작업으로 돌아가고 싶어":** `compose_return_work`가 **같은 Pi 선택 UI**를 엽니다.
  저장된 Pi 대화를 선택하면 정확한 `/compose back id:<Pi세션ID>` 명령을 **입력창에 준비**합니다.
  사용자가 **Enter를 누를 때만** Pi의 공식 `switchSession`이 실행됩니다. 진행 중이던 입력 내용이 있다면 덮어쓰지 않고 명령을 안내합니다.
  이미 열린 workmux Target 이동과 닫힌 Worktree 재개는 기존 Slash Command의 **확인·경로 검증·중복 생성 금지**를 그대로 적용합니다.

**기술적 한계:** Pi 1.4.0은 Slash Command에만 `ctx.switchSession`을 제공합니다.
모델 Tool은 이 API를 사용할 수 없어 **저장된 대화의 직접 전환은 사용자 Enter가 필요**합니다.
이를 우회하기 위해 자체 세션 관리자나 임의 프로세스 제어를 만들지 않았습니다.
작업 탐색 범위는 여전히 현재 프로젝트이며, 다른 프로젝트 세션을 추측하지 않습니다.

Pi Compose가 `/compose launch`로 Shared Agent를 실행하거나 `/compose resume` 및
`/compose back`으로 새 Pi 프로세스를 재개할 경우, **기본 Compose Extension 경로를 Pi에 추가**합니다.
선택형 Extension은 기존 Pi 설정에 맡기며, `pico`의 별도 설정 파일은 만들지 않습니다.
CLI를 독립적으로 사용하는 경우에는 기존 `pi` 기본 실행 동작을 유지합니다.
Worktree를 처음 만드는 `workmux add`의 새 Pi 프로세스에 Compose Extension이 항상 포함되는지는 별도 확인이 필요합니다.

기존 `/compose resume`은 **새 tmux에서 정확한 Pi 세션을 시작하는 기능**으로 유지하며,
Pi 기본 `/resume`도 그대로 사용할 수 있습니다. 둘 다 `/compose back`과 다른 작업입니다.

## Phase 3 — 기존 세션 확인 및 명시적 재개

세션을 새로 Fork하지 않고 **정확한 기존 Pi 대화**를 이어갈 때 사용합니다.
현재 작업 중인 세션을 임의로 선택하지 않으며, Git 파일을 삭제하거나 자동 정리하지 않습니다.

```bash
# 이전 Launch 실패 후 브랜치/Worktree의 실제 존재 상태를 확인 (읽기 전용)
node bin/pi-compose.ts inspect --cwd /path/to/project --branch feat/member-api

# Shared Directory에서 정확한 저장 세션 재개 계획만 확인
node bin/pi-compose.ts resume --workspace shared \
  --cwd /path/to/project --session-file /path/to/agent.jsonl --dry-run

# Worktree에서 저장 세션 재개
node bin/pi-compose.ts resume --workspace worktree \
  --cwd /path/to/project --branch feat/member-api \
  --session-file /path/to/agent.jsonl
```

Pi 내부에서는 기본 Extension의 `/compose resume`으로 기존 세션을 선택할 수 있습니다.
Worktree의 미커밋 변경은 그대로 보존합니다. **이미 사용 중인 tmux 대상은 덮어쓰지 않으며**
같은 세션이 다른 이름의 tmux Pane이나 터미널에서 실행 중인지는 확정할 수 없음을 표시합니다.

삭제·Cleanup 명령은 구현하지 않았습니다. 파일·브랜치 정리는 반드시 사용자 선택으로 처리합니다.

자세한 동작과 검증 범위: [Phase 3 Resume](docs/validation/phase3-resume.md).

## Phase 4 — 명시적 Handoff (선택형 Extension)

개발 에이전트가 작업을 인계할 때만 로드·사용합니다. 기본 Launch Package에는 포함하지 않습니다.

```bash
pi -e /absolute/path/to/pi-compose/extensions/optional/handoff.ts
```

Pi에서 `/compose-handoff`를 실행하면 현재 대화를 바탕으로 인계 보고서를 작성하도록 요청합니다.
`/compose-handoff project:handle`처럼 대상을 지정하면 모델이 `compose_handoff` Tool로
Git 상태를 확인한 후 **명시적인 사용자 확인을 받고** `workmux send`로 전달할 수 있습니다.

인계 내용은 구현 사실, 원래 이유·강한 금지, 실제 수행한 검사, 남은 문제입니다.
Git에서는 HEAD·브랜치·staged·unstaged·untracked 파일 경로를 확인합니다.
기준 커밋을 지정하지 않았다면 과거 커밋의 변경 파일은 확정할 수 없다고 표시합니다.

**Handoff는 개발자의 주장이지 코드 검증이나 상대 에이전트의 읽음 확인이 아닙니다.**
전송 실패·취소 시에는 메시지를 그대로 반환합니다. Merge·Cleanup은 수행하지 않습니다.

자동 테스트는 Extension의 중요한 사용자 동작만 유지하고, 기존 Git·workmux 명령 재검증을 반복하지 않습니다.

## Phase 5 — 선택적 독립 검증

필요할 때만 사용하는 **선택형 Extension**입니다. 기본 Pi Compose에는 포함하지 않습니다.

```bash
pi -e /absolute/path/to/pi-compose/extensions/optional/verify.ts
```

```text
/compose-verify                 # 현재 staged/unstaged/untracked 변경만 검증
/compose-verify main            # Git 기준 브랜치부터의 변경까지 포함
/compose-verify abc1234         # 명시적 기준 커밋부터 확인
```

Git으로 실제 변경과 파일 경로·공백 오류를 확인한 후 사용자 승인 시
`pi --print --no-session --no-extensions --no-mcp --tools read,grep,find,ls`로
**독립된 읽기 전용 Pi 검증**을 실행합니다. 에이전트는 실제 변경과 프로젝트의 `AGENTS.md`·명세 등을 확인합니다.

현재 Pi 대화에 이전 `compose_handoff` Tool 결과나 전달받은 **명시적 Handoff**가 있으면
기존 Pi 세션 기록에서 마지막 보고서를 읽어 **검증되지 않은 개발자 주장**으로 전달합니다.
기록에 없으면 Handoff를 전달하지 않으며, 원래 Main 대화 전문은 자동 이전하지 않습니다.
원래 사용자 계약·WHY가 확인되지 않으면 그 한계를 보고합니다. 큰 Diff는 입력 길이를 제한하므로 완전한 검증을
보장하지 않으며, 다른 사람이 동시에 수정하는 Shared Directory도 특별히 주의해야 합니다.

검증 결과는 결론·이유·파일 근거·확인한 범위·미확인 범위만 현재 Pi에 간결하게 전달합니다.
이 결과를 사용자 승인, Merge, Handoff 수신 확인으로 취급하지 않습니다.
검증을 위해 새 자체 DB, 리뷰 엔진, Git 관리자, 필수 CI Gate를 추가하지 않았습니다.

## Phase 6 — 실제 실행 검증 및 사용자 주도 통합

격리된 Ubuntu 환경에서 Pi `1.4.0`, workmux `0.1.277`, tmux를 설치하고
현재 코드의 **TypeScript 검사·Extension 테스트(24개)·Pi TUI 로딩·Shared Launch·정확한 Resume·중복 차단·Worktree Launch/inspect**를 실제 실행했습니다.
[실행 결과](https://github.com/SEONGMINY/pi-compose/actions/runs/40177234200).

**tmux 환경 조건:** workmux가 여러 tmux 세션 중 부모 세션을 특정할 수 없는 경우 창을 생성하지 않습니다. Pi가 실제로 실행 중인 tmux Pane에서 Launch했을 때 정상 동작했습니다.

별도의 임시 Git 통합 시나리오에서는, **Git 병합이 성공해도 API와 UI의 계약이 깨지면 통합된 코드가 실패할 수 있다**는 점을 재현했습니다.

실제 인증된 두 Pi 모델이 코드를 개발하는 과정, Main Fork의 원래 이유·강한 금지 보존,
`workmux send` 수신, Handoff와 독립 AI Review는 아직 미검증입니다.
Pi Compose는 **자동 Merge·Cleanup·스케줄링을 하지 않습니다.**
사용자가 통합을 선택하면 기존 Git 명령으로 처리하고,
통합된 코드 상태에서 프로젝트의 기존 검사를 수행합니다.

자세한 검증 범위와 실행 조건: [Phase 6 통합 점검 기록](docs/validation/phase6-integration.md).

## 문서

[설계 문서 인덱스](docs/README.md) · [PRD](docs/PRD.md) · [TRD](docs/TRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) · [Phase 1 구현·검증 상태](docs/validation/phase1-launch.md) · [Phase 2 Dashboard 연동](docs/validation/phase2-dashboard.md)

## 앞으로의 작업

공통 Launch 진입점을 Pi 명령·자연어 Tool에서 재사용하도록 연결했다. Dashboard 연동은 Phase 2에서 기존 workmux TUI로 위임했다. Phase 3의 정확한 세션 재개·읽기 전용 상태 확인까지 구현했습니다. Phase 4의 선택형 Handoff와 Phase 5의 선택형 독립 검증 Extension까지 추가했습니다. 실제 Pi 연동 검증과 Phase 6 통합 시나리오는 남아 있습니다.

**미검증 기술 통합은 필요한 시점에 검증하며, 제품 요구사항을 임의로 축소하지 않는다.**
