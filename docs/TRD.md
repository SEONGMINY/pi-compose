# TRD — Pi Compose 기술 계약

> 제품 요구사항: [PRD](PRD.md) · 구조 책임: [Architecture](ARCHITECTURE.md)
>
> **2026-11-11 Handoff 신뢰 경계 갱신.** 이 문서의 목표 계약과 PR #25의 현재 구현을 구별합니다. Main 비교 책임 축소와 예외 UI 개편은 아직 미구현·미검증입니다.

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
| Handoff 수신 | 외부 보관함에 승인 원본·출처·해시·Fork 관계를 수신. Main 모델 컨텍스트 반영은 **별도 단계**로 처리하며 두 번째 사용자 수락은 요구하지 않음 |
| Main 최신성 | 활성 분기의 Fork 이후 관련 확정 결정·중복·계보만 정합성 확인. Main 대화에 파일 실행 결과가 없다는 이유로 Work 작업을 재심사하지 않음. Work는 Fork 이후 Main을 조회하지 않음 |

## 2. PR #25의 구현과 최신 요구사항 사이 차이

| PR #25의 기존 경로 | 최신 요구사항 / 남은 조정 |
| --- | --- |
| 완료 보고 후 모델이 공유 후보 준비 및 `ask_user` 질문 요청 | `extensions/compose.ts`는 자동 질문을 등록하지 않음. Work `<` 시 `prepareManualHandoffCandidates` 실행, Context Review 검토 |
| 근거 검색·의미 검사·`O/R/S` 미리보기 | `src/handoff/context-review.ts`에서 연결 근거를 포함한 단위 구성 및 선택별 결정적 본문 재생성. 임시 Pi `ctx.ui.custom` 화면에서 Space·Tab·Enter·Esc 사용 |
| `src/handoff/store.ts` 영속 저장 + Extension Channel 알림 | 외부 원본 수신은 유지. 정상 보고의 Main 모델 컨텍스트 반영과 실제 Pi receipt는 별도 상태 |
| `/compose inbox` → `D/I/C/A` | Work 한 번 승인 후 Main이 최신 결정·계보를 비교해 안전한 경우 동일 Brief를 `triggerTurn:false`로 기록. Main `<`는 충돌·불확실성 예외 처리. 기존 Inbox 명령은 기본 경로에서 제외 |
| `src/handoff/compare.ts`의 Main 활성 분기 비교 | 현재는 Work 전체를 재분류해 `insufficient`도 보류함. 향후 Fork 이후 변경된 관련 Main 결정의 정합성만 검토하도록 범위 축소. 기술 오류/증거 부족/정책 충돌 분리 |

기존 코드를 무조건 삭제하거나 기술 방식을 선승인하지 않습니다. PR #25에 있는 검증된 하위 기능을 재사용할 수 있는지 조사한 뒤 **최소 변경으로** 목표 UX를 구현합니다.

## 3. 실패 조건과 안전

- 사용자의 **보낸 내용 확인/승인** 이전에 Main에 패키지를 보내지 않습니다.
- 도착 알림·원본 영속 저장·Main 활성 컨텍스트 반영 receipt·정책 채택은 각각 독립된 상태입니다. 원본 저장은 두 번째 사용자 승인을 요구하지 않습니다. 실제 Pi 활성 분기 receipt 전에 참고 보고 반영 완료로 표시하지 않습니다.
- Work의 부정문·WHY 누락, 미실행 테스트의 통과 오인, 승인 주체 변경을 방지하고, Main에서는 Fork 이후 상충 결정만 추가로 검사합니다. `insufficient`는 사용자 정책 충돌과 동의어가 아닙니다.
- Pi·Ghostty·pi-intercom·pi-ask-user의 실제 이벤트/API 기능은 해당 버전의 원본 동작을 먼저 확인합니다. 없는 기능을 추측해 작성하지 않습니다.
- 통합 검사·정적 검사·UI 실사용·의미 평가를 별개로 보고합니다.

### Main 참고 보고 반영의 최소 안전 검사 (확정 원칙, 구현 예정)

- **결정론적 검사:** 수신자 Main 세션, 원본 Work/Fork 계보, 본문 해시·정확한 사용자 승인 본문, 현재 활성 Pi 분기, 동일 패키지의 기존 receipt를 확인합니다. 검증 실패는 시스템/전달 문제이며 정책 충돌이라고 부르지 않습니다.
- **의미 검사 범위:** Fork 이후 Main의 **관련 확정 결정이 변경됐거나 변경 여부의 확인이 불충분한 경우**로 좁힙니다. 변경이 확인되지 않았다는 것과 확인할 기록이 부족한 것을 혼동하지 않습니다. 비교 결과가 불충분하면 무조건 안전하다고 판정하지 않습니다.
- **보고의 권한:** Work 주장과 실행·테스트 결과를 `Work가 보고함`으로 명시합니다. Main 기록에 삽입하더라도 사용자 지시·확정 정책·독립 검증 완료로 승격하지 않습니다.
- **오류 분리:** 모델·JSON·전달 오류는 기술적 재시도/복구, 검증 근거 부족은 Work 보완 또는 출처가 명시된 미검증 보고, Main 결정과 실제 충돌은 사용자 판단입니다. 세 경우를 공통 `requires-review` 사용자 팝업으로 처리하지 않습니다.
- **반영 완료 조건:** 승인된 정확한 Brief가 활성 Main에 기록된 것을 Pi receipt로 확인했을 때만 반영 완료입니다. 정책 자동 변경, 테스트 재실행, Git 병합은 발생하지 않습니다.

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
4. Work 한 번 승인 후 Main 외부 원본 수신(무재승인)·활성 분기 비교·조건부 동일 Brief 반영 및 기존 정책 권위 보존
5. Main 종료·재개, 부재 수신, 중복 알림, 오류/검토 실패 때 회복
6. Handoff 의미 품질(이전 논문·실험 사례)과 모델 비용·불필요한 조작

[검증 감사 기록](HANDOFF_IMPLEMENTATION_AUDIT.md)에는 PR #25의 코드·CI 관찰 범위가 포함됩니다. 이를 새 UX의 E2E 성공으로 확대하지 않습니다.
