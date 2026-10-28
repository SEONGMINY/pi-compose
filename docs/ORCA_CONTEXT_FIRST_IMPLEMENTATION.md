# Pi Compose × Orca — Context-first integration (WIP)

> 브랜치: `feat/orca-context-first-work-support-20261028`
>
> 상태: **부분 구현, macOS Orca GUI 실행/타입 검사/실사용 검증 전**.
> 이전 `feat/orca-predictable-workflows`와 `research/orca-pi-product-fit-20261028`를 변경하지 않음.
> 사용자 승인 없는 CI·테스트 코드 추가 및 자동 머지 없음.

## 2026-10-28 실사용 피드백 후 변경 (컨텍스트 중심 사이드바)

- **정보 구조:** 별도 `Pi Compose` 사이드바 패널을 제거하고 Orca 기본 프로젝트의 **메인 Worktree 카드 내부**에 `Main → Work → Support` 트리를 표시한다. 별도 Git Worktree에서도 Work·Support의 논리적 소속은 Main 기준으로 유지한다.
- **진입점:** Main·Work 행에 특정 Agent 역할만 암시하는 버튼 대신 **`+ Agent`**를 표시한다. 기존 생성창에서 Main/Work/Support 선택 가능. 메뉴는 호출한 프로젝트의 cwd/Worktree ID를 유지한다.
- **입력:** Agent 이름을 한 줄 입력창으로 변경하고 타이핑하면 오래된 검증 오류를 지운다.
- **Work 연결 오류:** Pi Native Chat ID는 `pi_` 접두어와 밑줄을 포함하므로 기존 거부 정규식을 교정했다. 연결 실패는 `connection-error` 상태로 남기고 사용자 오류를 보존한다. 성공적으로 연결한 Work는 `ready`로 변경한다.
- **안전:** 원본 Pi Fork는 연결 실패와 관계없이 보존한다. Main 대화·Support 결과를 Work에 자동 전송하지 않는다. 중복 Orca Chat이 이미 생성된 경우의 완전한 자동 복구는 아직 미구현.
- **빌드 환경:** 이전 Orca overlay 파일을 덮어쓰지 않도록 새로운 `.cache/orca-upstream-native-unified` 체크아웃 사용. `npm run orca:prepare` / `npm run orca:dev`.

**현재 미검증:** macOS 실제 UI, Orca 프로젝트/Worktree 가상화 행의 크기 측정·클릭 이벤트, 이전에 실패한 세션 연결 복구, Orca Native Chat 실제 세션 복원. 새 CI/테스트 코드를 추가하지 않았다.

## 2026-10-28 16:20 사용자 검증 후 후속 변경

- **대화 화면 통일:** 새 Main, Work, Support 모두 Orca Native Chat으로 시작하도록 같은 Pi session adoption 경로를 사용한다. TUI는 Orca 기존 터미널/기존 세션으로 접근 가능하다.
- **빈 Main/Support 준비:** Pi SDK v1.4.0의 SessionManager가 빈 세션을 파일로 기록하지 않는 제약 때문에, 모델 메시지를 추가하지 않고 Pi v3 헤더만 생성해 Orca가 고정된 Pi ID를 채택할 수 있게 했다. 실제 Pi RPC 실행으로 검증하기 전까지 이 방식은 잠정 구현이다.
- **선택 하이라이트:** Orca의 활성 Worktree + 활성 탭 ID 기준으로 해당 Main/Work/Support 행에 선택 스타일과 `aria-current` 표시.
- **탭 재열기:** 저장된 Orca Native Chat ID를 `agentSession.reveal`로 우선 재발행. 호스트가 확정적으로 세션이 사라졌다고 답한 경우에만 **동일 Pi transcript**를 새 Orca 세션으로 채택한다. 응답 불명확/호스트 오류는 중복 실행하지 않고 중단. 새 Pi Fork는 생성하지 않는다.
- **기존 Main TUI의 이전:** 실행 중인 Pi TUI가 소유한 동일 세션을 Native Chat으로 동시에 여는 것은 Orca가 의도적으로 금지한다. 이 경우 사용자가 기존 TUI에서 대화를 끝내고 종료한 뒤 같은 Main을 Native Chat에서 열어야 한다. 기존 세션은 삭제하지 않는다.
- **Git Worktree 목록:** 사용자의 별도 노이즈 지적은 확인했다. Orca의 `그룹화 기준`은 정렬·그룹 변경이며, Git Worktree 보기/숨기기 설정이 아니다. 기존 Git Worktree UI의 숨김 정책은 **미결정**으로 두고 이번 변경에서 별도의 Orca 설정을 임의로 추가하지 않았다.

