# Phase 6 — 협업·통합 시나리오 점검

- 진행 상태: **실제 Pi·tmux·workmux Launch/Resume/Worktree 연동 및 격리 Git 통합 시나리오 검증 완료 / 모델 기반 다중 에이전트 협업 미검증**
- 실행일: 2026-10-25
- 근거: [Implementation Plan](../IMPLEMENTATION_PLAN.md) · [Architecture](../ARCHITECTURE.md) · [ADR 0002](../adr/0002-user-controlled-execution.md)
- 테스트 정책: 실제 도구 실행 중심. CLI·Git의 기본 동작을 위한 단위 테스트나 필수 CI Gate를 추가하지 않는다.

## 실제 실행 결과: 두 개발 브랜치 통합

**사용자 프로젝트가 아닌 새 임시 Git 저장소**에서 직접 실험했다. 종료 시 임시 저장소와 Worktree를 모두 정리했다.

1. `main`에 계약을 기록했다: 기존 외부 클라이언트가 의존하므로 공개 API 응답의 `label` 필드는 **절대 제거하거나 이름을 바꿀 수 없다**. 계약 변경에는 사용자 승인이 필요하다.
2. 기준 커밋에서 `feature/api`와 `feature/ui` 두 Worktree를 생성했다.
3. 각 Worktree에서 서로 다른 파일을 수정·커밋했다. 그 뒤 `main`에 **순서대로 실제 병합**했다.
4. 결합된 코드를 Node.js로 직접 실행해 UI가 API 결과를 소비하는지 확인했다.

| 케이스 | API 개발 변경 | UI 개발 변경 | Git 병합 | 결합 코드 실행 |
| --- | --- | --- | --- | --- |
| 정상 통합 | 기존 `label` 유지, 추가 필드만 확장 | 기존 `label` 소비 | 성공 | **PASS** |
| 의미적 충돌 | 기존 `label`을 `title`로 변경 | 여전히 `label` 소비 | 성공 | **FAIL** |

두 케이스 모두 별도 파일 변경이므로 **Git 파일 충돌이 발생하지 않았다**.
두 번째는 원래 금지된 계약 변경과 실제 API/UI 불일치가 있으므로 **병합 성공을 기능 성공이라고 볼 수 없다**.
Git `status --porcelain`은 두 케이스에서 Clean이었다. 원본 `CONTRACT.md` 파일도 그대로 보존됐다.

결론은 **병합할 권한을 자동화하자는 것이 아니라, 사람이 통합을 선택한 뒤 실제 통합된 코드의 계약과 동작을 확인해야 한다**는 것이다.

> 범위 구분: 위 결과는 실제 **Git·Node 격리 시나리오의 결과**이다. Pi Compose의 Pi 세션 Fork, workmux Send, Handoff 및 Reviewer가 함께 동작했다는 뜻은 아니다.

## 실제 Pi·tmux·workmux 연동 스모크 (2026-10-25)

**환경:** 일회성 격리 GitHub Actions Ubuntu runner (실제 사용자 개발 환경 아님).
Node.js `22.19.0`, Pi `1.4.0`, workmux `0.1.277`, tmux `3.6a`.
개발 프로젝트는 별도의 **임시 Git 저장소**로 만들고 검사 후 정리했다.
장기 CI 게이트를 추가하려는 목적이 아니며, 검증에 사용한 임시 워크플로 파일은 제거한다.

