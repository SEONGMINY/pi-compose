# TRD — 기술 설계 및 검증 전략

- 상태: **기술 방향 추천 / 일부 지원 기능은 공개 구현에서 확인 / 실사용 호환성 미검증**
- 작성 기준: 2026-10-25
- 제품 계약: [PRD](PRD.md). 기술적 한계를 이유로 PRD의 기능을 임의로 제거하지 않는다.

## 1. 기술 설계 원칙

1. **실사용 비용 최적화:** 구현 코드량보다 사용자 반복 조작, 토큰, 컨텍스트 오염, 실패·재작업, 유지보수의 합을 줄인다.
2. **기존 책임 재사용:** Pi는 세션·컨텍스트·모델 도구, Git은 코드/Worktree, tmux는 실행 프로세스, Dashboard는 관찰·직접 제어를 맡는다.
3. **추상화는 반복 절차에 한정:** 이미 선택한 실행 옵션을 결정적 CLI 호출로 수행한다. 모든 위임을 매번 모델에 맡기지 않는다.
4. **사용자 제어:** Main이 자체적으로 개발 에이전트를 생성하지 않는다. 대시보드·명시적 명령·사용자가 직접 요청한 자연어 호출만 실행 입력으로 인정한다.
5. **교체 가능한 조합, 과잉 범용화 금지:** 공개 CLI를 사용하되 첫 버전부터 모든 패키지용 범용 Adapter Framework를 만들지 않는다.
6. **실제 지원과 기대를 구분:** 공개 코드 테스트, 버전 선언, 실제 Pi 실행을 별도 단계에서 검증한다.

## 2. 구성 후보

