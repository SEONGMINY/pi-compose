# Phase 0 실행 검증 — Baseline

- 점검일: **2026-10-25**
- 구분: **부분 통과 / 실제 Pi + workmux 통합 실행은 환경 제약으로 미수행**
- 관련: [Implementation Plan — Phase 0](../IMPLEMENTATION_PLAN.md#3-phase-0--기존-기능과-호환성-확인), [TRD](../TRD.md)
- 자동 사전 점검: [`scripts/phase0-preflight.sh`](../../scripts/phase0-preflight.sh)
- 대상: 격리된 ChatGPT 실행 컨테이너(**사용자의 Mac/로컬 개발 환경이 아님**)

## 1. 실제 실행 환경

| 항목 | 결과 | 검증 |
| --- | --- | --- |
| OS | Linux x86_64 | 실행 환경 확인 |
| Git | `2.47.3` | 실행 확인 |
| Node.js | `22.16.0` | 실행 확인 |
| Pi | **미설치** | `command -v pi` |
| workmux | **미설치** | `command -v workmux` |
| tmux | **미설치** | `command -v tmux` |
| 외부 접근 | **DNS 조회 실패** | 외부 GitHub URL 연결 불가 |

**중요:** 현재 Pi `1.4.0`의 `packages/coding-agent/package.json`은 `node >=22.19.0`을 요구한다. 이 실행 환경의 Node `22.16.0`은 **요구 버전보다 낮다**.

이 제약 때문에 격리 컨테이너 안에서 실제 Pi와 workmux를 설치·실행해 통합 시험을 수행할 수 없었다. **설치/실행을 시도한 것처럼 기록하거나 합격으로 표시하지 않는다.**

출처:
- [Pi `package.json`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)
- [Pi Sessions CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md)
- [workmux v0.1.277 changelog](https://github.com/raine/workmux/blob/main/CHANGELOG.md)

## 2. 수행한 실제 테스트 — Git 격리 검증

자동 검사 Script를 작성하고 격리 컨테이너에서 `bash -n` 및 실제 실행을 완료했다.

이 스크립트는 사용자 현재 레포를 수정하지 않고, `mktemp -d`에 **새로운 임시 Git 레포만 만든 뒤 자동 정리**한다. 패키지 설치·외부 요청·Git 원격 접근은 하지 않는다.

| 시험 | 실제 결과 | 범위 |
| --- | --- | --- |
| Git 임시 레포 생성·초기 커밋 | PASS | 자체 생성한 임시 레포 |
| 기준 SHA에서 새 Worktree 생성 | PASS | 자체 생성한 별도 Worktree |
| 원본 체크아웃의 내용 불변 | PASS | 원본 `contract.txt` 변경 없음 |
| 기존 원본 레포의 dirty 여부 | PASS | 원본은 clean |
| Staged 파일 변경 탐지 | PASS | `git diff --cached` |
| Unstaged 파일 변경 탐지 | PASS | `git diff` |
| Untracked 신규 파일 탐지 | PASS | `git ls-files --others --exclude-standard` |
| 스테이지별 공백 오류 검사 | PASS | `git diff --check`, `git diff --cached --check` |
| 최신 Pi 실제 Fork 실행 | **BLOCKED** | Pi 미설치, Node 하한 미충족 |
| workmux/tmux 실제 연결 | **BLOCKED** | 바이너리 미설치 |
| Dashboard Pi 상태·전환 | **BLOCKED** | 실제 Pi/tmux 없음 |

실행 출력 요약:

```text
FOUND git      /usr/bin/git
FOUND node     .../node
MISSING pi
MISSING workmux
MISSING tmux
Node.js v22.16.0
INCOMPATIBLE Node.js <22.19.0

PASS Isolated Worktree creation preserves the source checkout
PASS Base SHA, staged, unstaged and untracked changes discovered
PASS Git diff --check (staged + unstaged)

BLOCKED Real Pi/workmux/tmux integration requires missing tools or compatible Node.js.
exit_status: 2
```

Script 종료 상태:
- `0`: 도구가 발견되고 Node 최소 버전과 격리 Git 테스트 통과. **실제 Pi Fork 통합 시험이 통과했다는 의미는 아님.**
- `2`: 필수 도구 또는 Pi의 Node 요구사항 불충족. Git 검사는 별도로 실행할 수 있음.
- `1` 또는 기타: 명령·Git 검사 오류 가능. 실행 출력을 확인.

## 3. 공개 소스 검토 — 실제 사용에 중요한 제약

아래는 실제 바이너리 실행이 아니라 **2026-10-25 공개 코드와 문서를 읽은 결과**다.

| 항목 | 코드에서 확인된 점 | pi-compose에 미치는 영향 |
| --- | --- | --- |
| Pi Fork | `pi --fork <path\|id>` 사용 가능 | 자체 세션 복제 엔진 불필요 |
| workmux Pi Fork | `workmux add <branch> --fork=<source-id>` 지원, 새 Worktree에서 Pi `--fork <session-path>` 호출 | 사용자 반복 조작 제거 후보 |
| workmux 실제 테스트 방식 | `tests/test_fork.py`의 Pi 테스트는 **가짜 Pi 실행파일(shim)** 로 인자·cwd·원본 불변을 검증 | 최신 Pi에서 실제 대화·모델·복제 의미의 검증은 별도 필요 |
| Fork 원본 탐색 | 원본 Pi 세션의 기록된 **cwd가 source worktree root와 일치**하는 항목 탐색 | 프로젝트 하위 디렉터리 Main, 커스텀 세션 디렉터리, 여러 프로젝트에서 실제 선택 시나리오 확인 필요 |
| Pi 커스텀 세션 경로 | workmux는 `PI_CODING_AGENT_SESSION_DIR` 환경 변수 등을 사용; Pi의 `--session-dir` 설정은 자동 인식하지 않음 | 누락 시 임의의 최근 세션으로 대체하지 않고 명확히 오류 보고 |
| workmux `--headless` | `src/command/add.rs`에서 `--headless`와 `--fork` 조합을 거부 | `--headless --json --fork`를 공통 Launch의 구현 경로로 가정하지 않을 것 |
| workmux `--continue` | `--fork`와 CLI 옵션 충돌 | New / Fork / Resume를 명확히 분리 |
| Dashboard 상태 | workmux Pi 상태 추적은 Hook 설정 필요; Pi Waiting 상태는 일부 미지원 | Agent 완료를 Idle/Done 상태로 판단하지 않음 |

근거:
- [workmux `tests/test_fork.py`](https://github.com/raine/workmux/blob/main/tests/test_fork.py)
- [workmux `src/cli.rs`](https://github.com/raine/workmux/blob/main/src/cli.rs)
- [workmux `src/command/add.rs`](https://github.com/raine/workmux/blob/main/src/command/add.rs)
- [workmux Fork 사용 가이드](https://github.com/raine/workmux/blob/main/docs/src/content/docs/guide/workflows.md)
- [workmux Status tracking](https://workmux.raine.dev/guide/status-tracking/)

## 4. 아직 미수행인 실사용 통합 시나리오

**이 검증은 Pi 및 workmux가 설치된 사용자의 환경이나 별도 실행 가능한 테스트 머신에서 수행**한다. 사용자 프로젝트·실제 Main 세션을 먼저 사용하지 않는다.

### T0. 사전 점검

```bash
bash scripts/phase0-preflight.sh
```

도구가 없거나 Node 하한에 못 미치면 먼저 환경을 준비해야 한다. Script는 **자동 설치·설정 변경을 하지 않는다**.

### T1. 격리 레포에서 Pi 원본 세션 생성

1. 사용자 작업이 없는 새 실험용 Git 레포를 만든다.
2. 로컬의 실제 Pi로 **보존할 이유가 있는 명시적 금지사항**을 한 번 논의한다.
3. Pi의 `/session`에서 **원본 세션 ID와 저장 경로를 정확히 확인**한다.
4. 원본 Session 파일과 원본 Git 상태를 기록한다.

**주의:** 실제 모델 대화가 필요한 시험이며 인증된 모델 접근 권한이 필요할 수 있다. 원래 Main의 민감한 이력을 테스트 데이터로 사용하지 않는다.

### T2. Fork + Worktree

Pi를 agent로 사용하도록 설정한 뒤 **정확한 세션 ID**로 실행한다.

```bash
# 실험용 레포에서, 먼저 효과만 확인
workmux add feat/phase0-pi --agent pi --fork=<source-session-id> --dry-run

# 명령·설정을 확인한 뒤 실제 실행
workmux add feat/phase0-pi --agent pi --fork=<source-session-id>
```

명령은 workmux의 공개 CLI 문법에 기반하며, 이 환경에서는 실제 바이너리로 검증하지 못했다.

확인 항목: 원본 세션 유지, 실제 Fork 세션 신규 생성, cwd가 새 Worktree, 원본의 이유·강한 금지 표현 보존 여부, 단일 요청 성공/실패와 진단.

### T3. 나머지 세 조합

- **Independent + Worktree:** 별도 Worktree에서 새로운 Pi 세션 실행.
- **Fork + Shared:** 동일 디렉터리에서 명시적 `pi --fork <source-session-path>` 실행·재개.
- **Independent + Shared:** 동일 디렉터리에서 독립 Pi 세션 생성·재개.

각 조합에서 원본 세션, 실제 cwd, Pi 세션 파일, tmux 타깃을 확인한다. 세션·Worktree·실행 시점을 서로 종속시키지 않는다.

### T4. Dashboard / Hook

1. Hook·Extension의 기존 설치 목록 확인.
2. workmux의 Pi 상태 Hook을 필요한 범위에 설치하되 다른 패키지 설정과 충돌 여부를 기록.
3. Worktree 및 Shared Directory 세션이 Dashboard에 나타나는지, 서로 전환·입력 가능한지 확인.
4. Waiting / Idle / Turn end / Handoff를 혼동하지 않는지 확인.

`workmux setup`은 전역 Pi 환경을 수정할 수 있으므로 **이 Script가 자동 실행하지 않는다**. 설정 변경은 명시적으로 수행하고 복구 방법을 확보한다.

### T5. 오류와 재개

- 원본 Session ID 누락/오입력, 원본 cwd 불일치, 이미 있는 브랜치, Dirty Worktree.
- Fork 생성 전/후 실패 및 재시도 시 중복 생성 여부.
- tmux Pane 종료 뒤 원래 세션 Resume.
- 검증 시점 이후 파일이 변경됐을 때 이전 Git 검사 결과를 새 상태에 적용하지 않는지.

기존 사용자 작업을 지우는 테스트는 하지 않는다. 필요하면 **테스트 전용 자원**만 대상으로 검사한다.

## 5. 단계 결과 및 다음 행동

**확인됨:** Git의 Worktree 격리 및 staged/unstaged/untracked 변경 범위 수집; Pi/workmux 공개 CLI 경로; Pi 버전별 Node 최소 요구사항.

**미확인:** 최신 Pi + workmux/tmux의 실제 실행, Fork 후 의미적 원본 의도 보존, Shared Directory Dashboard 관찰, 안전한 Resume/Handoff 연계.

**다음 단계:** 실사용 가능한 테스트 머신에서 T0~T5를 실행하고, 결과를 근거로 **기존 CLI만으로 가능한 영역과 추가 Pi Extension/Script가 필요한 실제 기능 공백**을 결정한다. 그 전에 특정 Dashboard·Package를 필수 의존성으로 확정하지 않는다.