**재실행 주의:** 이전 `.cache/orca-upstream-context-tree` 체크아웃과 분리했고, 처음 적용한 Pi Compose 관리 파일의 SHA-256을 별도 manifest에 기록해 재적용 시 사용자 변경과 자동 생성 변경을 구분한다.

**검증 상태:** GitHub 소스 정적 대조 및 코드 커밋. macOS Orca 실제 실행, Native Chat 빈 Pi transcript 채택, 기존 Main/TUI 소유권 이전, Work tab reveal/재채택, UI 하이라이트 재현은 **미검증**. CI나 테스트 코드는 추가하지 않았다.

## 구현된 코드 경로

| 기능 | 변경 위치 | 현 상태 |
| --- | --- | --- |
| Main의 마지막 완료 응답을 기준으로 Fork | `src/orca/completed-main-fork.mjs`, `src/orca/agent-sessions.mjs` | 완료된 assistant 응답까지 활성 **단일 분기**를 스냅샷. Main JSONL 읽기 전용, 새 세션 파일·parentSession·복제 항목 비교 |
| Work 생성 후 직접 지시 | `src/orca/agent-sessions.mjs`, `PiComposeMenu.tsx` | Task 프롬프트를 자동 실행하지 않고 준비 상태에서 대기 |
| Work의 Orca Native Chat | `PiComposeNativeChat.ts`, `PiComposeMenu.tsx`, `PiComposeOutline.tsx` | 기존 Pi Fork의 provider session ID를 Orca `resumeFrom` 경로로 **adopt**. 새 메시지 자동 제출 없음 |
| Work와 Support 작업 공간 | `PiComposeMenu.tsx`, `scripts/orca-native-bridge.mjs` | 현재 폴더 또는 새 Worktree를 **매번 명시 선택** |
| Main → Work, Work → Support 생성 | `PiComposeOutline.tsx` | Main 행의 Work 만들기, Work 행의 Support 실행 진입점 |
| Support의 Work 연결 | `src/orca/agent-sessions.mjs`, bridge/preload | Support는 독립 Pi 세션이며 `relatedWorkId`는 결과 수신 관계만 뜻함 |
| Support 결과 → Work 초안 | `src/orca/agent-sessions.mjs`의 `supportResult`, `PiComposeOutline.tsx` | Support의 최신 완료 응답을 읽어 Orca의 Native Chat draft store에 **append** 후 Work 창 열기. **자동 전송 없음** |
| Orca 기존 파일 보호 | `scripts/orca-upstream.mjs` | 기존 기능 브랜치의 캐시와 충돌하지 않는 `.cache/orca-upstream-context-first`에서 고정 Orca checkout |

코드 검토 시 반드시 확인할 원본 Orca 경로:
- `src/renderer/src/components/native-chat/native-chat-composer-draft-store.ts`: `appendToNativeChatComposerDraft`, `structuredAgentSessionDraftScopeKey`
- `src/main/pi/rpc-launch-resolution.ts`: 이전 세션의 `cwd` 기준 Resume/Fork 선택
- `src/main/runtime/session-tabs/structured-session-create-support.ts`: Pi transcript adoption과 원본 세션 소유권 제약
- `src/renderer/src/lib/agent-session/structured-agent-session-provisional-tab.ts`: Native Chat 생성/재개
- `src/shared/agent-status-types.ts`: 실행/대기/턴 완료와 작업 완료의 차이

## 반드시 남겨야 하는 제약과 미완료 작업

