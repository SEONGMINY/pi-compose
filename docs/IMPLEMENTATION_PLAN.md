# Implementation Plan — 남은 검증과 개선

> 제품 계약: [PRD](PRD.md) · 기술 경계: [TRD](TRD.md) · 검증 추적: [policy-sync-20261111.json](validation/policy-sync-20261111.json)

Main-first 및 Handoff(PR #25), 정책 자동 전파·`><`(PR #37)의 코드 통합은 완료됐습니다. **코드 병합이 실제 macOS/Ghostty 검증 완료를 뜻하지 않습니다.**

| 우선순위 | 검증·개선 | 완료 조건 |
| --- | --- | --- |
| P0 | 최신 `npm run check`와 실제 Pi/Ghostty E2E | Main→Work→정책 변경→`><`→`<`→Main 수신→`>r` 확인 |
| P0 | 승인·출처 정확도 | 모호한 선택·오래된 B안·예외·부정문·ContextEdit·Compaction 회귀 |
| P1 | 정책 적용 상태 | 전달·검토·실제 코드 적용·테스트 완료를 명확히 분리 |
| P1 | Handoff 품질·복구 | 중복 Claim/WHY, Main 오프라인, 중복·분기 변경 검증 |
| P1 | 다중 Main 및 Worktree 안전성 | 올바른 원본 계보, CWD 유지, 정책 철회·충돌 처리 |
| P2 | 모델·토큰 비용 | 변경 없을 때 추가 호출 없음, 필요 없는 확인·지연 감소 |

별도 개발·유지보수 하네스는 `tools/development-harness/`에 있으며 제품 런타임과 분리합니다. 이전 CI 기록은 당시 코드의 검증 근거이며 최신 변경의 성공으로 간주하지 않습니다.
