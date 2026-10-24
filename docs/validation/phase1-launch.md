# Phase 1 — 공통 Launch 첫 구현

- 상태: **Launch CLI + Pi 명시적 Slash Command + 사용자 확인형 자연어 Tool 구현 · 실제 Pi/workmux 실행 미검증 · Phase 1 주요 기능 구현**
- 작성일: 2026-10-25
- 근거: [PRD](../PRD.md) FR-02~07, [Architecture](../ARCHITECTURE.md), [Implementation Plan](../IMPLEMENTATION_PLAN.md)
- 정책: 사용자의 결정에 따라 **Phase 0은 부분 완료 상태로 종료**한다. 나머지 실제 환경 호환성 검증은 **그 연동을 사용할 시점에만** 수행하며 현재 설계와 개발의 사전 Gate로 사용하지 않는다.

## 1. 이번 구현 범위

외부 패키지를 설치하거나 자체 세션 관리 엔진을 만들지 않고, 사용자 옵션을 기존 도구 호출로 변환하는 **작은 Node.js CLI**를 작성했다.

| 파일 | 책임 |
| --- | --- |
| [`src/launch.ts`](../../src/launch.ts) | 실행 요청 검증, Pi 세션 헤더 확인, Git 기준 확인, 도구별 명령 계획 생성, 기존 명령 호출 |
| [`bin/pi-compose.ts`](../../bin/pi-compose.ts) | `launch` 진입점·`--dry-run`·요약 JSON 출력 |
| [`extensions/compose.ts`](../../extensions/compose.ts) | Pi `/compose launch [task]` 및 `/compose preview [task]` 명령, 공통 Launch 재사용 |
| [`test/launch.test.ts`](../../test/launch.test.ts) | 네 가지 실행 조합·오류·안전한 인자 처리 테스트 |
| [`package.json`](../../package.json) | 외부 런타임 의존성 없는 최소 Node 실행 구성 |

## 2. 네 가지 실행 조합

| Context | Workspace | 현재 계획 경로 |
| --- | --- | --- |
| Fork | Shared Directory | 명시적 원본 파일의 Pi `--fork` + `tmux new-session` |
| Independent | Shared Directory | 새 Pi + `tmux new-session` |
| Fork | Git Worktree | `workmux add <branch> --agent pi --base <sha> --fork=<session-id> --prompt <task>` |
| Independent | Git Worktree | `workmux add <branch> --agent pi --base <sha> --prompt <task>` |

### 사용법 예시

```bash
# 커밋·Worktree 생성 없이 실행 계획만 확인
node bin/pi-compose.ts launch \
  --task "회원 API 구현" \
  --context fork \
  --source-session-file /path/to/main.jsonl \
  --workspace worktree \
  --cwd /path/to/project \
  --branch feat/member-api \
  --dry-run

# 실제 실행은 --dry-run을 제거한 명시적인 launch 명령
# node bin/pi-compose.ts launch ... 
```

### 보존하는 규칙

- **원본 세션을 최근 세션으로 추측하지 않는다.** Fork에는 원본 Pi Session JSONL의 실제 파일 경로가 필수다.
- **Context와 Workspace는 독립적인 필수 선택**이다. 어느 조합도 다른 옵션을 암묵적으로 강제하지 않는다.
- **Worktree는 새로운 브랜치만 생성**한다. 기존 브랜치 발견 시 중단하며 Resume/기존 Worktree 재사용은 Phase 3에서 분리한다.
- **Git 기준 커밋 SHA를 확정**하고 Worktree에 전달한다. 소스 체크아웃의 미커밋 변경은 새 Worktree로 복사되지 않으므로 경고한다.
- `workmux`는 Pi Session을 원본 저장 경로의 cwd와 Repo Root로 발견하므로, Fork + Worktree에서 불일치가 확인되면 임의 Fork 대신 오류를 반환한다.
- 사용자 요청은 인자 배열로 처리한다. tmux에 전달되는 셸 명령은 토큰마다 안전하게 quote한다.
- `--dry-run`은 명령과 옵션을 반환하되 실제 프로그램 실행·Git 변경을 하지 않는다.
- 외부 도구 명령이 성공해도 **Pi 실제 세션 시작과 Dashboard 가시성은 검증하지 않았다**고 반환한다.
- 실패 후 기존 Worktree·tmux 세션을 임의로 정리하지 않는다. 사용자의 변경 내용을 삭제하지 않는다.

