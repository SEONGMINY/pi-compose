# Phase 2 — Dashboard 연결

- 상태: **기존 workmux 대시보드 실행 연결 구현·기본 위임 테스트 통과 / 실제 Pi+tmux+workmux 통합 미검증**
- 작성일: 2026-10-25
- 기준: [PRD](../PRD.md) FR-07 · [Implementation Plan](../IMPLEMENTATION_PLAN.md)
- 원칙: 기존 Dashboard를 재구현하지 않고 **직접 관찰·전환 기능을 위임**한다. 미검증 항목으로 이후 개발을 자동 차단하지 않는다.

## 1. 실제 구현 범위

| 파일 | 구현 |
| --- | --- |
| [`src/dashboard.ts`](../../src/dashboard.ts) | `workmux dashboard`에 인자 배열로 위임. 상태 정보를 자체 추적하거나 재해석하지 않음 |
| [`bin/pi-compose.ts`](../../bin/pi-compose.ts) | 명시적 `dashboard` 서브커맨드 및 `--session`, `--tab` 옵션 |
| [`extensions/compose.ts`](../../extensions/compose.ts) | `/compose dashboard [agents\|worktrees]`: Pi가 tmux 안에서 동작할 때 네이티브 Dashboard를 **tmux 팝업**으로 표시 |
| [`test/dashboard.test.ts`](../../test/dashboard.test.ts) | 기본 인자, 탭·현재 tmux 세션 필터, 실패 전파·미설치 진단, 안전한 위임 테스트 6개 |
| [`test/compose.test.ts`](../../test/compose.test.ts) | Pi 명령의 잘못된 옵션, tmux 환경 부재, 팝업 생성, 오류 안내 테스트 4개 추가 |

### 사용자 진입점

```bash
# 터미널에서 기존 workmux 대시보드 열기
node bin/pi-compose.ts dashboard

# 현재 tmux session에 속한 에이전트만
node bin/pi-compose.ts dashboard --session

# 특정 Worktrees 또는 Agents 탭에서 시작
node bin/pi-compose.ts dashboard --tab worktrees
```

Pi가 tmux 안에서 실행 중이라면:

```text
/compose dashboard
/compose dashboard agents
/compose dashboard worktrees
```

Pi 명령은 `tmux display-popup -E`에 `workmux dashboard`를 전달한다. 팝업 종료는 기존 Pi 세션·Worktree 삭제나 개발 완료를 의미하지 않는다.

명시적인 사용자 동작으로만 대시보드를 연다. Launch 시마다 새 대시보드를 자동 생성하거나 Main 컨텍스트를 긴 상태 로그로 채우지 않는다.

## 2. 기존 패키지에 위임하는 범위

`workmux dashboard`의 기본 기능을 활용한다.

- **Agents 탭:** 실행 중인 에이전트 Pane 발견, 활동 상태, 선택한 에이전트의 터미널 미리보기, 입력 전달과 직접 전환.
- **Worktrees 탭:** 이미 존재하는 Git Worktree·브랜치·에이전트 정보를 확인.
- **다중 tmux 세션:** 기본 Dashboard는 전체 tmux 세션의 추적된 에이전트를 보여줄 수 있고, `--session`으로 현재 세션으로 좁힐 수 있다.
- **Shared Directory:** 특정 Worktree의 내부 세션만 표시하는 방식이 아니므로, Pi 상태 추적 Extension이 등록한 일반 tmux Pane도 관찰 대상이 될 수 있다.

이 내용은 **workmux 공개 문서와 코드에서 확인한 기능 범위**다. 현재 실제 Pi Compose 실행 세션이 Dashboard에 나타나는지에 대한 통합 검증은 남아 있다.

