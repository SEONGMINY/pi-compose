# Implementation Plan — Pi Compose Main-first 실행과 Handoff

- 기준: [PRD](PRD.md), [Architecture](ARCHITECTURE.md), [TRD](TRD.md)
- 최신 방향: **bare `pic` 새 Main / Sidebar 없음 / Native Ghostty Split / Work 완료 시 공유 후보 자동 준비(A안) / 나중에 ask_user 검토 및 수동 전송**
- 상태: 코드 반영 중, macOS Ghostty/Pi 실사용 검증 전

## 1. 작업 원칙

1. Pi 1.4.0, Ghostty 1.3.1, pi-intercom 0.18.1의 원본 API·코드를 먼저 사용합니다.
2. Fork는 실제 Pi 대화 트리 기반이며 Main 원본 JSONL을 변경하지 않습니다.
3. Main에 긴 개발 기록이나 Work 결과를 자동 주입하지 않습니다. Handoff는 사용자 명시 승인 후 전송합니다.
4. 모델 응답 종료, 기능 구현, 테스트 실행, 검증 완료, Main 수신/정책 채택을 서로 구분합니다.
5. 모호한 제품 정책이나 비용 증가가 있으면 근거를 제시하고 사용자와 다시 논의합니다.
6. Orca, tmux, workmux, Herdr App/core, 추가 서버/DB/GUI는 도입하지 않습니다.

## 2. 반영한 코드 (작업 브랜치)

브랜치: `feat/pic-direct-main-handoff-20261109`. 변경 사항은 아직 `main`에 병합되지 않았습니다.

| 단계 | 변경 | 파일 | 검증 상태 |
|---|---|---|---|
| 1 | `pic`의 Overview 진입 제거, 신규 Main 부트스트랩·Pi 세션 ID | `bin/pic.mjs` | 코드 작성 |
| 2 | 호출자 Ghostty Terminal 기준 Split 생성 경로 | `src/native-agent-launch.ts` | 코드 작성 |
| 3 | `>w`/`>s`의 Sidebar 환경 변수 의존 제거 | `extensions/direct-delegation.ts` | 코드 작성 |
| 4 | 실행 중 `<`를 모델 입력에서 분리하고 대기, `agent_settled` 뒤 사용자 검토 | `extensions/direct-handoff.ts` | 코드 작성 |
| 5 | 실행 중 요청·기다림·중단에 대한 회귀 테스트 추가 | `test/direct-handoff-queue.test.ts` | 테스트 코드 작성, 실행 미확인 |
| 6 | Work 완료 보고 판단 + 공유 후보 자동 준비·비컨텍스트 영속 저장 | `extensions/handoff-candidates.ts` | 코드 작성, 모델 의미 정확성 미검증 |
| 7 | 자동 ask_user 질문 + 선택 응답/검토 초안 저장 + 도구 제한 | `extensions/handoff-ready.ts` | 코드 작성, Pi 모델 턴 연계 실사용 미검증 |
| 8 | 선택된 후보 ID의 근거 기반 패키지·품질 검사·최종 본문 미리보기 승인 | `extensions/handoff-package.ts`, `src/handoff/package.ts`, `src/handoff/quality.ts` | 코드 작성, 새 P1–P5 E2E 미검증 |
| 9 | 후보 생성·출처 검증·취소·저장/복구 테스트 | `test/handoff-candidates.test.ts`, `test/handoff-ready.test.ts` | 테스트 코드 작성, 실행 미확인 |
| 10 | 제품 정책·사용 설명을 보호형 Handoff와 일치하게 갱신 | `README.md`, `docs/*` | 문서 작성, 검증 전 |

## 3. 남은 기술 검증 (사용자 Mac)

