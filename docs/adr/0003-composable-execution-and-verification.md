# ADR 0003 — 반복 절차를 조합하고, 검증은 Main 밖에서 수행

- 상태: **채택 — 아키텍처 원칙 / 패키지 상세는 검증 후 선정**
- 결정일: 2026-10-25 정리 (사전 설계 대화에서 합의)
- 연관 요구사항: [PRD](../PRD.md) FR-05, FR-09~11, FR-13~20

## 배경

기존 Pi·Git·tmux 기능을 손으로 연결하는 방식은 Harness 구현 비용은 낮지만 **사용자의 반복 조작 비용**을 높인다. 반대로 개발·Git·세션·대시보드를 모두 직접 만들면 초기 개발·업데이트·복구 비용이 크다.

또 Main이 개발 결과 인계와 Git Diff를 직접 분석할 경우 고품질 설계 컨텍스트가 일시적인 실행 정보로 채워진다. 개발 Agent의 완료 주장은 실제 코드와 다를 수 있고, 개별 테스트 통과는 통합된 결과의 계약 준수를 보장하지 않는다.

## 결정

### 1. 기존 도구를 재사용하면서 반복 작업을 추상화

- Pi: 세션 New/Fork/Resume, Context/Compaction/도구.
- Git 및 선택된 기존 CLI: 브랜치·Worktree·Diff·통합.
- tmux: 실행 프로세스·Pane/Session.
- 기존 Dashboard: 상태·전환·분할 화면, 가능하면 임의 tmux Pi 세션도 관찰.
- Pi Compose: **명시된 사용자 실행 옵션을 검증하고 기존 기능을 연결**하는 공통 실행 진입점.
- Extension·Skill·Script: 서로 다른 역할. Skill은 판단 기준, Extension은 실행 UI/도구, Script·기존 CLI는 결정적 동작.
- 현재 `workmux`가 Pi Fork + Worktree를 지원하는 **우선 검증 후보**지만 확정 의존성은 아니다.

“기능이 없으면 만들 수 있다”는 유연성을 유지한다. 다만 새 기능을 만들 때는 **실제 부족한 사용자 경험과 Resource/Impact**가 근거가 되어야 한다. 최소 코드량만을 목표로 삼지 않는다.

### 2. 개발 결과는 간결하게 인계

Handoff는 구현·WHY·검사·미해결 문제·Session/Git 위치를 포함한다. **주장이지 증거는 아니다.** 긴 코드 로그나 전체 Diff를 Main에 전달하지 않는다.

### 3. 기본 검사는 자동, 의미적 AI 검증은 선택적으로

- **완료 신호:** 개발 Agent의 명시적 Handoff. tmux Idle·Pi Turn 종료·테스트 통과와 구분.
- **기본 검사:** base SHA·Git tracked/untracked·staged/unstaged·변경 범위·실행 가능한 검사 결과를 자동 확인.
- **AI 검증:** 실패·계약 영향·불확실성·사용자 요청 등이 있을 때 **별도 Pi 컨텍스트**에서 실행.
- **Main 인계:** 결론·이유·계약 충돌·미검증 범위·원문/코드의 근거 위치만 제공.
- 모든 변경 경로를 발견하지만 깊은 AI 코드 분석은 계약 위험이 큰 부분부터 수행. Shared Directory의 에이전트별 변경 귀속을 추측하지 않는다.
- 기본 Git 확인을 완료했다고 **계약 검증 완료**라고 표시하지 않는다.

### 4. 협업은 선택적 직접 통신

관련 Agent의 전제에 영향을 주는 발견만 공유한다. **발견/제안/승인/실제 변경**을 구분하고, 다른 에이전트의 “사용자가 승인했다”는 말로 계약을 바꾸지 않는다. Main은 상시 Message Bus가 아니다.

### 5. 통합은 사용자가 통제하고 통합 후 다시 확인