근거: [workmux Dashboard](https://workmux.raine.dev/guide/dashboard/) · [Status Tracking](https://workmux.raine.dev/guide/status-tracking/).

## 3. 상태 의미와 보안 경계

- Dashboard는 **실행 상태를 관찰**하는 도구이다. Idle/Done은 **개발 완료·Handoff·검증 완료가 아니다.**
- workmux의 Pi Hook은 **사용자 입력 대기(Waiting)** 상태를 완전히 지원하지 않는다. 따라서 Pi Compose가 추측한 “대기 중” 상태를 만들어 표시하지 않는다.
- 상태 Hook이 없으면 목록이 비어 있을 수 있다. **목록이 비었다 = Pi 세션이 삭제됐다는 의미가 아니다.**
- Pi Compose는 Pi SessionManager·Git·tmux와 경쟁하는 상태 데이터베이스나 자체 완료 판정기를 만들지 않는다.
- 사용자 요청 없이 `workmux setup`을 실행하거나 전역 Pi/tmux 설정 파일에 Hook을 설치하지 않는다.
- Worktrees 탭에 제공되는 workmux의 **삭제 명령은 실제로 Worktree·브랜치 및 관련 실행 창을 정리할 수 있으므로** 사용자가 선택하기 전에는 실행하지 않는다.
- Dashboard Popup을 닫을 때 개발 세션을 종료하거나 변경 파일을 정리하지 않는다.

## 4. 실제 설정과 미검증 사항

**외부 도구 요구사항**

1. 호환되는 tmux와 workmux가 설치돼 있어야 한다. `pi-compose`는 패키지를 자동 설치하지 않는다.
2. Pi 세션 상태 표시에 workmux Pi status Extension이 필요하다. 기존 Hook이 있다면 충돌·중복 설치를 먼저 확인한다.
3. CLI의 `dashboard`는 workmux 네이티브 TUI를 실행하므로 터미널이 필요하다.
4. Pi의 `/compose dashboard`는 **tmux 안에서 실행 중일 때만** Popup을 시도한다. TUI 또는 tmux 환경이 없을 경우 실행하지 않고 CLI 사용법을 알린다.

**검증 계획 — 실제 패키지 연동을 수행할 때**

- Main Pi Pane, Shared Directory Pi Pane, Worktree Pi Pane을 각각 실행한 후 **한 대시보드에서 식별·전환** 가능한지.
- Hook 설치 전 목록 부재와 설치 후 목록 노출을 구분하는지.
- Pi 실행 상태의 실제 표시, Preview, 입력 전달 및 분할 전환.
- Pi Popup을 닫아도 원본 Pi 세션과 별도 개발 세션이 유지되는지.
- 외부 Pi 세션이 없는 상황과 tmux/Hook 오류를 사용자에게 구분해 설명하는지.

## 5. 현재 실행한 검증

- **격리 Node.js 22.16.0**에서 `node --experimental-strip-types --test test/dashboard.test.ts`를 실제 실행했고 **6/6 통과**했다. dashboard 모듈은 Node 기본 API만 사용하므로 별도 npm 설치가 필요 없었다.
- Pi Extension에 대한 Dashboard 명령 모의 테스트 **4개를 추가**했다. 현재 실행 컨테이너에는 `zod`와 Pi 타입·런타임이 없어 **이번 변경의 전체 프로젝트 타입 검사와 이 4개 테스트는 실행하지 못했다.**
- GitHub 저장소의 CI 워크플로는 다른 커밋에서 제거된 상태여서 임의로 복원하지 않았다.
- 기존 Phase 1의 **24개 테스트는 이전 CI에서 통과**했다. 이것이 이번 코드 변경 후 전체 34개 테스트가 통과했다는 뜻은 아니다.
- 실제 workmux Dashboard/Tmux Popup 실행은 본 환경에 바이너리가 없어 아직 미수행.

## 6. 추가 구현을 하지 않은 이유

- 별도 React Dashboard, Session Registry, Poller, Hook 자동 설치기 및 자체 Preview는 **workmux의 기존 책임과 중복**된다.
- 세션 재개·중복 생성 방지는 Dashboard가 아닌 **Phase 3**에서 실제 Pi/Worktree 식별자로 구현한다.
- 에이전트의 명시적 완료 인계 및 기본 Git 검사는 **Phase 4**의 책임이다.

따라서 현재 Phase 2 범위는 **실행 가능한 기존 Dashboard에 연결하고 사용자가 Pi/CLI에서 직접 여는 경험까지**로 한정한다.
