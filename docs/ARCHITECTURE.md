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

## 3. Work → Main 신뢰 경계 및 정보 흐름

```text
Work: 결과·실행 검증 상태·Fork 당시 WHY를 원문에 연결
  └─ Work < → 전달할 결과/필수 제약 검토 → 실제 본문 한 번 승인
       └─ Main의 외부 영속 보관함: 원본 수신·출처/해시/계보 검사
            └─ Main 활성 분기의 Fork 이후 결정 정합성·중복 검사
                 ├─ 확인됨: 동일 승인 Brief를 출처 있는 참고 보고로 추가
                 ├─ 중복: 재삽입하지 않음
                 ├─ 정책 충돌: 외부 보관, 기존 결정 유지, 필요한 판단만 요청
                 └─ 근거/비교/전달 불확실: 외부 보관, 기술 복구/상태 안내
```

**경계 1 — Work 보고의 신뢰:** Work가 자신의 작업과 Fork 당시 제약을 확인하고, 사용자가 어떤 내용을 보낼지 승인합니다. 이것은 내용의 **출처와 검증 상태가 명시된 보고**이며 독립적으로 입증된 모든 사실이나 새로운 Main 정책이 아닙니다.

**경계 2 — Main 원본 수신:** 저장소 수신은 Main Pi 대화/모델 컨텍스트 삽입과 다릅니다. 성공적으로 저장·검증된 원본을 임의로 재요약하거나 다시 승인받지 않습니다.

**경계 3 — Main 활성 컨텍스트 반영:** Main은 현재 활성 분기와 Fork 이후 **관련 결정 변경**의 정합성을 확인합니다. Work의 구현·테스트를 Main 대화 근거로 다시 심사하지 않습니다. 불확실하면 원본을 보존하고 무조건 사용자에게 정책 결정을 요구하지 않습니다. 승인된 Brief 자체를 새 정책으로 승격하지 않고, 모델 턴도 자동 시작하지 않습니다.

**코드 현황:** `extensions/context-review.ts`와 `src/handoff/context-review.ts`는 Work 검토를, `src/handoff/store.ts`는 보관함을, `extensions/context-receive.ts`는 자동 수신과 예외 경로를, `src/handoff/brief.ts`는 승인 본문을 담당합니다. 현재 `src/handoff/compare.ts`의 Work 전체 재분류와 `insufficient` 일괄 보류는 위 목표보다 넓으므로 추후 좁혀야 합니다. PR #25는 Draft이고 기능 동작 검증은 별개입니다.

## 4. 원문 근거와 승인 경계

- 출처 Pi Entry ID/완료 분기, 선택한 공유 범위, 근거·WHY·조건과 본문을 연결해 손실과 왜곡을 검토합니다.
- 원문 일치만으로 부정문·사용자 승인·테스트 통과의 의미가 보증되지는 않습니다.
- 근거 미확인, 세션 전환, 중복 수신, 모델 검토 실패는 **성공 상태로 추측하지 않습니다**.
- Git 작업 공간 상태, Work의 결과 보고, Main 모델 컨텍스트, 프로젝트 문서 갱신은 서로 분리된 상태입니다.

## 5. 과거 구현과 차이

`src/overview.ts` 등 일부 Legacy 코드가 저장소에 남아 있어도 Sidebar·Overview를 현행 제품 요구사항으로 간주하지 않습니다. PR #25의 상세 코드 작성·Linux CI 여부는 [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에 기록하며 macOS 통합 검증 결과와 구분합니다.

실제 하위 API 계약은 [TRD](TRD.md), 진행/검증 항목은 [Implementation Plan](IMPLEMENTATION_PLAN.md)에서 관리합니다.
