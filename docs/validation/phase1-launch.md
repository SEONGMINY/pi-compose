# Phase 1 — 공통 Launch 첫 구현

- 상태: **계획/명령 구성 테스트 완료 · 실제 Pi/workmux 실행 미검증 · Phase 1 일부 구현**
- 작성일: 2026-10-25
- 근거: [PRD](../PRD.md) FR-02~07, [Architecture](../ARCHITECTURE.md), [Implementation Plan](../IMPLEMENTATION_PLAN.md)
- 정책: 사용자의 결정에 따라 **Phase 0은 부분 완료 상태로 종료**한다. 나머지 실제 환경 호환성 검증은 **그 연동을 사용할 시점에만** 수행하며 현재 설계와 개발의 사전 Gate로 사용하지 않는다.

## 1. 이번 구현 범위

외부 패키지를 설치하거나 자체 세션 관리 엔진을 만들지 않고, 사용자 옵션을 기존 도구 호출로 변환하는 **작은 Node.js CLI**를 작성했다.

| 파일 | 책임 |
| --- | --- |
| [`src/launch.mjs`](../../src/launch.mjs) | 실행 요청 검증, Pi 세션 헤더 확인, Git 기준 확인, 도구별 명령 계획 생성, 기존 명령 호출 |
| [`bin/pi-compose.mjs`](../../bin/pi-compose.mjs) | `launch` 진입점·`--dry-run`·요약 JSON 출력 |
| [`test/launch.test.mjs`](../../test/launch.test.mjs) | 네 가지 실행 조합·오류·안전한 인자 처리 테스트 |
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
node bin/pi-compose.mjs launch \
  --task "회원 API 구현" \
  --context fork \
  --source-session-file /path/to/main.jsonl \
  --workspace worktree \
  --cwd /path/to/project \
  --branch feat/member-api \
  --dry-run

# 실제 실행은 --dry-run을 제거한 명시적인 launch 명령
# node bin/pi-compose.mjs launch ... 
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

격리 환경의 Node.js `22.16.0`에서 `node --test`를 실행해 **10개 단위 테스트 모두 통과**했다. Node.js 기본 모듈만 사용하므로 테스트 자체는 이 버전에서 수행 가능했다.

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
| Pi `/compose launch` Extension | 미구현 | 공통 Launch CLI를 재사용하는 다음 범위 |
| 자연어 Tool 및 사용자 선택 UI | 미구현 | Pi Extension 연결이 필요할 때 |
| Dashboard 세션 확인·전환 | 미구현 | Phase 2 |
| 실패 후 식별·안전 재개·중복 방지 | 일부 사전 오류 처리만 구현 | Phase 3 |
| 자동 Handoff 및 검증 | 미구현 | Phase 4~5 |

CLI에 모든 옵션을 직접 입력하는 경험을 최종 사용자 경험으로 확정한 것이 아니다. **반복 작업을 한 번의 Pi 명령·자연어 실행으로 추상화하는 목표는 유지**한다. 이번 코드는 그 진입점들이 공유할 결정적 실행 경계다.

## 5. 불확실성 관리 결정

현재 의사결정에 필요 없는 모든 불확실성을 먼저 제거하지 않는다.

- **지금 확인할 것:** 실행 옵션의 명시성, 네 가지 조합 분리, 원본 세션 오선택 방지, Git 사전 검사, 잘못된 명령/셸 인젝션 방지, 미검증 성공 주장 방지.
- **실제 호출 시 확인할 것:** Pi CLI와 workmux CLI의 실제 호환성, Pi 세션/작업 디렉터리 생성과 tmux 동작.
- **Dashboard 연결 시 확인할 것:** 상태 Hook, 세션 발견·분할·직접 제어.
- **Handoff 연결 시 확인할 것:** 완료 신호와 Git 스냅샷의 관계, 중복 기본 검사.

검증을 미루는 것은 검증했다고 주장하는 일이 아니다. **불확실성을 근거와 함께 기록하고 필요한 시점에 확인**한다.
