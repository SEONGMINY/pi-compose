# pi-compose

Pi를 기반으로 한 개인용 **Composable Coding Agent Harness**.

현재는 설계 문서와 **Phase 1 TypeScript 기반 Launch CLI 및 Pi Slash Command**를 제공한다. 아직 실제 Pi·workmux 통합, Pi Extension의 실제 로딩, Dashboard·Handoff 전달 및 독립 검증의 실제 실행까지 확인한 제품은 아니다. **자연어 Launch Tool은 등록했지만 실제 Pi 환경 실행은 미검증**이다.

## 핵심 원칙

- Main Agent는 설계·의사결정의 원래 이유와 강한 제약을 보존한다.
- Context(Fork/Independent), Workspace(Shared/Worktree), 실행 시점과 순차·병렬 여부를 독립적으로 선택한다.
- 개발 세션은 **사용자의 명시적 실행 요청**이 있을 때 생성한다.
- Pi·Git·tmux·기존 도구 기능은 재사용하고 반복 준비 작업을 추상화한다.
- Main이 상세 Git Diff·테스트 로그를 직접 분석하도록 강제하지 않는다.
- 완료 Handoff, 검증, 실제 Git 통합, Worktree 정리를 서로 구분한다.

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
| **Launch** | 기본 Package에 포함 | `/compose launch`, `/compose preview` |
| **workmux View** | 사용자가 명시적으로 추가 | `/compose-workmux [agents\|worktrees]` |
| **Handoff** | 사용자가 명시적으로 추가 | `/compose-handoff [recipient]` 및 `compose_handoff` Tool |
| **Independent Verification** | 사용자가 명시적으로 추가 | `/compose-verify [base-ref]` |
| **사용자 정의 TUI / Extension** | Pi 기본 Extension/Package 방식으로 별도 추가 | 각 Extension의 명령 |

### 설치와 선택형 View 활성화

```bash
# 로컬 checkout에서 기본 Pi Compose만 설치 (Launch만 로드)
pi install /absolute/path/to/pi-compose

# workmux View를 이 세션에서만 명시적으로 로드
pi -e /absolute/path/to/pi-compose/extensions/optional/workmux-dashboard.ts
```

계속 사용할 때는 **Pi 설정**(`~/.pi/agent/settings.json` 등)의 `extensions` 리소스 경로에
실제 Extension 파일의 절대 경로를 추가합니다.

```json
{
  "extensions": [
    "/absolute/path/to/pi-compose/extensions/optional/workmux-dashboard.ts"
  ]
}
```

이 예시는 **로컬 소스 체크아웃 기준**입니다. 이미 설정 파일이 있다면 기존 `extensions` 값에
추가하세요. 기본 Package는 `extensions/compose.ts`만 노출하며,
선택형 View는 Pi Package 필터만으로 자동 활성화되지 않습니다.

Pi가 로컬 디렉터리에서 Extension을 자동 탐색할 때도 뜻하지 않게 로드되지 않도록
선택형 파일을 `extensions/optional/`에 배치했습니다(해당 디렉터리에 `index.ts` 없음).

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

## Pi 내부 명령 (현재 미검증)

Pi 공식 Extension API를 사용한 `/compose` 명령의 첫 구현이 들어 있다.

```text
/compose preview 회원 API 구현
/compose launch 회원 API 구현
```

Pi UI에서 Context와 Workspace를 선택한다. Fork라면 **현재 Pi 세션 / 같은 프로젝트의 다른 저장 세션 / 직접 파일 지정** 중에서 선택하며, Worktree라면 새 브랜치를 입력한다. **현재 세션을 Main이라고 임의로 취급하지 않는다.**

사용자가 자연어로 새 개발 에이전트 실행을 명시적으로 요청하면 모델이 `compose_launch` Tool을 사용할 수 있다. 이 경로는 **실제 실행 전 사용자 확인을 요구**하며, 확인 UI가 없으면 실행하지 않는다. 명시적 `/compose launch` 명령은 별도 재승인을 요구하지 않는다.

**실제 Pi 로딩과 실행 동작은 해당 환경에서 확인이 필요**하다.

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