## 3. 검증 결과

**2026-10-25 GitHub Actions Node 22.19.0:** `npm run check`로 `tsc --noEmit` 타입 검사와 **24개 단위 테스트 모두 통과**했다. [CI 실행 결과](https://github.com/SEONGMINY/pi-compose/actions/runs/40121931523). 원래 11개와 Zod 관련 5개에 Pi 진입점/권한 경계 8개를 더했다.

또 임시 Git 저장소에서 실제 Git을 사용한 두 종류의 `--dry-run`을 실행했다.

- Fork + Worktree: Pi 원본 JSONL의 명시적 ID, 실제 Git 기준 커밋 SHA, workmux 인자를 확인.
- Independent + Shared: Pi 실행 문자열, tmux 세션 대상과 cwd를 확인.
- 실행 전후 임시 저장소에 **새 브랜치/Worktree가 생성되지 않음**을 확인.

**이 검증은 Pi/workmux의 실제 실행 확인이 아니다.** 등록된 실행 도구로 실제 에이전트가 시작·유지·재개되는 단계는 미수행이다.

## 4. 남은 기능·알려진 한계

| 기능 | 상태 | 검증·구현 시점 |
| --- | --- | --- |
| 공통 CLI로 4개 실행 조합의 명령 계획 | 구현·테스트 완료 | 지금 |
| 실제 최신 Pi + workmux 실행 | 미검증 | 해당 외부 연동을 실제 호출할 때 |
| Shared Directory의 tmux/Pi 실제 실행 | 미검증 | 해당 외부 연동을 실제 호출할 때 |
| Pi `/compose launch` Extension | **초기 구현·모의 UI 테스트 통과** | 실제 Pi 로딩·설치·실행은 연동 시 검증 |
| Pi 원본 세션 선택 | **구현: 현재/프로젝트 목록/직접 파일 경로** | 실제 Pi TUI에서 메뉴 동작 검증 필요 |
| 자연어 Launch Tool | **구현: 모델 Tool + 명시적 사용자 확인** | 실제 Pi에서 Tool 호출·TUI 확인 검증 필요 |
| Dashboard 세션 확인·전환 | 미구현 | Phase 2 |
| 실패 후 식별·안전 재개·중복 방지 | 일부 사전 오류 처리만 구현 | Phase 3 |
| 자동 Handoff 및 검증 | 미구현 | Phase 4~5 |

현재 Pi 명시적 명령의 사용 예시는 `/compose launch 회원 API 구현` 또는 `/compose preview 회원 API 구현`이다. Pi UI에서 Context, Workspace, 원본 세션 파일(필요 시), 브랜치(필요 시)를 선택하도록 설계했다. **실제 Pi 환경에서의 UI 실행은 미검증**이다.

CLI에 모든 옵션을 직접 입력하는 경험을 최종 사용자 경험으로 확정한 것이 아니다. **반복 작업을 한 번의 Pi 명령·자연어 실행으로 추상화하는 목표는 유지**한다. 이번 코드는 그 진입점들이 공유할 결정적 실행 경계다.

## 5. 불확실성 관리 결정

현재 의사결정에 필요 없는 모든 불확실성을 먼저 제거하지 않는다.

- **지금 확인할 것:** 실행 옵션의 명시성, 네 가지 조합 분리, 원본 세션 오선택 방지, Git 사전 검사, 잘못된 명령/셸 인젝션 방지, 미검증 성공 주장 방지.
- **실제 호출 시 확인할 것:** Pi CLI와 workmux CLI의 실제 호환성, Pi 세션/작업 디렉터리 생성과 tmux 동작.
- **Dashboard 연결 시 확인할 것:** 상태 Hook, 세션 발견·분할·직접 제어.
- **Handoff 연결 시 확인할 것:** 완료 신호와 Git 스냅샷의 관계, 중복 기본 검사.

검증을 미루는 것은 검증했다고 주장하는 일이 아니다. **불확실성을 근거와 함께 기록하고 필요한 시점에 확인**한다.

## 6. TypeScript 및 Zod 리팩터링 (2026-10-25)

- Node.js `>=22.19.0` 기본 TypeScript type stripping을 활용해 CLI를 별도 빌드 없이 직접 실행한다. Pi Extension은 Pi 공식 `jiti` 로더가 TypeScript 소스를 처리한다. `tsconfig.json`은 `strict`, `noEmit`, `NodeNext`, `erasableSyntaxOnly`를 설정했다.
- 외부 Launch 입력의 옵션 값과 조합은 **Zod 스키마 단일 정의**로 검증한다. 입력 타입은 `z.infer`에서 추론하고, 기존 `validateRequest()` 호출 방식은 유지한다.
- Pi 세션 JSONL은 **첫 헤더만** 읽어 `type`, `id`, `cwd`를 Zod로 검증하며, 대화 본문을 불필요하게 읽지 않는다.
- Git이 반환하는 기준 커밋 SHA와 저장소 루트는 외부 경계 검증을 한다. 브랜치 이름의 상세 규칙은 Git `check-ref-format`이 처리한다. Workmux의 일반 텍스트 출력을 고정 JSON 스키마인 것처럼 검증하지 않는다.
- 내부 `LaunchPlan`, Process runner/결과, Pi 세션 참조는 TypeScript 타입으로 표현하며 Zod를 중복 적용하지 않는다.
- 이전 `.mjs` 네 파일은 제거했고 `.ts`로 이동했다. 기존 CLI 옵션·Pi `/compose` 명령·네 가지 Launch 조합과 오류 안전장치는 유지한다.
- 의존성: 런타임 `zod@4.6.5`; 타입 검사용 `typescript~5.8.3`, `@types/node`, `@earendil-works/pi-coding-agent@1.4.0` (개발 및 peer). 별도 번들러나 `tsx` 없음.
- **실사용 Pi·workmux 통합은 아직 검증하지 않았다.** 현재 통과는 실제 설치가 가능한 CI 환경에서 수행한 타입 검사와 모의·입력 검증 테스트를 의미한다.

## 7. 현재 세션 선택·자연어 실행 연결 (2026-10-25)

- `/compose launch` 및 `/compose preview`의 Fork 선택에서 현재 Pi 세션 파일을 `ctx.sessionManager.getSessionFile()`로 취득한다. 매번 파일 경로를 복사할 필요가 없다.
- 사용자가 다른 저장 세션을 선택하면 Pi의 공식 `SessionManager.list()`로 **현재 프로젝트의 저장 세션**만 요청 시 조회하고, 선택한 실제 경로를 전달한다. 프로젝트 외 세션을 사용할 때는 직접 파일을 지정한다.
- **현재 Pi 세션을 Main으로 자동 추정하지 않는다.** 'Current Pi session'은 사용자가 명시적으로 고른 경로일 뿐이다. 현재 세션 기록 파일이 없다면 임의의 최근 세션으로 대체하지 않는다.
- `compose_launch`는 Pi의 `registerTool` + `@earendil-works/pi-ai` TypeBox 입력 스키마를 사용한다. 새 개발 에이전트 실행을 **사용자가 요청한 경우에만** 호출하도록 지침을 명시했으며, 실행 전 `ctx.ui.confirm()`으로 대상 작업·컨텍스트·원본 ID·Worktree를 보여준다. 거절 또는 UI 미지원이면 실행하지 않는다.
- `/compose` 명령과 자연어 Tool은 기존 `planLaunch()`·`executeLaunch()`를 공유한다. 별도 실행 엔진이나 세션 등록 DB는 만들지 않았다.
- **검증:** CI의 기존 테스트 16개 + 새 Pi 인터페이스/실행 권한 테스트 8개, 총 24개 통과. 현재/직접 파일 경로 미리보기, 미저장 현재 세션, 원본 누락, 취소 및 UI 부재로 인한 무실행을 포함한다.
- **미검증:** 실제 Pi TUI에서 `SessionManager.list()`의 저장 세션 메뉴, 실제 모델 도구 호출·사용자 확인 UI, 실제 Pi/workmux 프로세스 생성.
