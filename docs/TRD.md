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
- **상태:** CI Node 22.19 환경에서 strict 타입 검사와 16개 테스트가 통과했으나 실제 Pi/workmux 통합은 미검증.

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

## 4. 최소 실행 입력/출력 (개념 계약)

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

## 5. 컨텍스트 및 인계 기술

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

## 6. 기본 검사와 독립 AI 검증

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

## 7. 버전·호환성 검증 계획

**P0 호환성 시험(실행 스펙 검증, 사용자 데이터가 없는 테스트 저장소에서):**

1. 설치된 Pi 버전, Node, tmux, Git, workmux 버전을 기록한다.
2. Pi 원본 세션을 저장하고 **명시적 ID**로 Fork + Worktree를 생성, 원본 불변과 Fork 세션의 cwd·세션 파일을 확인한다.
3. 동일 디렉터리에서 Fork/Independent 실행 및 재개가 되는지 확인한다.
4. 독립 Worktree 세션 생성·재개 및 대시보드에서 관찰·직접 전환을 확인한다.
5. 상태 추적 Hook 설치 전/후 동작과 기존 Extension 충돌을 조사한다.
6. 인계 후 기본 검사와 독립 AI 검증의 연결이 Main 활성 컨텍스트를 오염시키지 않는지 확인한다.
7. Worktree 생성 성공 + Pi 실행 실패, 중복 재요청, dirty tree, 재시작 후 Resume를 시험한다.

**실패 시 원칙:** 제품 계약을 낮추지 말고 기존 Pi/Git/tmux CLI의 직접 조합을 내부 실행 구현으로 검토한다. 패키지 확장·작은 Script·Extension 가운데 **전체 유지비용**이 낮은 접근을 택한다.

## 8. 기술 결정 보류

- Dashboard 하나로 모든 모드를 관리 가능한지, Split Pane UX가 충분한지.
- workmux 단독 vs ccmux 등 다른 Dashboard 조합.
- Handoff 신호를 Pi Tool, 명시적 명령, 이벤트 중 어느 경계로 받을지.
- 연결 정보의 저장 위치(가능하면 기존 Pi/Git/tmux 메타데이터 재사용).
- 독립 검증 세션의 호출 형태(`pi --print`, 지속 세션, 외부 Sub-agent 패키지).
- 동료 세션 식별 및 `pi-intercom` 실제 채택.
- 실제 요구사항에서 드러난 부족한 기능에 대한 Extension·Script 작성 범위.

이들 결정은 [Implementation Plan](IMPLEMENTATION_PLAN.md)의 실증 결과로 좁힌다. **미확정 기술을 확정 의존성으로 표기하지 않는다.**