| 구성 | 현재 후보 | 확정 여부 | 역할 |
| --- | --- | --- | --- |
| Agent Runtime | [Pi](https://github.com/earendil-works/pi) | **Pi 기반 확정** | 세션, Fork, Resume, 모델·도구·Compaction, Extensions |
| Repository/Workspace | Git | 확정 방향 | Diff, 기준 SHA, Worktree, 브랜치, 병합 |
| 프로세스·분할 | tmux | 우선 기술 방향 | 장기 실행, Pane/Window/Session |
| Worktree 실행 | [workmux](https://github.com/raine/workmux) | **최우선 검증 후보** | Worktree + Pi Fork + tmux, Dashboard |
| Dashboard 대안 | [ccmux](https://github.com/epilande/ccmux) | 후보 | 기존 tmux 세션 발견·상태·결과 전달 |
| Dashboard 대안 | [pi-agent-hub](https://github.com/masta-g3/pi-agent-hub) | 후보, 버전·Fork 제약 | Pi 중심 관리 UI |
| 세션 전환 경량 대안 | [pi-mux](https://github.com/leohenon/pi-mux) | 후보 | tmux 기반 Pi 세션 전환 |
| 피어 메시징 | [pi-intercom](https://pi.dev/packages/pi-intercom) | 후보 | 선택적 직접 통신; 현재 필수 아님 |
| 사용자 진입점 | Pi Extension, Script, CLI, Skill | 구성 방식 추천 | 명령/선택 UI/실행 연결/지침 분리 |

### 공개 구현에서 확인된 내용 (실행 검증과 다름)

- Pi는 기존 세션을 분기하는 CLI `--fork`를 제공한다. Fork 시 새 실행 `cwd`와 기존 세션 기록은 별개의 개념이다.
- `workmux` **v0.1.277 (2026-10-23)** 에는 Pi Fork + Worktree 실행 기능이 있으며, [`tests/test_fork.py`](https://github.com/raine/workmux/blob/main/tests/test_fork.py)에 **가짜 Pi 실행 파일을 사용한** 인자·cwd·원본 보존 테스트가 있다.
- `workmux`의 Pi 세션 탐지는 `~/.pi/agent/sessions` 또는 환경 변수 설정에 의존하고 소스 세션의 **기록된 cwd와 원본 작업 공간**을 비교한다. 원본 선택은 가능한 경우 세션 ID를 명시한다.
- `workmux` Dashboard는 tmux의 Agent Pane을 관찰하지만 Pi 상태 추적 Extension을 설정해야 하며 모든 상호작용/완료 의미를 자동 판별하지 않는다.
- `ccmux`는 외부 tmux 세션 발견, 미리보기, 메시지·Handoff 등 기능을 제공한다. Pi 지원과 **Pi Fork 기본 어댑터 지원은 별개**다.
- `pi-agent-hub` **v1.2.0** 은 Pi 관련 Peer Dependency `^0.99.2`를 선언하여 Pi `v1.4.0`과의 버전 범위가 맞지 않는다. Fork 구현은 원래 cwd를 사용하고 Worktree 세션 Fork를 명시적으로 거부한다.
- 위 사실만으로 특정 조합이 현재 개발 환경에서 안정적으로 동작한다고 선언하지 않는다.

참고: [Pi 문서](https://github.com/earendil-works/pi) · [workmux Workflows](https://github.com/raine/workmux/blob/main/docs/src/content/docs/guide/workflows.md) · [workmux Dashboard](https://github.com/raine/workmux/blob/main/docs/src/content/docs/guide/dashboard/index.mdx) · [pi-agent-hub Fork 구현](https://github.com/masta-g3/pi-agent-hub/blob/main/src/app/session-lifecycle.ts).

## 3. 코드 언어 및 런타임 검증 경계

- **TypeScript:** `strict` + `tsc --noEmit`으로 내부 실행 계획, CLI, Pi Extension과 테스트의 정적 타입을 확인한다. Node.js `>=22.19.0`의 내장 type stripping으로 CLI `.ts`를 직접 실행하며, Pi Extension은 공식 `jiti` TypeScript 로더로 실행한다. 별도 번들러가 필요하지 않다.
- **Zod:** 사용자/CLI/Pi UI가 넘기는 Launch 요청, 외부 Pi JSONL 헤더, Git 커밋 SHA·저장소 루트를 시스템 유입 경계에서 검증한다. `z.infer`로 Launch 입력 타입을 추론하며 스키마·타입을 중복 정의하지 않는다. 내부 실행 계획에는 TypeScript 타입을 사용한다.
- **Git 경계:** 브랜치 이름의 실제 문법은 `git check-ref-format`을 이용한다. 외부 Workmux 응답의 안정적인 구조가 확인되기 전에는 임의의 Zod 스키마를 발명하지 않는다.
- **의존성:** `zod`는 런타임 의존성, TypeScript·Node 타입·Pi 공식 타입은 개발 의존성. Pi 호스트 패키지는 peer 의존성으로 참조하며 중복 런타임 설치를 강제하지 않는다.
- **상태:** 초기 CI에서 타입 검사를 확인한 이력이 있다. 이후 변경의 타입 검사 및 Pi/workmux 실연동은 별도 확인이 필요하다. CLI·외부 도구 기본 동작 테스트는 정책 변경에 따라 정리했다.

## 선택형 View와 Pi Package 구성 (ADR 0004)

Pi Compose는 **Launch 중심의 Pi Package**이다. `package.json`의
`pi.extensions`에는 `extensions/compose.ts`만 포함한다.
워크트리 상태·에이전트 관찰이 필요하다면
`extensions/optional/workmux-dashboard.ts`를 **명시적으로 로드**한다.

- Pi 내부 View는 사용자 정의 UI를 제공하는 **독립 Extension**이며, 외부 View는 기존 프로세스를 실행하는 Extension일 수 있다. Pi에 별도의 `View` 리소스 종류는 없다.
- workmux View는 `/compose-workmux`만 등록한다. `/compose launch|preview`와 `compose_launch`는 기본 Package만으로 사용할 수 있다.
- Pi의 `pi -e <파일>` 또는 사용자 `settings.json`의 `extensions` 리소스 경로로 선택형 Extension을 로드한다. Package Manifest의 리소스 범위를 좁히는 필터만으로 선언되지 않은 파일을 추가할 수는 없다.
- 기존 CLI `pi-compose dashboard`는 호환성을 위해 유지한다.
- **Worktree 실행의 `workmux add` 의존성과 workmux Dashboard의 View 의존성은 서로 다른 사항**이다. View 교체는 지금 가능하지만 Worktree 실행 백엔드 교체는 향후 실제 필요가 확인될 때 검토한다.
- 새 Provider/Registry/Plugin Host 또는 여러 개의 npm Package를 선제적으로 만들지 않는다.

선택형 Extension을 자동 탐색하는 위치에 두지 않은 이유와 대안 비교는
[ADR 0004](adr/0004-pi-native-optional-views.md)를 참조한다.

## 4. Extension / Skill / Script 역할

| 요소 | 추천 책임 | 피해야 할 사용 |
| --- | --- | --- |
| **Skill** | 작업의 맥락 의존성·검증 필요성, 원래 계약의 이유 확인, 인계 원칙 | 매번 동일한 Git·tmux 셸 명령을 추론해서 재작성 |
| **Prompt Template** | 개발 작업 시작 지시, 간결한 Handoff, 독립 검증 요청 | 프로젝트 계약을 중복 기록하는 영구 문서 |
| **Extension** | 사용자 선택 UI, 명시적인 `/compose ...` 명령, 필요 시 자연어용 Tool, 실행 결과 연결 | Pi Runtime 또는 Git 엔진 재구현 |
| **기존 CLI / 최소 Script** | 정해진 옵션 검증·실행·재시도·결과 반환 | 사용자 요구사항·승인 여부 해석 |
| **Dashboard** | 상태·Pane·Diff 관찰, 전환·직접 입력 | 계약의 정본, 개발 완료의 자동 선언 |

**한 실행 동작, 여러 진입점:** 대시보드·직접 명령·명시적 자연어 요청에서 같은 실행 기능을 활용하는 것이 목표. 특정 Dashboard에 사용자 정의 명령 API가 없다면 그 내부에 억지로 통합하지 않는다. Pi 명령/CLI를 별도로 사용할 수 있다.

**모델 개입 최소화:** 사용자가 이미 Context=Fork, Workspace=Worktree, source=Main을 선택했다면 모델을 새로 호출해 Worktree 명령을 생성할 이유가 낮다.

## 정확한 세션 Resume와 실패 진단

기존 Pi Runtime과 Git 기능만으로 재개 경계를 제공한다.

- Pi: `pi --session <정확한 JSONL 경로>`로 **사용자가 지정한 대화**를 열며, `--continue` 같은 최근 세션 추측은 하지 않는다.
- Git: `git worktree list --porcelain -z`로 실제 체크아웃 상태를 확인하고, 브랜치만 남았는지(`branch-only`)를 구분한다. 기존 Dirty 파일은 지우지 않는다.
- tmux: 지정한 또는 기존 Session/cwd로부터 결정한 대상을 `has-session`으로 확인한 뒤 `new-session`을 실행 직전에 재확인한다.
- 확인된 동일 tmux 이름과 충돌하면 **새 Pi를 시작하지 않는다**. 임의의 다른 이름으로 중복 생성하지 않는다.
- **한계:** 다른 이름의 tmux Session이나 외부 터미널에서 같은 Pi 세션이 실행 중인지는 완벽히 탐지하지 못한다. 발견하지 못했다고 유일한 실행이라고 선언하지 않는다.
- 실행 실패 후 자원 삭제는 자동 처리하지 않는다. 정확한 Git 상태를 볼 수 있는 `inspect`를 먼저 제공하며, 실제 정리 기능은 사용자 소유 코드의 안전성을 확보한 다음 별도 범위로 검토한다.

구현 결과와 남은 검증: [Phase 3](validation/phase3-resume.md).

## 5. 최소 실행 입력/출력 (개념 계약)

이는 별도 DSL이나 영구 Job DB의 스키마가 아니다. 구현 모듈의 입력·출력을 논의하기 위한 **개념적 필드 목록**이다.

| 입력 | 조건 |
| --- | --- |
| 작업 목표·선택된 프로젝트 | 항상 식별 가능해야 함 |
| Context = Fork / Independent | 필수 선택 또는 사용자가 이미 결정한 값 |
| Fork source Session ID/path | Fork 시 정확히 식별; 가장 최근 세션을 Main이라 무단 추정 금지 |
| Workspace = Shared / Worktree | Context와 독립 |
| Shared Directory 또는 Repo/Worktree 경로 | 모드에 따라 |
| Worktree 브랜치·base ref | Worktree 선택 시 |
| 실행 시점/병렬 여부 | 다른 옵션과 독립, 자동 스케줄링으로 연결하지 않음 |

반환 정보는 `실행 성공 여부, Pi Session 식별/기록 경로, cwd, Worktree/branch/base SHA(해당 시), tmux 대상, 진단 정보` 정도다. 출력 로그 전체를 Main에 전달하지 않는다.

### 오류와 안전 조건

- 셸 실행은 사용자가 지정한 경로·브랜치·세션 식별자를 **인자 배열**로 전달하고 위험한 셸 문자열 결합을 피한다.
- 기존 Worktree와 새로 생성한 Worktree를 구분한다. 자동 정리는 **자체 생성했으며 사용자 데이터가 없는 것이 확인된 자원**에 한한다.
- 한 단계에서 실패하면 성공한 단계를 기록·조회해 중복 생성을 피하고 재시도를 돕는다.
- Git의 dirty 상태 및 추적되지 않은 파일을 확인한다. 커밋하지 않은 변경을 조용히 폐기하지 않는다.
- 실행 도구가 제공한 세션 ID와 작업 위치를 보존해 Resume/Fork/New를 구분한다.

## 6. 컨텍스트 및 인계 기술

### Main 컨텍스트 보호

- 설계 맥락이 중요한 개발: Main 저장 세션을 **Fork**. Fork가 Working Tree 내용까지 복사하지 않음을 명시.
- 탐색·조사·테스트·Verification: 독립 세션 또는 적합한 Sub-agent. 긴 로그는 그 컨텍스트에서 소비.
- Pi Compaction 및 Fork가 원래 이유·강한 금지를 100% 복원한다고 보장하지 않는다. 중요한 계약은 **원본 세션의 실제 결정과 기존 문서**를 검증자가 참조할 수 있어야 한다.
- 프로젝트별 `AGENTS.md`는 진입점. Pi Compose가 새 “전역 계약 DB”를 만들지 않는다.

### Handoff

```text
- 구현된 범위 / 실제 변경 참조
- 중요 판단 및 WHY (특히 기존 계약·거절한 대안)
- 실제 실행한 검사와 결과
- 미해결 이슈·확실하지 않은 부분
- Pi 세션·Git 기준 SHA·브랜치·cwd
```

Handoff는 **개발자의 주장**이다. 검증 완료 증명이 아니다.

### Phase 4 — 명시적 Handoff 연결

`extensions/optional/handoff.ts`는 **사용자 선택형 Pi Extension**으로 제공한다. 기본 Launch에는 추가하지 않는다.

- `/compose-handoff [recipient]`는 사용자 명령으로 Pi의 `sendUserMessage`를 호출해 현재 대화 맥락의 간결한 인계를 작성하게 한다.
- `compose_handoff` Tool은 Git HEAD·브랜치·staged·unstaged·untracked 파일 경로를 조회한다. 명시적 base ref가 제공되면 해당 기준의 변경 파일과 `git diff --check`도 확인한다.
- 보고서에는 구현 내용, 원래 WHY·강한 금지·거절한 대안, 실제 실행한 검사, 남은 문제 및 Git/Pi 참조를 포함한다. Handoff는 **개발자의 주장이지 독립 검증 결과가 아니다.**
- 대상 에이전트를 선택한 경우에만 사용자 확인 후 `workmux send`를 호출한다. 전송 명령 성공을 상대의 읽음·확인으로 오해하지 않는다.
- 새 DB·자체 메시지 브로커·자동 Merge·Worktree 정리를 만들지 않는다. Git 상태 수집도 원자적 스냅샷은 아니므로 이후 코드 변경 시 재확인이 필요하다.
- 실제 Pi TUI 로딩, 다중 에이전트 수신 확인, 중복 인계 방지 및 Phase 5 검증 연계는 미검증/미구현이다.

## 테스트 작성 기준 (2026-10-25 확정)

**테스트 코드는 직접 구현한 Pi Extension의 고유 동작에 집중한다.**

- **Extension:** 세션 선택, 사용자 명시적 승인, 실행·전달 금지 조건, Pi UI/Tool 등록처럼 **Pi 동작을 새로 확장하는 핵심 계약**을 테스트한다. 작은 분기마다 일괄 테스트하지 않는다.
- **CLI·Script·기본 Git/tmux/workmux 동작:** 자동 단위 테스트를 필수로 만들지 않는다. 필요한 경우 실제 명령·출력·Git 상태를 확인한다. 기존 도구의 구현을 가짜 Mock으로 재검증하지 않는다.
- **정적 타입:** TypeScript `strict`·`tsc --noEmit`은 유지한다. 이는 함수별 단위 테스트 작성 의무와 별개다.
- **검증이 필요한 시점:** 현재 설계 결정이나 실제 사용자 동작에 중요한 때에만 확인한다. Pi·tmux 실연동 미검증을 전체 개발의 선행 Gate로 사용하지 않는다.
- **결과 표현:** 실제 실행한 검사만 통과로 표시한다. 테스트 개수·커버리지·긴 증빙 문서를 품질 성과로 취급하지 않는다.
- **예외 판단:** CLI라도 새로운 위험한 자체 알고리즘을 만든다면 안전성을 먼저 판단하고 검증 방식을 정한다. 'CLI니까 검증하지 않는다'는 뜻이 아니다.

참고: [my-pi](https://github.com/Jonghakseo/my-pi)의 Extension 테스트는 특정
확장 기능과 자체 유틸리티를 대상으로 하며, 모든 기능·외부 명령에 일괄 적용되지 않는다.
Pi Compose는 그 원칙만 참고하며 추가 테스트 프레임워크·커버리지 Gate를 도입하지 않는다.

## 7. 기본 검사와 독립 AI 검증

### 기본 Git 확인 (명시적 Handoff 후)

```bash
git status --short
git diff <base-sha> --name-status
git diff <base-sha> --numstat
git diff <base-sha> --check
git ls-files --others --exclude-standard
```

명령은 예시이며 현재 작업의 Git 상태를 고려해 조정한다. `git diff <base-sha>`에는 **미추적 파일 내용이 자동 포함되지 않는다**. staged/unstaged, 새 파일, 작업 중 추가 변경을 구분해 스냅샷의 범위를 표시해야 한다.

- 가능한 경우 프로젝트의 실제 `typecheck`, `test`, `lint` 명령을 발견하여 관련 범위를 실행한다.
- **기본 Git 확인 = 계약 준수 아님**. 프로젝트 검사 명령을 임의로 추측하거나 전 프로젝트에 특정 분석기를 강제하지 않는다.
- AI 검증은 계약 영향, 실패, 공유 인터페이스 영향, Handoff의 불확실성, 사용자의 명시적 요청 등에 따라 독립 컨텍스트에서 수행한다.
- Git의 전체 변경 경로를 발견하되, 심층 분석은 API·타입·외부 계약·핵심 동작 영향처럼 위험한 변경에 우선 집중한다.
- 검증 결과는 `결론 + WHY + 검증된 범위 + 미검증 범위 + 파일/라인·원문 출처`를 포함한다. Main이 전체 Diff를 직접 읽지 않는다.
- 개별 검증과 통합 후 검증은 다르며, **최종 통합 코드 상태**를 검사해야 한다.

### 통신

메시지는 **발견 / 제안(미확정) / 사용자 승인 결정 / 실제 적용** 상태를 구분한다. 단순 알림과 답변 필요 메시지를 구분하고, 관련 작업에 영향을 주는 정보에만 통신 비용을 지출한다. 실시간 감시기·자동 브로드캐스터는 만들지 않는다.

### Phase 5 — 사용자가 실행하는 독립 Pi 검증

`extensions/optional/verify.ts`는 기본 Launch Package에 포함하지 않는 선택형 Extension이다.

- `/compose-verify [base-ref]`를 사용자가 명시적으로 호출한다. 승인을 받은 경우에만 **새 모델 호출**을 시작한다. Handoff·Idle·세션 종료 시 자동 실행하지 않는다.
- 기존 Pi `--print --no-session`을 활용한다. `--no-extensions --no-mcp --tools read,grep,find,ls`로 모델의 실행·코드 수정 능력을 비활성화한다.
- Git 명령으로 기준 커밋(사용자가 제공할 때만) 및 staged/unstaged/untracked 파일·패치·공백 오류를 조사한다. 외부 Git 동작의 Mock 테스트를 늘리지 않는다.
- 현재 Pi 세션의 기존 메시지 중 **마지막 명시적 Handoff 표식**이 있는 사용자/Tool 결과를 찾아 함께 넘길 수 있다. 이는 검증할 개발자 주장이지 승인된 원본 계약이 아니다. 자체 Handoff DB·추가 파일 동기화를 만들지 않는다.
- 위험한 변경·강한 금지·원래 이유가 무엇인지 확인하되, **Main 원본 결정이 전달되지 않거나 실제 출처를 찾지 못했다면 그 원문을 확인했다고 주장하지 않는다.**
- 단일 스냅샷의 원자성은 보장하지 않는다. 패치 길이 제한 및 조회 전후 Git 상태 변경을 알려주며, 동일 상태 문자열이라도 동시 수정이 가능하다.
- 결과는 현재 Pi에 **간결한 요약**만 남긴다. 별도 검증 세션은 디스크에 저장되지 않으므로 검증의 상세 실행 기록을 사후 재개할 수 없는 것이 첫 구현의 제약이다.
- 일회성 Pi를 우선 선택한 것은 구현·관리 비용이 낮고 메인 컨텍스트를 분리하기 때문이다. **지속 Pi Reviewer / 기존 Sub-agent Package**는 향후 실제 비용·근거 추적 필요성을 비교해 선택할 수 있으며 지금 필수화하지 않는다.
- **검증 결과는 코드 병합 승인·사용자 계약 변경·통합 완료 신호가 아니다.**

## 8. 버전·호환성 검증 계획

**P0 호환성 시험(실행 스펙 검증, 사용자 데이터가 없는 테스트 저장소에서):**

1. 설치된 Pi 버전, Node, tmux, Git, workmux 버전을 기록한다.
2. Pi 원본 세션을 저장하고 **명시적 ID**로 Fork + Worktree를 생성, 원본 불변과 Fork 세션의 cwd·세션 파일을 확인한다.
3. 동일 디렉터리에서 Fork/Independent 실행 및 재개가 되는지 확인한다.
4. 독립 Worktree 세션 생성·재개 및 대시보드에서 관찰·직접 전환을 확인한다.
5. 상태 추적 Hook 설치 전/후 동작과 기존 Extension 충돌을 조사한다.
6. 인계 후 기본 검사와 독립 AI 검증의 연결이 Main 활성 컨텍스트를 오염시키지 않는지 확인한다.
7. Worktree 생성 성공 + Pi 실행 실패, 중복 재요청, dirty tree, 재시작 후 Resume를 시험한다.

**실패 시 원칙:** 제품 계약을 낮추지 말고 기존 Pi/Git/tmux CLI의 직접 조합을 내부 실행 구현으로 검토한다. 패키지 확장·작은 Script·Extension 가운데 **전체 유지비용**이 낮은 접근을 택한다.

## 9. 기술 결정 보류

- Dashboard 하나로 모든 모드를 관리 가능한지, Split Pane UX가 충분한지.
- workmux 단독 vs ccmux 등 다른 Dashboard 조합.
- Handoff 신호를 Pi Tool, 명시적 명령, 이벤트 중 어느 경계로 받을지.
- 연결 정보의 저장 위치(가능하면 기존 Pi/Git/tmux 메타데이터 재사용).
- 독립 검증 세션의 호출 형태(`pi --print`, 지속 세션, 외부 Sub-agent 패키지).
- 동료 세션 식별 및 `pi-intercom` 실제 채택.
- 실제 요구사항에서 드러난 부족한 기능에 대한 Extension·Script 작성 범위.

이들 결정은 [Implementation Plan](IMPLEMENTATION_PLAN.md)의 실증 결과로 좁힌다. **미확정 기술을 확정 의존성으로 표기하지 않는다.**


## PR #3 B안 채택 기록 — 실제 구현 (2026-10-26)

- Pi Compose의 직접 렌더링 Task Hub, 자체 Agent 상태 JSON 파서, Ghostty AppleScript 자동 탭 이동은 제거했습니다.
- 기본 /compose는 Pi의 Native select로 Main과 연결된 Agent를 보여주며, /compose sessions는 Pi SessionManager의 기존 저장소를 사용합니다.
- /compose monitor는 workmux dashboard를 tmux popup으로 엽니다. **workmux setup으로 상태 Hook을 구성해야 Agents 화면이 채워질 수 있습니다.** 이 설치는 사용자의 Pi 설정에 영향을 주므로 자동으로 수행하지 않습니다.
- 기본 Shared Directory Pi Agent가 workmux에 등록되지 않았다면 Dashboard는 해당 Agent의 상태와 출력이 있다고 주장하지 않습니다. 정확한 기존 tmux 창 기반 탐색은 계속 Pi Compose가 담당합니다.
- Handoff/Verify는 Worktree의 실제 경로+브랜치가 유일하게 연결될 때만 TaskRecord에 기록 당시 증거를 저장합니다. 기본 Session 저장소·Git 정본을 복제하는 새 DB가 아닙니다.
- Child Pi의 동일 Command/Tool을 활성화하려면 사용자가 pic navigation enable을 명시적으로 실행해야 합니다.
- 구현 코드는 GitHub Branch에 반영됐지만, npm 의존성 설치·전체 TypeScript 검사·실제 macOS Pi/Ghostty/모델 실행과 end-to-end 동작은 이번 변경에서 수행하지 않았습니다. GitHub Actions 및 E2E는 사용자의 요청에 따라 실행하지 않습니다.

이 결정은 [ADR 0007](adr/0007-reference-led-navigation.md)에 기록했습니다. 이 문서의 앞부분은 첫 설계 당시 후보 비교이며 최신 구현 상태를 의미하지 않습니다.
