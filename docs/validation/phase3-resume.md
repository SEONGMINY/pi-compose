# Phase 3 — 기존 세션 재개, 실패 진단, 안전한 재시도

- 상태: **안전한 재개 및 읽기 전용 상태 진단 1차 구현; 실제 Pi/tmux/workmux 통합 및 전체 프로젝트 검사 미검증**
- 작성: 2026-10-25
- 제품 계약: [PRD](../PRD.md) FR-16·17·19, [Architecture](../ARCHITECTURE.md), [Implementation Plan](../IMPLEMENTATION_PLAN.md)
- 결정 방향: **불확실성은 필요한 시점에 검증한다. 검증 미완료로 다음 개발을 자동 차단하지 않는다.**

## 1. 해결하려는 실제 문제

처음 Launch 시 Worktree 또는 tmux Session이 생성됐지만 Pi 실행이 실패할 수 있다.
기존 `planLaunch()`는 같은 Worktree 브랜치가 있으면 새 생성 요청을 거부했지만,
사용자는 실패 이후 어떤 자원이 남았는지 확인하고 정확한 세션을 재개하는 경로가 없었다.

현재 구현은 **“새 Launch와 기존 Pi Session의 Resume는 다른 동작”**이라는 계약을 유지한다.

- 새 Launch는 기존 옵션·4가지 Context/Workspace 조합을 유지한다.
- Resume은 **정확히 지정한 Pi 세션 파일**에서 시작한다. 가장 최근 Pi Session을 임의로 선택하지 않는다.
- Git Worktree의 실제 경로·기존 변경은 Git에서 조회한다.
- 이미 있는 tmux 대상에는 새 Pi 프로세스를 만들지 않는다.
- 코드·Worktree·브랜치 삭제는 자동 실행하지 않는다.
- View는 필수가 아니다. 기본 Launch Extension에 명시적인 Resume 명령을 추가했으며 선택형 workmux View는 수정하지 않았다.

## 2. 구현 범위

| 파일 | 책임 |
| --- | --- |
| [`src/resume.ts`](../../src/resume.ts) | Zod 입력 검사, 읽기 전용 Worktree 상태 조회, 정확한 Session/cwd 검증, tmux 충돌 검출, 명시적 Resume |
| [`src/launch.ts`](../../src/launch.ts) | 기존 Pi 세션 JSONL 헤더 검증 함수 재사용을 위해 export (Launch 동작 변경 없음) |
| [`bin/pi-compose.ts`](../../bin/pi-compose.ts) | `inspect`, `resume` 서브커맨드 |
| [`extensions/compose.ts`](../../extensions/compose.ts) | 기본 Pi Package의 `/compose resume`로 세션 선택 및 재개 |
| [`test/compose.test.ts`](../../test/compose.test.ts) | 기존 Pi 세션을 잘못 중복 재개하지 않는지 검사 |

## 3. 사용 방법

### 실패한 Worktree 생성 결과 확인 (읽기 전용)

```bash
node bin/pi-compose.ts inspect --cwd /path/to/project --branch feat/member-api
```

| 결과 | 의미 |
| --- | --- |
| `worktree-existing` | Git이 해당 브랜치의 실제 Worktree 경로를 찾음. 작업 상태는 `dirty` 필드로 구분 |
| `branch-only` | 로컬 브랜치는 존재하지만 해당 브랜치가 체크아웃된 Worktree는 없음 |
| `not-found` | Git Worktree 및 로컬 브랜치를 발견하지 못함 |

`inspect`는 Worktree를 생성·삭제하거나 Commit/Reset을 실행하지 않는다.
브랜치가 메인 체크아웃에 있는 경우도 별도 Worktree로 잘못 판단하지 않는다.

### 정확한 기존 Pi 대화 재개

```bash
# Shared Directory: 저장된 Pi Session 파일을 명시적으로 지정
node bin/pi-compose.ts resume \
  --workspace shared \
  --cwd /path/to/project \
  --session-file /absolute/path/to/agent.jsonl \
  --dry-run

# 검토 후 실행: --dry-run 제거
node bin/pi-compose.ts resume \
  --workspace shared \
  --cwd /path/to/project \
  --session-file /absolute/path/to/agent.jsonl

# Worktree: 브랜치와 정확한 Pi 대화 모두 선택
node bin/pi-compose.ts resume \
  --workspace worktree \
  --cwd /path/to/project \
  --branch feat/member-api \
  --session-file /absolute/path/to/agent.jsonl
```

