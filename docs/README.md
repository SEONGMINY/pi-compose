# Pi Compose 설계 문서

> 기준: 2026-10-31 확정 PRD 및 2026-11-01 Draft PR #15 Handoff 구현 현황. **제품 설계와 코드 작성/실행 검증은 별개입니다.**

문서는 업무 목적에 맞게 구분합니다. 같은 계약을 여러 문서에 복제하지 않고, 변경할 때 해당 문서의 원본을 갱신합니다.

| 문서 | 무엇을 확인할 때 |
| --- | --- |
| [PRD](PRD.md) | **현재 제품 요구사항과 확정·미확정 정책의 기준** |
| [Architecture](ARCHITECTURE.md) | Main/Work/Support, Pi, Ghostty, Git, 문서의 책임과 관계 |
| [TRD](TRD.md) | 기술 선택·검증 대상, Pi Skill/Extension 활용 범위 |
| [Implementation Plan](IMPLEMENTATION_PLAN.md) | 앞으로 구현할 순서와 완료 기준 (이전 실행 계획 대체) |
| [Usage](USAGE.md) | 설계된 사용자 흐름과 아직 지원하지 않는 동작 |
| [ADR 0001](adr/0001-context-and-delegation.md) | 정확한 Fork와 독립 컨텍스트를 나눈 결정 이유 |
| [ADR 0002](adr/0002-user-controlled-execution.md) | 사용자가 실행·세션 복원·Git 통합을 직접 선택하는 원칙 |
| [ADR 0003](adr/0003-composable-execution-and-verification.md) | 기존 도구 재사용, Summary와 Handoff의 분리 |
| [ADR 0004](adr/0004-pi-native-optional-views.md) | **과거 선택형 workmux View 결정 — 현재 방식에는 적용하지 않음** |
| [ADR 0005](adr/0005-pic-entry-and-pi-settings.md), [ADR 0006](adr/0006-github-installer.md) | 이전 `pic` CLI/설치 구현의 역사적 결정 |
| [도메인 경험](domain-stories/01-as-is-and-pain-points.md) · [초기 시나리오](domain-stories/02-to-be-and-scenarios.md) | 초기 문제 정의와 개발 사례. 과거 tmux/workmux 흐름은 현재 지침이 아님 |

## 무엇이 중요한 계약인가?

1. **사용자의 실제 승인과 결정이 최우선**입니다. Main/Work의 제안이나 보고를 사용자 승인으로 오인하지 않습니다.
2. Main 대화의 **선택 이유, 금지 강도, 폐기 대안, 확정/검토 중의 차이**를 보존합니다. 필요하면 Pi 세션 트리에서 이전 지점으로 돌아갑니다.
3. 기존 `docs/*`는 장기적인 지식의 원본입니다. 프로젝트의 `AGENTS.md`는 문서를 찾는 **짧은 안내자**이며, 대화 전체의 사본이나 계약 DB가 아닙니다.
4. 중요 결정을 승인하면 **기존 관련 문서를 즉시 자동 갱신**합니다. 신규 문서 생성은 사용자에게 확인합니다. 단순 구현 기록과 모든 도구 로그를 문서로 만들지 않습니다.
5. 문서의 중요한 업무·기술 계약과 선택 이유를 훼손할 수 있는 변경은 비교합니다. 변경 의도가 **명확하지 않을 때만** 확인합니다.
6. 문서와 Pi 대화는 각각 독립적으로 되돌립니다. Pi 대화 롤백이 파일을 자동 롤백하지는 않습니다.
7. Work의 로그·결정을 Main에 자동 입력하지 않습니다. Summary Overlay는 사용자용이고, Main 반영은 명시적 요청 시에만 합니다.

## 문서 관리의 비용

- 이 저장소의 현재 `main`에는 프로젝트 루트 `AGENTS.md`가 없습니다. **없는 문서를 합의 없이 자동 생성하지 않습니다.** 위의 원칙은 앞으로 프로젝트에 적용할 가이드입니다.
- 문서 수·중복·모호한 계약을 늘리는 자동화는 피합니다. 초기에는 짧은 프로젝트 지침과 Pi의 기본 파일 도구를 사용하고, 실제 문서화 누락을 확인한 뒤에만 Extension 보강을 검토합니다.
- 대화가 충분하지 않은 세션은 **사용자가 요청한 경우에만** 필요한 프로젝트 문서를 선택적으로 읽어 맥락을 확보합니다. Skill은 구현 후보이고 명령/동작은 확정하지 않았습니다.

## 이전 기록의 취급

Orca 통합은 중단했고, tmux·workmux 기반 설계 및 이전 테스트/사용 가이드는 **역사적 자료**입니다. 이전 코드가 남아 있다고 새 방향의 기능이 구현된 것은 아닙니다. 주요 결정 및 미해결 사항은 [PRD](PRD.md)를 우선합니다.
