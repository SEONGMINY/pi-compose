# TRD — Pi Compose 기술 계약

> 제품 요구사항: [PRD](PRD.md) · 구조 책임: [Architecture](ARCHITECTURE.md)
>
> 현행 PR #25 코드와 **2026-11-10 합의한 최신 목표 UX**를 구분합니다. 여기서 최신 목표라고 표기한 기능은 아직 코드에 반영·검증되지 않았습니다.

## 1. 구현에서 보존할 기술 경계

| 영역 | 계약 · 검증 포인트 |
| --- | --- |
| Main 세션 | bare `pic`이 별도 관리 TUI 없이 새 Main을 실행. Pi 기본 Resume는 기존 역할을 보존 |
| 정확한 Fork | `SessionManager.createBranchedSession`으로 선택한 Pi 활성 완료 분기 Fork; 원본 JSONL 불변, Compaction/ContextEdit 보존 |
| Support | 별도 Pi 세션 생성; 원본 Main 컨텍스트 자동 상속 없음 |
| 역할 신원 | Pi 세션 ID·프로젝트 식별·Agent 역할이 일치할 때만 신뢰. 이름/cwd만으로 수신자를 추정하지 않음 |
| Ghostty | 요청을 입력한 Pi Terminal UUID를 기준으로 Native Split. 포커스·중단·오류 상태를 추측하지 않음 |
| Git Worktree | 명령 입력 Agent의 Git HEAD에서 새 브랜치·Worktree; 미커밋 변경 복사, Merge/삭제 없음 |
| 근거 | 공유 항목·출처 Entry ID·조건/WHY·의미·검증 상태를 함께 유지; 단순 문자열 검사는 충분하지 않음 |
| Handoff 발신 | Work `<`에서 대상·전달 본문과 원문 근거를 확인하고 명시적으로 전송 승인; 모델 Steering과 분리 |
| Handoff 수신 | Main에는 비컨텍스트 알림만; 본문 확인 및 선택적 반영은 명시적 사용자 행동; 정책 변경 자동 승인 없음 |
| Main 최신성 | 수신 내용을 사용자 검토 시점의 Pi 활성 분기에서 비교. Work가 Fork 이후 Main을 조회하지 않음 |

## 2. PR #25의 구현과 최신 요구사항 사이 차이

| PR #25의 기존 경로 | 최신 요구사항 / 남은 조정 |
| --- | --- |
| 완료 보고 후 모델이 공유 후보 준비 및 `ask_user` 질문 요청 | 사용자 Work `<`를 중심으로 단순화. 자동 후보 준비의 계속 사용 여부는 미결정 |
| 근거 검색·의미 검사·`O/R/S` 미리보기 | 전달 대상·내용·출처 검토는 유지하되 최종 조작은 원본 Pi 관례로 단순화 필요 |
| `src/handoff/store.ts` 영속 저장 + Extension Channel 알림 | 내용의 비컨텍스트 저장은 보존 후보; Main에는 도착 알림만 |
| `/compose inbox` → `D/I/C/A` | 별도 Inbox 명령 없는 수신 확인·명시적 반영 UX를 새로 설계/구현해야 함 |
| `src/handoff/compare.ts`의 Main 활성 분기 비교 | 필요 시 재사용하되 기존 승인·시간 순서를 혼동하지 않도록 검증 |

기존 코드를 무조건 삭제하거나 기술 방식을 선승인하지 않습니다. PR #25에 있는 검증된 하위 기능을 재사용할 수 있는지 조사한 뒤 **최소 변경으로** 목표 UX를 구현합니다.

## 3. 실패 조건과 안전

- 사용자의 **보낸 내용 확인/승인** 이전에 Main에 패키지를 보내지 않습니다.
- 도착 알림은 수신 사실만 뜻합니다. Main 모델의 읽음, 수용, 실제 정책 변경을 뜻하지 않습니다.
- 부정문 뒤집힘, 미실행 테스트의 통과 오인, 승인 주체 바뀜, WHY 누락, Fork 이후의 상충 결정은 오류 사례로 검증합니다.
- Pi·Ghostty·pi-intercom·pi-ask-user의 실제 이벤트/API 기능은 해당 버전의 원본 동작을 먼저 확인합니다. 없는 기능을 추측해 작성하지 않습니다.
- 통합 검사·정적 검사·UI 실사용·의미 평가를 별개로 보고합니다.

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
4. Main 알림만 표시·컨텍스트 무주입·명시적 선택 반영·과거 보고/최신 정책 충돌 검출
5. Main 종료·재개, 부재 수신, 중복 알림, 오류/검토 실패 때 회복
6. Handoff 의미 품질(이전 논문·실험 사례)과 모델 비용·불필요한 조작

[검증 감사 기록](HANDOFF_IMPLEMENTATION_AUDIT.md)에는 PR #25의 코드·CI 관찰 범위가 포함됩니다. 이를 새 UX의 E2E 성공으로 확대하지 않습니다.
