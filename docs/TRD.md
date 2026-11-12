# TRD — Pi Compose 기술 계약

> 제품 요구사항: [PRD](PRD.md) · 구조 책임: [Architecture](ARCHITECTURE.md)
>
> **Work-owned Handoff 및 정책 변경 전파 기술 계약.** 구현·병합과 macOS/Ghostty 검증 완료는 구분합니다.

## 1. 구현에서 보존할 기술 경계

| 영역 | 계약 · 검증 포인트 |
| --- | --- |
| Main 세션 | bare `pic`이 별도 관리 TUI 없이 새 Main을 실행. Pi 기본 Resume는 기존 역할을 보존 |
| 정확한 Fork | `SessionManager.createBranchedSession`으로 선택한 Pi 활성 완료 분기 Fork; 원본 JSONL 불변, Compaction/ContextEdit 보존 |
| Support | 별도 Pi 세션 생성; 원본 Main 컨텍스트 자동 상속 없음 |
| 역할 신원 | Pi 세션 ID·프로젝트 식별·Agent 역할이 일치할 때만 신뢰. 이름/cwd만으로 수신자를 추정하지 않음 |
| Ghostty | 요청을 입력한 Pi Terminal UUID를 기준으로 Native Split. Handoff 검토에서 `Alt+Z`는 **정확한 현재 포커스 Split**에만 `toggle_split_zoom` 수행(명시적 사용자 요청, 확대 상태 읽기 API 없음). Compose가 전환한 경우 종료 시 복원 시도; 포커스·중단·오류 상태를 추측하지 않음 |
| Git Worktree | 명령 입력 Agent의 Git HEAD에서 새 브랜치·Worktree; 미커밋 변경 복사, Merge/삭제 없음 |
| 근거 | Work가 보고·원문 Entry ID·필수 WHY·조건/부정문·검증 상태를 연결. 원문 일치는 출처 증거일 뿐 작업 실행의 독립적 사실 검증이 아님 |
| Handoff 발신 | Work `<`에서 핵심 결과·필수 WHY·출처를 선택하고 Main에 실제 추가될 Handoff Brief를 한 번 승인; 모델 Steering과 분리 |
| Handoff 수신 | 승인 원본과 본문 해시·실제 Work/Fork 계보·대상 Main·활성 분기·중복을 기계적으로 확인. 의미 재심사/추가 Main 승인 없이 동일 Work 보고 기록 |
| Main 최신성 | 정책 확정 발화와 실제 제안 원문을 연결해 Pi Main custom entry에 기록. Work는 최신 승인 변경분만 받되 기존 Fork와 Main의 기록은 독립 유지 |

## 2. 새 정책 변경 전파 구현 경계

| 구성 | 계약 |
| --- | --- |
| 승인 후보 감지 | Main의 사용자 발화에 승인 신호가 있는 경우만 저비용 후보 처리. 모델이 제안 내용을 추측하여 새 정책으로 확정하지 못함 |
| 출처 | Main의 사용자 승인 Entry 및 실제 원문 인용 Entry. 둘 다 활성 분기 계보에서 찾을 수 있어야 유효 |
| 원본/인덱스 | 원본 Main의 `compose_policy_decision` custom entry가 권위. 외부 로컬 스냅샷은 현재 분기 기준 조회 캐시, 오류·재개 시 복구 대상 |
| Work 소유 Main | requester 관계와 Fork 원본을 별도로 검증. 충돌하는 Main 발견 시 임의 구독 금지 |
| 적용 | Work는 변화가 있으면 실제 모델 호출 직전 변경분을 받음. `before_agent_start` 및 `context`; 전파된 것과 반영된 것 구분 |
| 완료 | Handoff에는 Work가 확인한 최신성 상태만 기록. 테스트·정책 승인 성공으로 승격하지 않음 |
| 수신 | `src/handoff/direct-adoption.ts`에서 순수 전달 검증. Main 정책 의미 재비교는 정상 경로에서 제거 |
| 분기 | 원본 Main 활성 분기 변경 시 유효 결정 집합 재계산. Work가 과거 결정에 따라 바꾼 파일을 자동 되돌리지 않음 |

