# Architecture — Pi Compose

> **현재 `main`과의 차이:** 아래는 확정 목표 Architecture입니다. `main`의 `bin/pic.mjs`는 여전히 Overview를 열고, 최신 `<` → Main 알림 경로는 구현되지 않았습니다. PR #25의 중간 구현과 목표 설계를 구분합니다.


> 제품 정책의 정본: [PRD](PRD.md) · 2026-11-10 최신 Handoff UX는 **설계 목표**, PR #25 코드는 그 이전 단계의 구현입니다.

## 1. 상위 구성 요소와 책임

| 구성 요소 | 역할 | 정본 |
| --- | --- | --- |
| Pi | 모델·세션 트리·Fork/Resume·Compaction/ContextEdit·Extension·TUI | Pi upstream |
| Ghostty | Native Split/Tab/Terminal·포커스 | Ghostty upstream |
| Git | 공유 디렉터리·Worktree·브랜치·병합 | Git |
| Pi Compose | Main/Work/Support 역할, 정확한 Fork, 최소 위임 연결, Work→Main의 사용자 검토 인계 | 이 저장소 |

Compose는 Pi 세션 엔진, 새 멀티플렉서, 상태 데이터베이스, 별도 GUI를 재구현하지 않습니다.

## 2. 진입과 위임

```text
bin/pic.mjs → Pi TUI Main (신규 또는 Pi 기본 Resume)
                 │
                 ├─ >w / >>w → 정확한 활성 완료 Pi 분기 Fork → Work
                 └─ >s / >>s → 독립 Pi 세션 → Support
                                      └─ Ghostty Native Split
```

- `src/agent-bootstrap.ts`, `extensions/agent-identity.ts`: 프로젝트·세션·역할 출처 식별
- `src/native-work-fork.ts`, `src/product-sessions.ts`: 원본 활성 분기 확인 및 정확한 Fork
- `src/native-agent-launch.ts`, `src/ghostty-native.ts`: Ghostty Terminal 기준 새 Agent 실행
- `src/native-worktree.ts`: 선택된 Git 작업 공간 생성
- `extensions/direct-delegation.ts`: 직접 입력을 사용자 위임으로 해석

원본 Pi JSONL 불변, 현재 명령을 입력한 Agent의 작업 디렉터리와 Fork 원본 대화의 독립성을 유지합니다.

## 3. Main 결정 전파와 Work-owned Handoff

```text
Main: 사용자 확정 발화 + 원본 제안
 └─ PolicyMain: 승인 문장과 원문 인용 확인 (모호하면 전파 금지)
      └─ Main Pi custom entry (분기 상대적 결정 기록)
           └─ local policy snapshot (빠른 조회 캐시 · 정본 아님)
                └─ Work: 다음 모델 요청에서 변경분만 제공
                     ├─ 기존 위임 범위에서 자율 재평가·수정
                     ├─ 상태 불명확/정책 변경 미반영 명시
                     └─ Work < 사용자 승인 Brief
                          └─ Main inbox → 대상/계보/해시/중복 검증
                               └─ 정확히 같은 Work 참고 보고
```

- `src/policy/decisions.ts`: 사용자 승인 근거·결정·활성 분기 및 Work 인지 상태의 계약
- `extensions/policy-main.ts`: 확정으로 의심되는 사용자 발화만 제한적으로 모델 확인; Main 원본 세션에 `custom` 기록
- `src/policy/store.ts`: 정책 소유 Main의 현재 활성 분기 결정 집합을 로컬 인덱스로 저장·조회. 파일 알림은 최적화; Work 시작/모델 경계/Handoff 시 재조회
- `src/policy/owners.ts`: requester와 Fork 계보를 대조하여 Work가 구독할 Main 식별; 서로 다른 Main이면 조용히 추측하지 않음
- `extensions/policy-work.ts`: 기존 Work Pi 세션 유지; `before_agent_start`와 `context`에서 변경된 결정만 모델에 전달. 영속 메시지 수신과 실제 코드 적용은 다름
- `extensions/context-review.ts`: Work Handoff에 정책 최신성·미확인 변경을 정확한 승인 Brief에 포함. 검토 도중 변경되면 재검토
- `extensions/context-receive.ts`: 메인에서 Work 전체 Claim 재심사를 제거; 승인한 원문 그대로 참고 정보로 반영, 영속 수신·실제 Pi receipt 분리

**책임 경계:** 사용자 승인 정책은 Main 소유이며 Work 보고는 참고 정보입니다. 실시간 전파는 정책 승인·새 범위 위임·테스트 성공·Git Merge를 암묵적으로 수행하지 않습니다. 과거 분기로 이동하면 현재 Pi 계보에서 유효한 결정만 다시 계산합니다. Work의 전체 맥락이나 Main 대화 전체를 복제하지 않습니다.

**의도적 제한:** JSON 인덱스는 Main 원본 세션을 대체하지 않습니다. 현재 Main이 확정된 정책을 전파할 수 있다는 것은 모든 자연어 승인을 완벽히 추출한다는 보장이 아닙니다. 모델·저장·Hook 오류가 나면 확인 실패를 숨기지 않고 복구 가능한 상태를 유지합니다.

## 4. 원문 근거와 승인 경계

- 출처 Pi Entry ID/완료 분기, 선택한 공유 범위, 근거·WHY·조건과 본문을 연결해 손실과 왜곡을 검토합니다.
- 원문 일치만으로 부정문·사용자 승인·테스트 통과의 의미가 보증되지는 않습니다.
- 근거 미확인, 세션 전환, 중복 수신, 모델 검토 실패는 **성공 상태로 추측하지 않습니다**.
- Git 작업 공간 상태, Work의 결과 보고, Main 모델 컨텍스트, 프로젝트 문서 갱신은 서로 분리된 상태입니다.

## 5. 과거 구현과 차이

`src/overview.ts` 등 일부 Legacy 코드가 저장소에 남아 있어도 Sidebar·Overview를 현행 제품 요구사항으로 간주하지 않습니다. PR #25의 상세 코드 작성·Linux CI 여부는 [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에 기록하며 macOS 통합 검증 결과와 구분합니다.

실제 하위 API 계약은 [TRD](TRD.md), 진행/검증 항목은 [Implementation Plan](IMPLEMENTATION_PLAN.md)에서 관리합니다.
