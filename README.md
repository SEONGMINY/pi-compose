# pi-compose

Pi를 기반으로 한 개인용 **Composable Coding Agent Harness**.

현재는 설계 문서와 **Phase 1 공통 Launch CLI의 첫 구현**을 제공한다. 아직 실제 Pi·workmux 통합, Pi Extension, Dashboard, Handoff, 자동 검증까지 완료된 제품은 아니다.

## 핵심 원칙

- Main Agent는 설계·의사결정의 원래 이유와 강한 제약을 보존한다.
- Context(Fork/Independent), Workspace(Shared/Worktree), 실행 시점과 순차·병렬 여부를 독립적으로 선택한다.
- 개발 세션은 **사용자의 명시적 실행 요청**이 있을 때 생성한다.
- Pi·Git·tmux·기존 도구 기능은 재사용하고 반복 준비 작업을 추상화한다.
- Main이 상세 Git Diff·테스트 로그를 직접 분석하도록 강제하지 않는다.
- 완료 Handoff, 검증, 실제 Git 통합, Worktree 정리를 서로 구분한다.

## 현재 구현: Launch CLI

Node.js `>=22.19.0`을 기준으로 한다. `git`, `pi`, `tmux`, `workmux`는 실행할 조합에 따라 필요하며 **자동 설치되지 않는다**.

```bash
# 실행 환경에 명령만 표시 (리소스 변경 없음)
node bin/pi-compose.mjs launch \
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
node --test
# 또는 npm test
```

이 테스트는 **옵션 처리·명령 계획·모의 실행 결과**를 검증한다. 실제 Pi·workmux·Dashboard의 성공을 보장하지 않는다.

## 문서

[설계 문서 인덱스](docs/README.md) · [PRD](docs/PRD.md) · [TRD](docs/TRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) · [Phase 1 구현·검증 상태](docs/validation/phase1-launch.md)

## 앞으로의 작업

공통 Launch 진입점을 Pi 명령과 자연어 Tool에서 재사용할 수 있도록 연결한 뒤, Dashboard·Resume, Handoff와 독립 검증으로 이어간다.

**미검증 기술 통합은 필요한 시점에 검증하며, 제품 요구사항을 임의로 축소하지 않는다.**
