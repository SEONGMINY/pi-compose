# Implementation Plan — 남은 작업과 완료 기준

> 기준: [PRD](PRD.md) · 2026-11-10 최신 단순 Handoff 결정
>
> 이 문서는 **아직 해야 할 일**만 관리합니다. 과거 구현 내역·검증 로그는 [Handoff Audit](HANDOFF_IMPLEMENTATION_AUDIT.md) 및 [Validation](validation/)에 남깁니다.

## 1. 우선순위

| 순서 | 작업 | 완료 조건 |
| --- | --- | --- |
| 1 | 문서 정본 정리 | Vision·Problems·PRD·Architecture·TRD·Usage의 책임이 중복되지 않고, 오래된 ADR/검증 자료의 상태가 분명함 |
| 2 | 최신 Handoff UX의 기존 코드 대응표 | PR #25에서 그대로 재사용할 부분과 `<` 발신 / Main 알림·명시적 반영에 맞춰 바꿀 부분이 근거로 확인됨 |
| 3 | Work 전달 흐름 단순화 (Draft 코드 작성) | `<`→컨텍스트 단위/근거 확인→정확한 본문 승인, 취소·중복·실행 중 요청의 macOS 검증 |
| 4 | Main 수신 UX 단순화 (Draft 코드 작성) | 비컨텍스트 알림, Main `<` 검토·보류·요청된 신규 보고만 반영, receipt/재개 통합 검증 |
| 5 | 의미·상태 안전성 검증 | 승인·부정문·WHY·테스트 실행 여부·Main 최신 정책 충돌을 원문 사례에서 확인 |
| 6 | macOS 통합 검증 | Ghostty/Pi/Extension 로드, 전송→수신→선택 반영 및 재시작·오류·중복 시나리오를 실제 환경에서 검증 |

## 2. 반드시 유지할 경계

- Main 원본 Pi 세션은 Work Fork 때문에 변경되지 않습니다.
- Work는 Fork 당시 맥락과 자신의 작업 이력만 보고, Main의 Fork 이후 대화를 몰래 읽지 않습니다.
- 발신 승인 전 자동 전송이나 Main 수신 시 모델 턴·컨텍스트 자동 주입을 하지 않습니다.
- `/compose inbox`를 새 목표의 필수 사용자 경로로 두지 않습니다.
- 별도 Sidebar·Overview·Overlay·서버·GUI를 도입하거나 오래된 코드를 원래 방식으로 복구하지 않습니다.
- 새로운 자체 기능을 만들기 전에 Pi·pi-intercom·pi-ask-user·Ghostty 원본 기능의 재사용 가능성을 확인합니다.

## 3. 구현 현황과 검증의 구분

PR #25는 Handoff 패키지·출처·의미 검사·로컬 저장·수신 비교 코드와 테스트를 작성한 Draft입니다. [Audit](HANDOFF_IMPLEMENTATION_AUDIT.md)은 Ubuntu GitHub Actions의 `npm run check` 통과를 기록하지만, 이 사실이 최신 단순 UX 또는 macOS 실사용 E2E를 증명하지는 않습니다.

**현재 Draft PR #25에서는 사용자가 후속 승인한 Context Review 설계를 코드로 반영했습니다.** `extensions/context-review.ts`, `context-receive.ts`, `src/handoff/context-review.ts` 및 단위 테스트를 추가했습니다. 실제 `npm run check` 결과와 Ghostty 통합 검증은 별도로 기록하며, 검증 전 병합하지 않습니다.
