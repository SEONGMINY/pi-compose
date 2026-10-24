# pi-compose

Pi를 기반으로 한 개인용 **Composable Coding Agent Harness**.

현재는 설계 문서와 **Phase 1 TypeScript 기반 Launch CLI 및 Pi Slash Command**를 제공한다. 아직 실제 Pi·workmux 통합, Pi Extension의 실제 Pi 로딩, Dashboard 실제 실행 검증, Handoff, 자동 검증까지 완료된 제품은 아니다. **자연어 Launch Tool은 등록했지만 실제 Pi 환경 실행은 미검증**이다.

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

이 테스트는 **옵션 처리·명령 계획·모의 실행 결과**를 검증한다. 실제 Pi·workmux·Dashboard의 성공을 보장하지 않는다.

## Dashboard — workmux 재사용

별도 Dashboard를 구현하지 않고 기존 workmux TUI를 호출한다. **workmux와 tmux는 직접 설치해야 하며 Pi 실행 상태를 보려면 workmux Pi status Extension 설정이 필요**하다. 상태 Hook은 자동 설치하지 않는다.

```bash
node bin/pi-compose.ts dashboard
node bin/pi-compose.ts dashboard --session
node bin/pi-compose.ts dashboard --tab worktrees
```

Pi가 tmux 터미널 안에서 실행 중일 때는 `/compose dashboard` 또는 `/compose dashboard worktrees`로 tmux 팝업을 열 수 있다. Popup 종료는 개발 세션 종료를 의미하지 않는다. **Pi Done 상태를 작업 완료·Handoff로 취급하지 않는다.**

## Pi 내부 명령 (현재 미검증)

Pi 공식 Extension API를 사용한 `/compose` 명령의 첫 구현이 들어 있다.

```text
/compose preview 회원 API 구현
/compose launch 회원 API 구현
```

Pi UI에서 Context와 Workspace를 선택한다. Fork라면 **현재 Pi 세션 / 같은 프로젝트의 다른 저장 세션 / 직접 파일 지정** 중에서 선택하며, Worktree라면 새 브랜치를 입력한다. **현재 세션을 Main이라고 임의로 취급하지 않는다.**

사용자가 자연어로 새 개발 에이전트 실행을 명시적으로 요청하면 모델이 `compose_launch` Tool을 사용할 수 있다. 이 경로는 **실제 실행 전 사용자 확인을 요구**하며, 확인 UI가 없으면 실행하지 않는다. 명시적 `/compose launch` 명령은 별도 재승인을 요구하지 않는다.

**실제 Pi 로딩과 실행 동작은 해당 환경에서 확인이 필요**하다.

## 문서

[설계 문서 인덱스](docs/README.md) · [PRD](docs/PRD.md) · [TRD](docs/TRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) · [Phase 1 구현·검증 상태](docs/validation/phase1-launch.md) · [Phase 2 Dashboard 연동](docs/validation/phase2-dashboard.md)

## 앞으로의 작업

공통 Launch 진입점을 Pi 명령·자연어 Tool에서 재사용하도록 연결했다. Dashboard 연동은 Phase 2에서 기존 workmux TUI로 위임했다. 다음은 **Phase 3 Resume·재시도·안전한 정리**, 이후 Handoff와 독립 검증이다.

**미검증 기술 통합은 필요한 시점에 검증하며, 제품 요구사항을 임의로 축소하지 않는다.**