| 검사 | 실제 관찰 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm test` — 직접 구현한 Pi Extension | **24개 통과, 실패 0개** |
| 실제 Pi Extension 로드·tmux TUI 기동 | 정상. 다만 인증된 모델은 없어 대화 실행은 확인 불가 |
| `pi-compose launch --workspace shared` | 실제 tmux Session 생성됨 |
| `pi-compose resume --session-file <정확한 JSONL>` | 기존 경로에서 해당 이름의 tmux 세션 생성됨. 실제 대화의 모델 응답 검증은 제외 |
| 동일 `resume` 재시도 | `target_occupied_no_launch` 결과; 추가 세션 생성 차단 |
| tmux 내부 `pi-compose launch --workspace worktree` | **workmux를 실제 호출해 Worktree 생성 성공** |
| `pi-compose inspect` | 해당 브랜치에 `worktree-existing` 결과 |
| 선택적 Handoff/Verifier의 모델 실행 | **미실행** — 제공자 인증 정보 없음 |

- [Node/Extension/CLI/Pi TUI 초기 스모크](https://github.com/SEONGMINY/pi-compose/actions/runs/40176929166)
- [Shared Launch, Resume, 재시도 및 workmux Worktree 연동](https://github.com/SEONGMINY/pi-compose/actions/runs/40177234200)

**검증 중 확인한 workmux 전제 조건:** tmux 외부에서 CLI를 실행하고 tmux 세션이 3개 있는 상황에서는,
workmux가 창을 붙일 부모 세션을 특정하지 못해 실행을 거부했다.
에러에는 `TMUX_PANE` 부재와 `--parent-session <name>` 지정 필요성이 명시됐다.
**Pi를 실제 tmux Pane에서 실행하는 정상 경로에서는 동일한 Worktree Launch가 성공**했다.
현재 Pi Compose CLI가 임의의 부모 tmux 세션을 자동 선택하도록 변경하지 않았다.
여러 세션을 쓰는 경우에는 Pi가 실행되는 tmux Pane에서 시작하고,
CLI 전용 외부 실행의 부모 선택 요구가 확인되면 별도 입력 옵션을 검토한다.

**미완료:** 진짜 Main 세션의 원본 WHY·강한 금지를 담은 Fork,
모델이 API/UI 기능을 개발하는 2개 Pi 세션 간 통신,
`workmux send` 실제 수신, `compose_handoff` 보고서 작성,
`/compose-verify`의 모델 결과, Dashboard 실제 사용과 사용자 선택 후 통합.
이 부분은 타입/단위 테스트나 Pi TUI 시작만으로 **완료됐다고 볼 수 없다**.

## Pi Compose 실제 사용자 시나리오

현재 구현에서 사용 가능한 진입점만 이용한다. **구체적 파일·세션 식별자는 실제 사용자 환경에서 선택**한다.

| 순서 | 주체 | 동작 | 넘겨야 할 근거 |
| --- | --- | --- | --- |
| 1 | 사용자 + Main | 구현 범위와 “왜 절대 변경하면 안 되는지” 확정 | 원래 이유, 금지 강도, 계약 파일의 실제 위치 |
| 2 | 사용자 | API 작업은 명시적 Main 세션 Fork + Git Worktree Launch | 정확한 Main Pi JSONL 경로, 브랜치, 기준 커밋 |
| 3 | 사용자 | 독립 UI 작업은 사용자가 선택한 Shared Directory 또는 별도 Worktree에 Launch | 상대와 수정 경로 충돌 가능 여부 |
| 4 | 개발 에이전트 간 | 상대에게 영향을 주는 변경만 `workmux send`로 직접 공유 가능 | **발견 / 제안 / 사용자 승인 / 실제 적용** 상태 + WHY |
| 5 | 각 개발 에이전트 | `/compose-handoff`로 명시적 인계, 실제 Git 변경 파일 확인 | 구현 내용, 이유, 검사한 항목과 미검증 사항, Git 상태 |
| 6 | 사용자 선택 | 영향 큰 변경에만 `/compose-verify <base-ref>`로 독립 읽기 전용 검증 요청 | 실제 코드, 원래 계약, Handoff는 미검증 주장 |
| 7 | 사용자 | **Git 통합 시점·대상·순서 직접 결정** | 불확실성, Shared Directory 변경의 소유 범위 |
| 8 | 통합된 프로젝트 | 기존 프로젝트의 적절한 실제 빌드·검사 실행, 필요 시 재검증 | **통합 후 코드 상태**와 원래 계약 비교 |

### 사용 명령 예시

```bash
# 실행을 명시적으로 선택하기 전 계획 확인
node bin/pi-compose.ts launch --context fork --workspace worktree \
  --task "API 변경 (기존 공개 필드 변경 금지)" \
  --source-session-file /path/to/main-session.jsonl \
  --cwd /path/to/project --branch feature/api --dry-run