1. **Main/Work/Support는 Native Chat 기본 실행 경로를 연결했다.** 기존 TUI 세션 전환 시 소유권 충돌이 없는지 확인해야 하며, macOS GUI 실사용 검증은 아직 완료되지 않았다.
2. **정확한 활성 leaf/agent_settled 동기화가 아직 필요하다.** 현재 스냅샷은 저장된 Pi assistant 메시지의 `stopReason === "stop"`를 완료 응답의 증거로 사용한다. 이는 Pi RPC `agent_settled`와 1:1 동일한 이벤트가 아니다. 소스 JSONL에 여러 대화 분기가 있으면 활성 leaf ID를 신뢰할 수 없으므로 **실패로 종료한다**. 조용히 다른 분기를 선택하지 않는다.
3. **Worktree 등록과 관리가 아직 완전한 Orca 통합이 아니다.** 이전 브랜치의 `git worktree add`를 재사용했으나 생성된 공간이 Orca 목록에 자동 등록되지 않으면 UI는 중단한다. 기존 Git 폴더/세션은 보존한다. Orca의 정식 Worktree 생성/등록 API로 대체가 필요하다.
4. **Work Native Chat의 실제 Pi transcript adoption, restart, 탭 복구, Pi Extension 호환성은 실기 미검증이다.** 계정 홈/세션 ID와 Orca 소유권 거부 경로를 앱에서 확인해야 한다.
5. **Support 결과는 단순히 최신 완료 assistant 응답 텍스트**이다. 독립 검증 모델이 자동으로 테스트 로그를 요약하거나 테스트 성공 여부를 판정하지 않는다. 원본 세션 정보도 같이 전달한다. 긴 응답은 12,000자로 자르며 일부만 포함했다고 표시한다.
6. **Support 작업 공간 동시성:** 같은 폴더에서 Work가 수정 중이면 Support 테스트 기준이 변할 수 있다. 새 Worktree 선택은 미커밋 변경을 자동 복제하지 않는다.
7. **Support/Work 결과 UX는 초기 연결이다.** Work가 이미 초안을 작성 중일 때 덧붙이고 기존 내용은 보존하지만, 결과 미리보기·병합 확인·전송 대상 선택 UI는 더 개선할 여지가 있다.
8. **원본 보호:** Main의 Pi 파일, 기존 브랜치, Worktree를 자동 수정·삭제·병합하지 않는 규칙을 유지한다. Git 변경을 복제하는 기능은 없다.
9. **Pi TUI 호환성 경계:** 사용자 Pi Extension에 RPC에서 지원되지 않는 TUI 전용 UI가 있을 수 있다. Native Chat 기본값을 강제하여 Extension을 무력화해서는 안 되며, TUI 접근 경로를 보존한다.

## 남은 구현 순서

1. 고정 Orca 소스를 실제 macOS에서 준비하고 변경된 overlay의 빌드/타입 오류 확인. 실패 시 검증 없이 완료 선언하지 않음.
2. Orca의 Pi 세션 소유권/활성 leaf/턴 종료 신호를 수집할 최소한의 Host 연동. Work의 명확한 완료 지점 Fork와 동일 cwd에서 원본 Resume 방지 확인.
3. 새 Main·Support의 Native Chat 기본 생성 및 기존 Pi 세션 출처 연결.
4. Orca의 기존 Worktree 생성·등록·재사용 흐름으로 이관. 별도 Git 관리 로직과 자체 workspace 트리 제거 검토.
5. Support 결과 초안 전달의 실제 UI 확인, 다른 Worktree, 기존 초안 보존/재시도/실패 복구 확인.
6. 앱 실사용 재검증 후 기존 TUI 및 Extension 기능을 유지한 채 제품 수준 마무리.

## 실행 환경

- Orca 기준: `stablyai/orca@4a39d186da72a496b29a9ec5c523bbbf0a3460d8`
- Pi 기준: `@earendil-works/pi-coding-agent@1.4.0`
- 브랜치를 별도 체크아웃하고 macOS Node 24 + pnpm + Pi 인증 환경에서 `npm run orca:prepare`, `npm run orca:dev` 사용.
- 본 변경은 컨테이너에서 Orca GUI 및 Pi 모델 로그인을 실제 실행하지 않았다. 실행·검증 성공을 주장하지 않는다.

[승인된 정책](./research/ORCA_PI_COMPOSE_PRODUCT_DECISIONS_20261028.md)
