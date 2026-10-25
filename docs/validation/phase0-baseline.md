# Phase 0 — 기존 도구 조사 및 검증 보류 기록

- 상태: **부분 검증으로 종료** (2026-10-25)
- 다음 단계의 필수 Gate가 아님
- 실행 환경: 격리된 Linux 컨테이너, **사용자 실제 Mac 환경이 아님**

## 당시 확인한 사실

- Git 2.47.3, Node 22.16.0 사용 가능; Pi, workmux, tmux 실행 파일은 없었다.
- 당시 Pi 1.4.0의 Node.js 최소 요구 버전은 22.19.0이었으므로 이 컨테이너에서는 실제 Pi 통합 시험이 불가능했다.
- 격리된 임시 Git 저장소에서 Worktree 생성·원본 보존 및 staged/unstaged/untracked 파일 발견 동작을 확인했다. **Git의 기본 동작 확인이지 Pi Compose 통합 검증이 아니다.**
- workmux 소스에서 `add --fork=<source-id>`가 Pi Session Fork를 지원하는 구현을 확인했다. workmux 테스트는 가짜 Pi 실행 파일을 사용해 인자와 cwd를 검사하며 최신 Pi의 실제 의미적 Fork 성공을 증명하지 않는다.
- `workmux add --headless --fork`는 조합할 수 없고 `--fork`와 `--continue`도 충돌한다.
- workmux Dashboard의 Pi 상태 추적에는 별도 Hook/Extension 설정이 필요하다.

관련 공개 소스: [workmux CLI](https://github.com/raine/workmux/blob/main/src/cli.rs) · [workmux Fork 테스트](https://github.com/raine/workmux/blob/main/tests/test_fork.py) · [Pi Sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md).

## 현재 유지할 미확정 사항

- 실제 Pi + workmux + tmux의 Fork·Resume·Shared Directory Dashboard 관찰.
- Main 컨텍스트 Fork 시 원래 이유·금지사항의 의미가 보존되는지.
- 동일 세션의 다중 실행 탐지와 타 도구 Hook 충돌.

**판단:** 지금 반드시 필요한 기능 검증은 그 기능을 사용할 때 수행한다.
미확정인 사실은 미확정으로 표시하고, 그 자체로 Phase 1 이후의 개발을 차단하지 않는다.

## 유지비용 정리

Phase 0에서 사용했던 `scripts/phase0-preflight.sh`는 임시 Git 저장소를 매번 만들어
Git의 기본 동작을 재검사하는 스크립트였다. 사용자 결정에 따라 해당 스크립트는
제거하고, 별도 자동화 테스트 없이 당시의 실행 결과만 기록으로 유지한다.
필요한 실제 연동을 검증할 때는 설치된 환경의 Pi·workmux·tmux 명령을 직접 사용한다.
