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
Work 완료 사실/보고 + 원문 근거
    │
    └─ 사용자가 Work < 에서 전달 내용·대상 검토 및 승인
         │
         └─ 대상 Main의 비컨텍스트 수신 영역에 안전하게 기록
               │
               ├─ Main에는 도착 알림만 표시
               └─ 사용자가 내용을 확인하고 명시적으로 반영
                     └─ 기존 Main 최신 승인 결정과의 충돌 검토
```

**확정 경계:** Work는 원본 Fork 시점 맥락과 자신의 Pi 분기만 읽습니다. Fork 이후 Main의 현재 정책을 몰래 조회하지 않습니다. 수신 Main에 메시지를 자동 주입하거나 모델 실행·정책 변경을 자동 승인하지 않습니다.

**PR #25 구현 후보:** `extensions/handoff-candidates.ts`, `handoff-ready.ts`, `handoff-package.ts`, `handoff-inbox.ts`, `src/handoff/*`. 기존 코드는 자동 후보 준비와 `/compose inbox` 기반 검토를 구현하며 **최신 단순 Handoff UX로 변경되지 않았습니다**. `src/handoff/store.ts`의 로컬 영속 보관과 `src/handoff/compare.ts`의 활성 분기 비교는 재사용 가능성 검토 대상입니다.

## 4. 원문 근거와 승인 경계

- 출처 Pi Entry ID/완료 분기, 선택한 공유 범위, 근거·WHY·조건과 본문을 연결해 손실과 왜곡을 검토합니다.
- 원문 일치만으로 부정문·사용자 승인·테스트 통과의 의미가 보증되지는 않습니다.
- 근거 미확인, 세션 전환, 중복 수신, 모델 검토 실패는 **성공 상태로 추측하지 않습니다**.
- Git 작업 공간 상태, Work의 결과 보고, Main 모델 컨텍스트, 프로젝트 문서 갱신은 서로 분리된 상태입니다.

## 5. 과거 구현과 차이

`src/overview.ts` 등 일부 Legacy 코드가 저장소에 남아 있어도 Sidebar·Overview를 현행 제품 요구사항으로 간주하지 않습니다. PR #25의 상세 코드 작성·Linux CI 여부는 [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에 기록하며 macOS 통합 검증 결과와 구분합니다.

실제 하위 API 계약은 [TRD](TRD.md), 진행/검증 항목은 [Implementation Plan](IMPLEMENTATION_PLAN.md)에서 관리합니다.
