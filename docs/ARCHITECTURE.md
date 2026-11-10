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

## 3. Work → Main 정보 흐름

```text
Work의 보고·원문 근거·필수 WHY
    │
    └─ Work < → Handoff Brief 선택 → 실제 Main 반영문 한 번 승인
         │
         └─ 대상 Main 영속 보관 (모델 턴 없음)
               │
               └─ Main 활성 Fork 계보·최신 결정·중복 검사 (읽기 전용)
                     ├─ 안전: 승인한 동일 Brief를 Work 참고 보고로 추가
                     ├─ 중복: Main에 추가하지 않음
                     └─ 충돌/불확실/오프라인: 보류·재시도 또는 < 예외 검토
```

**확정 경계:** Work는 원본 Fork 시점 맥락과 자신의 Pi 분기만 읽습니다. Fork 이후 Main의 현재 정책을 몰래 조회하지 않습니다. 수신 Main은 **사용자가 Work에서 승인한 Work 참고 보고**만 활성 분기/최신 결정 검증 후 추가할 수 있습니다. 이때 Main 모델 턴·정책 승인·파일 변경은 자동으로 시작하지 않습니다. 충돌·불확실성은 Main 컨텍스트 밖에 보류합니다.

**PR #25 통합 중:** `extensions/context-review.ts`와 `src/handoff/context-review.ts`가 Work `<`의 후보·필수 맥락 검토를 담당합니다. `extensions/context-receive.ts`는 안전한 자동 참고 보고와 Main `<` 예외 검토를 담당합니다. `src/handoff/brief.ts`는 사용자가 승인하고 Main에 실제 추가되는 동일 본문을 구성합니다. 과거 자동 후보·`ask_user`·`/compose inbox` 경로는 파일로 남아 있지만 `extensions/compose.ts`의 기본 실행 경로에서 제외했습니다. 실제 통합 검증은 아직 완료되지 않았습니다. `src/handoff/store.ts`의 로컬 영속 보관과 `src/handoff/compare.ts`의 활성 분기 비교는 재사용 가능성 검토 대상입니다.

## 4. 원문 근거와 승인 경계

- 출처 Pi Entry ID/완료 분기, 선택한 공유 범위, 근거·WHY·조건과 본문을 연결해 손실과 왜곡을 검토합니다.
- 원문 일치만으로 부정문·사용자 승인·테스트 통과의 의미가 보증되지는 않습니다.
- 근거 미확인, 세션 전환, 중복 수신, 모델 검토 실패는 **성공 상태로 추측하지 않습니다**.
- Git 작업 공간 상태, Work의 결과 보고, Main 모델 컨텍스트, 프로젝트 문서 갱신은 서로 분리된 상태입니다.

## 5. 과거 구현과 차이

`src/overview.ts` 등 일부 Legacy 코드가 저장소에 남아 있어도 Sidebar·Overview를 현행 제품 요구사항으로 간주하지 않습니다. PR #25의 상세 코드 작성·Linux CI 여부는 [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에 기록하며 macOS 통합 검증 결과와 구분합니다.

실제 하위 API 계약은 [TRD](TRD.md), 진행/검증 항목은 [Implementation Plan](IMPLEMENTATION_PLAN.md)에서 관리합니다.