검증 결과와 Git 통합은 별개. 실제 병합과 정리 시점은 사용자가 선택하며, 합쳐진 코드에서 필요한 검사로 개별 작업 사이의 불일치를 확인한다.

## 비교했던 대안과 비용

| 대안 | 초기 비용 | 지속 비용·문제 | 결론 |
| --- | --- | --- | --- |
| 기본 CLI 수동 조합 | 최소 | 매번 사용자 조작 반복 | 최종 사용자 경험으로는 부족 |
| 모든 단계를 Skill이 모델로 실행 | 낮은 코드량 | 토큰·명령 생성·실패 비용, Main 오염 가능 | 필요 판단에는 사용, 반복 명령은 결정적 실행 선호 |
| 기존 Dashboard 기능만 수용 | 낮음 | Fork+Worktree 등 기능 공백을 제품 제약으로 삼을 위험 | 제품 계약을 유지한 채 보완 |
| 기존 패키지에 영구 Fork 패치 | 중간 | 업스트림 버전·Hook 호환성 부담 | 꼭 필요할 때 선택 |
| 자체 Runtime·Dashboard·Contract DB | 매우 높음 | 중복 구현과 장기 운영 | 초기 범위 제외 |
| 항상 여러 AI Reviewer 실행 | 높음 | 작은 변경까지 토큰·조율 부담 | 위험 비례 선택적 검증 |
| Main이 직접 모든 Diff 분석 | 낮은 별도 구현 | Main 컨텍스트 오염·Compaction 위험 | 선택하지 않음 |
| **공통 실행 기능 + 기존 CLI + 독립 검증** | 낮음~중간 | 실제 연결·실패 복구 구현 필요 | 채택 |

## 성립 조건과 미검증 사항

1. Pi와 workmux의 실사용 Fork·Worktree 조합에서 원본 세션과 cwd를 정확히 찾는가?
2. 기존 Dashboard가 Shared와 Worktree Pi 세션을 함께 관찰하는가? Pi Hook과 다른 Extension 충돌은 없는가?
3. 명시적 Handoff 한 번으로 기본 Git 확인을 안전하게 연결할 수 있는가?
4. 독립 AI 검증에 전달할 원래 계약 근거와 Git Snapshot을 적절히 식별할 수 있는가?
5. 실패한 실행을 재시도할 때 사용자 작업을 안전하게 보존할 수 있는가?

이 사항은 [TRD](../TRD.md)와 [Implementation Plan](../IMPLEMENTATION_PLAN.md)에서 다룬다. **기술 실증 실패가 사용자 요구사항의 자동 삭제를 뜻하지 않는다.**

## 파생 결과

- Pi Compose는 “설정만 모은 프로젝트”로 제한되지 않는다. 사용자 반복 작업을 줄이는 **작은 Extension/Script 구현을 적극 허용**한다.
- 반대로 존재한다는 이유만으로 새 자동 Scheduler, 승인 Gate, 실시간 파일 추적·계약 변경 시스템을 추가하지 않는다.
- 특정 제품 도구를 교체할 수 있도록 책임을 나누되, 추상화를 위해 거대한 Provider/Adapter Framework를 선구축하지 않는다.
- 모든 검증은 **검증한 코드 상태와 범위**를 보고한다. 검증 후 파일이 바뀌었다면 검증 결과를 그대로 새 상태에 적용하지 않는다.

## 참고 공개 사례

- [workmux](https://github.com/raine/workmux) · [Pi Fork 동작 테스트](https://github.com/raine/workmux/blob/main/tests/test_fork.py)
- [Anthropic Claude Code code-review Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review): 독립 Reviewer로 변경 근거 분석, 불필요한 리뷰 노이즈 감소 사례.
- [OpenAI Codex](https://github.com/openai/codex): 독립 검증·세션·멀티 에이전트 구현의 공개 사례.

기존 제품에 기능이 있다는 사실과 **현재 Pi Compose 환경에서 검증·채택했다는 사실은 다르다**.
