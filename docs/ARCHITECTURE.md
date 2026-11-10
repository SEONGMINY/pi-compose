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

이 경로에서 Work의 Fork 시점 기록과 Main의 수신 시점 기록은 **서로 다른 컨텍스트**입니다. 비교는 Main 사용자가 결과를 검토하는 시점에 이루어져야 합니다.

**미병합 구현:** Handoff의 보관·근거 검토 구현은 [PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에서 별도로 진행됩니다. 구체적 코드 위치와 검증은 해당 PR 및 [과거 Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에서 확인합니다.

## 4. 기술 계약과 안전 경계

Handoff는 Work의 원문 근거·전달 패키지, 대상 Main별 보관, 가벼운 알림, Main의 선택적 모델 검토를 분리하는 구조입니다. 출처 Entry·세션 신원·변경된 활성 분기·중복 저장의 검증 방법은 [TRD](TRD.md)를 참고합니다. 제품상 사용자 승인 범위는 [PRD](PRD.md)를 따릅니다.

## 5. 코드와 설계의 경계

`main`의 `src/overview.ts`와 이전 Extension은 현재 실행 코드이며 목표 UX의 구현 완료를 뜻하지 않습니다. 단계별 검증을 수행하기 전까지 PR #25의 구현·CI 결과도 실제 macOS 통합 성공으로 확대하지 않습니다.

실제 하위 API 계약은 [TRD](TRD.md), 남은 작업은 [Implementation Plan](IMPLEMENTATION_PLAN.md)에서 관리합니다.