재개 명령은 `pi --session <정확한 파일 경로>`를 tmux에서 실행한다.
Pi가 제공하는 `--continue` 또는 workmux `open --continue`를 사용하지 않는다.
이 옵션들은 최근 세션을 선택할 수 있어서 다중 세션이 있는 경우
**사용자가 원하는 정확한 대화를 증명하지 못하기 때문**이다.

### Pi 내부 명령

```text
/compose resume
```

- Worktree 또는 Shared Directory를 선택한다.
- 사용자가 저장 세션 목록에서 **현재 사용 중인 Pi 세션이 아닌 정확한 원본**을 선택하거나 파일 경로를 지정한다.
- Worktree라면 기존 Git 브랜치를 선택한다.
- 기존 View와 무관하게 Pi Package의 기본 Extension만으로 동작한다.

## 4. 중복 실행과 실패 경계

1. 동일 Pi Session 파일 + 작업 디렉터리로부터 **결정적 tmux 대상 이름**을 생성한다.
2. 실행 계획 작성 시 `tmux has-session -t =<이름>`으로 해당 대상을 읽기 전용 확인한다.
3. 실제 실행 직전 **다시 확인**한다. 이미 존재하면 `target_occupied_no_launch`를 반환하고 새 Pi를 생성하지 않는다.
4. 없다면 `tmux new-session -d -s <이름> -c <작업 디렉터리> 'pi --session <파일>'`로 명시적 재개한다.
5. 외부 명령이 실패해도 Worktree·브랜치·Pi 세션·tmux를 강제로 삭제하지 않는다.

사용자가 `--tmux-target`을 제공하면 지정한 대상 이름을 확인한다. 이름에는
영문자·숫자·`_`·`-`만 허용해 다른 tmux 대상에 잘못 연결하는 것을 피한다.

**신뢰 한계:** 이 검사는 정확한 tmux **대상 이름만** 확인한다. 같은 Pi 세션이
다른 tmux 세션·별도 터미널에서 실행 중인지까지 보장하지 않는다.
대상을 발견했더라도 어떤 Pi 대화인지 확정할 수 없으므로
`already_running` 같은 강한 완료 표현 대신 **`target_occupied_no_launch`** 로 표시한다.

Worktree는 미커밋 파일이 있어도 삭제·Reset 없이 재개할 수 있도록 한다.
Worktree 경로와 Pi 세션 기록의 원래 `cwd`가 다르면 중단한다.

## 5. 이번 단계의 삭제·정리 범위

**파괴적인 `cleanup` / `remove` 명령은 구현하지 않았다.**

현재 원칙은 사용자 선택 없이 세션·Worktree를 정리하지 않는 것이다.
Git Worktree가 dirty일 수 있고, 실패한 실행에서 생성한 브랜치를 사용자가
이어 사용 중일 수도 있다. `workmux remove`나 `git worktree remove`를 자동화하면
출처가 불확실한 변경을 잃을 위험이 있다.

현재는 `inspect`로 정확한 상태를 확인하고 실제 정리는 **명시적인 사용자 동작**으로 수행하도록 남겨둔다.
나중에 정리 명령을 추가한다면 사용자 요청·대상 확인·Dirty 파일 보존을 먼저 명시해야 한다.
이는 Phase 3 전체 완료를 주장하지 않는 이유다.

## 6. 검증 방식

- **Extension 고유 동작만 자동 테스트 유지:** 현재 실행 중인 Pi 세션을 중복 재개하지 않도록 하는 `/compose resume`의 사용자 선택과 실행 금지.
- **기존 Git·tmux 동작:** 별도 모의 명령 테스트 대신 필요 시 `inspect`, `resume --dry-run`, 실제 도구를 실행하고 출력·Git 상태를 확인.
- 이전에는 격리된 테스트 전용 Git Worktree로 경로 및 미커밋 파일 조회를 확인했다. 이것을 실제 Pi 세션 재개 검증으로 간주하지 않는다.
- 새로운 Phase 3 코드의 전체 TypeScript 검사 및 Pi/tmux 실연동은 아직 확인이 필요하다. **미검증은 다음 개발의 자동 Gate가 아니다.**

검증 코드가 제품 코드를 다시 구현하는 방향으로 늘어나지 않도록, 외부 도구 조합 단위 테스트는 현행 정책에 따라 제거했다.
