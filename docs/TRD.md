# TRD — Pi Compose 기술 계약

> 제품 요구사항: [PRD](PRD.md) · 구조 책임: [Architecture](ARCHITECTURE.md)
>
> 여기서는 기술적 구현 조건과 검사 대상을 다룹니다. 미병합 코드의 진척도는 [PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)에서, 당시 감사 결과는 [Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)에서 확인합니다.

## 1. 구현에서 보존할 기술 경계

| 영역 | 계약 · 검증 포인트 |
| --- | --- |
| Main 세션 | Pi의 신규 세션 ID와 기존 `-r`/`-c`/`--session` 복구 ID를 혼동하지 않고 저장된 역할 메타데이터를 보존 |
| 정확한 Fork | `SessionManager.createBranchedSession`으로 선택한 Pi 활성 완료 분기 Fork; 원본 JSONL 불변, Compaction/ContextEdit 보존 |
| Support | 독립 Pi 세션 ID·역할 신원을 발급하고 명시적 Fork 연관 정보가 없음을 확인 |
| 역할 신원 | Pi 세션 ID·프로젝트 식별·Agent 역할이 일치할 때만 신뢰. 이름/cwd만으로 수신자를 추정하지 않음 |
| Ghostty | 요청을 입력한 Pi Terminal UUID를 기준으로 Native Split. 포커스·중단·오류 상태를 추측하지 않음 |
| Git Worktree | 명령 입력 Agent의 Git HEAD에서 새 브랜치·Worktree; 미커밋 변경 복사, Merge/삭제 없음 |
| 근거 | 공유 항목·출처 Entry ID·조건/WHY·의미·검증 상태를 함께 유지; 단순 문자열 검사는 충분하지 않음 |
| Handoff 발신 | Pi `input`/`agent_settled` 경계에서 `<`를 사용자 요청으로 처리하고 모델 Steering·Follow-up 및 중복 요청과 격리 |
| Handoff 수신 | 로컬 영속 패키지와 Extension Channel 알림을 분리해 수신 Main의 모델 턴·활성 분기 변경 여부를 관찰 |
| Main 최신성 | 검토 시점의 Pi projection을 기준으로 비교하고, 분기·결정 변경 뒤 오래된 비교 결과의 재사용을 차단 |

## 2. 미병합 구현의 검증 범위

PR #25의 Handoff 코드에는 원문 근거·전달 패키지, 비컨텍스트 저장과 수신 비교 구현이 포함되어 있습니다. **해당 브랜치의 실제 Head와 테스트 결과를 확인**해야 하며, 과거 `ask_user`·`/compose inbox` UI를 최신 기본 동작이라고 가정하지 않습니다. 개별 기능·파일의 진행 상황은 제품·기술 정본에 복제하지 않습니다.

## 3. 기술적 실패 조건

- **원본 무결성:** Fork 분기·원문 Entry 존재·현재 세션 신원이 일치하지 않으면 완료된 작업으로 간주하지 않습니다.
- **턴·UI 경합:** 실행 중 `<` 요청, 취소, 분기 전환, 새 Work 응답, 오래된 후보 재사용은 별도 회귀 검증이 필요합니다.
- **전송·수신:** 실제 저장 성공과 알림 발행, Main 모델 처리, 적용 완료는 각각 다른 영수증으로 판단합니다. 승인 본문과 검사 본문이 달라지지 않도록 합니다.
- **근거 의미:** 부정문 반전, 허위 승인 귀속, 미실행 테스트의 성공 오인은 인용문 존재 검사만으로 막을 수 없습니다.

## 4. 관련 원본 및 연구

PR #25에서 검토한 버전은 **Pi 1.4.0, Ghostty 1.3.1, pi-intercom 0.18.1, pi-ask-user 0.17.2**입니다. 이는 과거 구현의 참조 환경이며 최신 설치 또는 E2E 검증 완료를 뜻하지 않습니다.

- [QMSum](https://aclanthology.org/2021.naacl-main.472/) — 긴 기록에서 관련 근거를 찾는 접근
- [FActScore](https://aclanthology.org/2023.emnlp-main.741/) — 사실 단위 근거 대조
- [SummEdits](https://aclanthology.org/2023.emnlp-main.600/) — 미묘한 의미 왜곡의 평가
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) — 긴 맥락 내 정보 활용 한계

이 자료는 근거 검색·의미 검토의 설계 참고 자료이며 Pi Compose의 정확도·모델 비용·최신 UX의 성공을 증명하지 않습니다. 실제 사용자 실험의 오류 사례와 비교해야 합니다.

## 5. 실제 환경에서 검증할 기술 항목

1. Main 새 세션/복구·역할 식별과 Ghostty 기준 Split·포커스
2. 정확한 Pi 완료 지점 Fork, 원본 불변, Shared/Worktree 모두 동작
3. Work 실행 중/종료 후 `<` 요청·취소·본문 확인·중복 전송 방지
4. Main 알림만 표시·컨텍스트 무주입·명시적 선택 반영·과거 보고/최신 정책 충돌 검출
5. Main 종료·재개, 부재 수신, 중복 알림, 오류/검토 실패 때 회복
6. Handoff 의미 품질(이전 논문·실험 사례)과 모델 비용·불필요한 조작

[검증 감사 기록](HANDOFF_IMPLEMENTATION_AUDIT.md)에는 PR #25의 코드·CI 관찰 범위가 포함됩니다. 이를 새 UX의 E2E 성공으로 확대하지 않습니다.