기존 `src/handoff/compare.ts`와 `automatic-adoption.ts`는 이전 비교 정책 구현입니다. 새 자동 수신 경로에서는 호출하지 않습니다. 사용 여부 확인 후 정리하며, 이전 테스트를 새로운 성공 증거로 간주하지 않습니다.

## 3. 실패 조건과 안전

- 사용자의 **보낸 내용 확인/승인** 이전에 Main에 패키지를 보내지 않습니다.
- 도착 알림·원본 영속 저장·Main 활성 컨텍스트 반영 receipt·정책 채택은 각각 독립된 상태입니다. 원본 저장은 두 번째 사용자 승인을 요구하지 않습니다. 실제 Pi 활성 분기 receipt 전에 참고 보고 반영 완료로 표시하지 않습니다.
- Work의 부정문·WHY 누락, 미실행 테스트의 통과 오인, 승인 주체 변경을 방지하고, Main에서는 전달 무결성과 정확한 Fork 계보만 검사합니다. `insufficient`는 사용자 정책 충돌과 동의어가 아닙니다.
- Pi·Ghostty·pi-intercom·pi-ask-user의 실제 이벤트/API 기능은 해당 버전의 원본 동작을 먼저 확인합니다. 없는 기능을 추측해 작성하지 않습니다.
- 통합 검사·정적 검사·UI 실사용·의미 평가를 별개로 보고합니다.

### Main 참고 보고 반영의 최소 검사 (새 계약)

- 사용자 승인 본문, 대상 ID, Work 원본·Fork 계보, 활성 분기, 중복 및 Pi receipt만 확인합니다.
- Main 의미 비교 모델 호출은 정상 수신 경로에서 금지합니다.
- Work가 알려준 최신성·테스트 상태를 출처가 있는 보고로 기록합니다. 미검증 정보는 미검증인 채로 유지합니다.
- 실제 Pi `message_end` receipt 전에 자동 반영 완료를 표시하지 않습니다.

## 4. 검토한 원본과 연구의 적용 범위

현행 PR #25 코드의 검토 대상 조합은 **Pi 1.4.0, Ghostty 1.3.1, pi-intercom 0.18.1, pi-ask-user 0.17.2**입니다. 외부 기능은 설치 사실이 아닌 해당 버전의 실제 동작으로 검증합니다.

- [QMSum](https://aclanthology.org/2021.naacl-main.472/) — 긴 기록에서 관련 근거를 찾는 접근
- [FActScore](https://aclanthology.org/2023.emnlp-main.741/) — 사실 단위 근거 대조
- [SummEdits](https://aclanthology.org/2023.emnlp-main.600/) — 미묘한 의미 왜곡의 평가
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) — 긴 맥락 내 정보 활용 한계

이 자료는 근거 검색·의미 검토의 설계 참고 자료이며 Pi Compose의 정확도·모델 비용·최신 UX의 성공을 증명하지 않습니다. 실제 사용자 실험의 오류 사례와 비교해야 합니다.

## 5. 실제 환경에서 검증할 것

1. Main 새 세션/복구·역할 식별과 Ghostty 기준 Split·포커스
2. 정확한 Pi 완료 지점 Fork, 원본 불변, Shared/Worktree 모두 동작
3. Work 실행 중/종료 후 `<` 요청·취소·본문 확인·중복 전송 방지
4. Work 한 번 승인 후 Main 외부 원본 수신(무재승인)·활성 분기 계보 검사·동일 승인 Brief 자동 반영 및 기존 정책 권위 보존
5. Main 종료·재개, 부재 수신, 중복 알림, 오류/검토 실패 때 회복
6. Handoff 의미 품질(이전 논문·실험 사례)과 모델 비용·불필요한 조작

[검증 감사 기록](HANDOFF_IMPLEMENTATION_AUDIT.md)에는 PR #25의 코드·CI 관찰 범위가 포함됩니다. 이를 새 UX의 E2E 성공으로 확대하지 않습니다.