# 상태 확인은 읽기 전용
node bin/pi-compose.ts inspect --cwd /path/to/project --branch feature/api

# 관련 에이전트에게만 직접 알림 (해당 대상이 workmux에서 실제 발견되어야 함)
workmux send project:handle "[PROPOSAL - NOT APPROVED] 공개 응답 필드 이름 변경 제안. 이유: ... 사용자 승인 전 구현 금지."
```

Pi에서 필요한 Extension만 명시적으로 로드한다.

```text
/compose-handoff
/compose-verify <pre-integration-base-sha>
```

- `/compose-handoff`는 [선택형 Handoff Extension](../../extensions/optional/handoff.ts)을 로드해야 사용 가능하다.
- `/compose-verify`는 [선택형 Verify Extension](../../extensions/optional/verify.ts)을 로드해야 사용 가능하다. 현재 Pi 세션에 명시적 Handoff가 있으면 **개발자의 미검증 주장**으로 함께 제공한다.
- **통합 후 깨끗한 Git 상태를 검증할 때는 통합 이전 기준 SHA를 명시**한다. 기본 명령만 실행하면 이전 Commit의 변경을 읽지 못한다.
- `workmux send`에는 상대 에이전트가 실제 대상 목록에서 찾아져야 한다. Send 명령 성공은 상대가 읽었다거나 승인했다는 의미가 아니다.
- Pi Compose에는 자동 `merge`, `reset`, Worktree 삭제 기능을 추가하지 않는다.

## 현재 연결의 확인되지 않은 부분

- Independent + Shared와 Worktree Launch는 실제 연결 확인했다. **Fork 모드 및 두 모델 에이전트의 병렬 개발은 미검증**이다.
- Shared Directory의 변경은 두 에이전트의 기여를 Git만으로 정확히 분리할 수 없다.
- Pi의 Main 컨텍스트에서 확인한 계약/WHY가 다른 에이전트에 실제로 온전히 보존되는지 통합 실험이 남아 있다. 독립 검증 에이전트는 Main 전체 대화를 자동 상속하지 않는다.
- Handoff 전송, `workmux send` 수신·읽음 확인, 읽기 전용 Pi Reviewer의 실제 모델 응답은 아직 미검증이다.
- Phase 1~5 최신 코드의 타입 검사와 Extension 테스트는 위 일회성 Ubuntu 환경에서 실제 통과했다. 사용자의 macOS 환경과 인증된 Pi 모델 실행은 미검증이다.
- 계약 관련 오류에 대한 자동 실패 판정이나 강제 승인 Gate는 만들지 않았다.

## 이번 단계에서 보완한 기존 구현

[선택형 검증 Extension](../../extensions/optional/verify.ts)의 리뷰 지침에 **API 생산자와 UI 소비자 간 호환성, 병합 성공과 기능 성공의 차이, 제안과 사용자 승인/구현 상태의 구분**을 명시했다. 자체 통합 검사 엔진이나 신규 테스트 파일은 작성하지 않았다.

**다음 판단:** 실제 사용자 개발 환경에서 모델 인증을 사용해 Main 컨텍스트 Fork·두 에이전트의 교차 계약 전달을 처음 수행할 때 그 의미적 연동을 검증한다. 이후 사용자 주도 통합을 수행한 **그 코드 상태**에서 프로젝트 기존 검사를 실행한다. 남은 미확정 사항이 있다고 해서 전 프로젝트에 검증 절차를 강제하지 않는다.