- **CLI:** bare `pic`에서 별도 관리 화면 없이 Pi Main이 현재 Terminal에서 뜨는지, 첫 대화와 저장 세션 ID·Compose role 메타데이터가 일치하는지.
- **Resume:** `pic -r`와 `pic -c`가 Pi 기본 동작을 보존하고 Work/Support 신원을 Main으로 덮어쓰지 않는지.
- **Ghostty:** 정확히 현재 Pi Surface를 anchor로 삼아 Split하는지, 새 Pi 시작/초기 지시 처리, 포커스 복귀, AppleScript 권한 부족·실패 동작.
- **Fork:** 메인 JSONL 불변, Compaction/ContextEdit 의미 보존, 마지막 완료 분기 선택, `>>w` Worktree와 원본 Git HEAD 보존.
- **Busy Handoff:** Work 실행 중 `<`가 일반 모델 메시지나 follow-up으로 들어가지 않는지, 최초 Turn 완료가 아닌 `agent_settled`에 연결되는지, 중단/오류/중복 요청 및 새 턴 시작에서 오염이 없는지.
- **Handoff 전달:** 사용자 승인 전 무전송, 정확한 수신 Main ID의 로컬 보관, 파일 저장 후 종료·재개, Extension Channel 연결 유무, Main 수신 무주입, 검토 시 활성 분기 최신성, 상태 중복 방지.
- **품질:** 과거 실험의 부정문·금지·승인 주체·미실행/미확인·테스트 결과 오인 사례로 의미 검증.

실행 검증이 없는 상태에서 `test passed`, `Ghostty confirmed`, `production-ready` 같은 표현을 쓰지 않습니다. 자동 병합·전역 재설치·Pi 세션 삭제·Git Worktree 정리는 하지 않습니다.

## 4. 원본 재사용 중심으로 검증할 기능

### Handoff 생성·검토

[pi-intercom 0.18.1 `handover.ts`](https://github.com/nicobailon/pi-intercom/blob/v0.18.1/handover.ts)에는 세션 요약 모델 호출과 오류 처리가 있습니다. `index.ts`에는 로딩/취소→기본 에디터 수정→전송 경로가 있습니다. 이를 현재 Compose Handoff의 근거·승인 계약과 대조하고 직접 재사용 범위를 검증합니다.

단, upstream은 수신 Agent가 다음 작업을 **이어받는** Handover이므로, Compose의 'Main이 결과만 검토하고 사용자 승인 없이 정책·작업을 바꾸지 않음'이라는 의미를 덮어쓰지 않습니다.

### Agent 기반 수정

[pi-ask-user](https://github.com/edlsh/pi-ask-user)의 `ask_user`는 `model-only`입니다. 모델 호출과 달리 Work Agent의 일반 Pi 턴을 `triggerTurn`으로 시작하고, 그 턴의 도구를 `ask_user`로 한정하여 원본 질문 UI를 사용하도록 코드 작성했습니다. **실제 Pi의 완료 이벤트 안에서 이 모델 턴이 안전하게 시작되는지**, 사용자 응답을 받은 초안 저장과 도구 복원이 올바른지 검증해야 합니다. 사용자 답변 없이 Main 전송이나 추가 개발을 시작하지 않습니다.

### 평가

기존 4차례 Pi Handoff 실험 및 정상 busy-turn intercom 전달 검증 자료를 재사용합니다. 문장 원문 일치뿐 아니라 의미·승인·검증 상태를 평가합니다. 새로운 실험이 필요하면 **기존 자료로 검증되지 않는 경계만** 실행합니다.

## 5. 완료 조건

- **코드 완료:** 필수 실행 경로에서 Overview 환경 변수가 필요하지 않고, `pic`은 Pi Main 직접 실행, 직접 위임은 Ghostty Native Split, Handoff 요청은 모델 입력에 들어가지 않음.
- **타입·테스트 완료:** 프로젝트 `npm run check`가 실제 실행돼 통과한 결과가 있음.
- **실행 검증 완료:** 사용자 macOS Ghostty/Pi에서 위 시나리오가 실제로 재현됨.
- **요구사항 충족:** Handoff 품질, 사용자 검토/전송 승인, 컨텍스트 보호를 실제 결과로 확인. 대화형 Agent 수정은 현재 별도 검증 대상이며 구현 완료로 표시하지 않음.

Legacy Overview·Summary Overlay와 오래된 계획은 Git 이력에 남기고 현행 로드맵과 혼동하지 않습니다.
