# Pi Compose × Orca — 사용자 합의 기반 제품 설계 결정

> 상태: **제품 방향 확정 / 구현 전 검증 필요** · 2026-10-28
> 적용 범위: Pi Compose의 Orca 통합 설계. 기존 구현을 완료했다고 주장하지 않는다.
> 우선순위: **고품질 Main 컨텍스트와 Pi Extension 유연성 > Orca 기존 기능 보존 > 편의 기능 신규 개발**
> 근거 조사: [Orca 제품 적합성·Pi Extension 조사](./ORCA_PRODUCT_FIT_AND_PI_EXTENSION_AUDIT.md). 조사 문서의 이전 권장안보다 **이 문서의 사용자 합의가 우선**한다.

## 1. 목적

Main은 사용자와 요구사항, 설계 이유, 금지 조건, 제외한 대안을 깊게 논의한 **원본 Pi 대화**이다. Work는 선택한 Main의 실제 Pi 대화 지점을 정확히 복제한 **독립 Pi 세션**이며, Main에 개발 로그를 자동 축적하지 않는다. Support는 탐색·자료 조사·테스트 실행과 같은 **컨텍스트 독립 작업**을 수행한다.

Orca의 Worktree, Native Chat, Agent Dashboard, Session History, Git Diff/리뷰, 탭/분할, 메시지 및 초안 기능은 최대한 보존·재사용한다. Ghostty·화면 레이아웃 등 UI 선택을 Pi Compose의 핵심 가치로 취급하지 않는다.

## 2. 확정된 사용자 흐름

| 설계 영역 | 확정 정책 |
| --- | --- |
| 기본 대화 화면 | **Orca Native Chat**. Pi TUI는 필요한 Extension 호환성과 사용 선택을 위해 유지한다. |
| Main 소속 | **Orca Worktree에 소속**. 하나의 Worktree에 Main이 여러 개 있을 수 있다. |
| Main 보존 | Main의 실제 Pi 세션 기록은 Worktree 삭제와 함께 삭제하지 않는다. |
| Work 생성 진입점 | **Worktree에서 생성(B)을 기본**으로, **Main 대화에서 생성(A)도 지원**한다. 두 진입점은 동일한 생성 동작을 호출한다. |
| Work 원본 선택 | Worktree 진입점에서는 Main을 명시적으로 선택. Main 진입점에서는 해당 Main을 미리 선택. |
| Work 작업 공간 | **현재 Worktree 또는 별도 Worktree를 매번 선택**. 컨텍스트 원본과 Git 작업 공간은 독립적으로 결정한다. 기본 선택값은 아직 미정. |
| Work Fork 시점 | Main의 **최신 완료 대화 지점**. Main 응답 중에는 진행 중인 응답을 제외하고 마지막 완료 지점에서 **즉시 Fork**. 제외 사실과 원본 세션/leaf를 명시한다. |
| Work 생성 직후 | Pi 세션 준비 및 Fork 검증 후 **작업 지시 없이 대기**. 개발은 사용자가 Native Chat에 직접 메시지를 보낼 때 시작한다. |
| Work 변경 권한 | 버그 수정·설계 범위 내 구현·코드 품질 개선은 Work에서 수행. Main에서 정한 요구사항·중요 제약·설계의 변경은 **Main에서 다시 논의**한다. |
| 개발 결과 확인 | 사용자가 Orca 기존 Git Diff/코드 탐색/리뷰로 직접 확인하고 Work에 반복적으로 개선을 지시한다. Work의 한 번의 응답 종료를 개발 완료로 간주하지 않는다. |
| Support 컨텍스트 | **새 독립 Pi 세션**. Main/Work 대화를 자동 Fork하지 않는다. |
| Support 작업 공간 | Work와 마찬가지로 **현재 Worktree 또는 별도 Worktree를 선택**할 수 있다. |
| Support 사용 예 | Work에서 테스트 코드 작성, Support에서 테스트 실행, Work는 동시에 개발 계속 진행. |
| 별도 Diff 검증 | Work가 응답을 완료할 때마다 자동 검증하지 않는다. 사용자 중심 코드 리뷰가 기본. 필요한 경우 Support를 활용한다. |
| Support 결과 전달 | 결과는 기본적으로 **Support/Orca에서 확인**. 사용자가 **Work에 보내기**를 누르면 대상 Work **Native Chat 입력창의 미전송 초안**으로 넣는다. 사용자가 최종 전송한다. |
| Main 반영 | Support 결과, 코드 변경, 테스트 로그 및 Work 메시지를 Main 모델 대화에 자동 입력하지 않는다. |

## 3. Work Fork의 불변식

1. 사용자가 고른 Main은 Orca UI상의 부모 Worktree가 아니라 **실제 Pi 세션 파일/ID**로 식별한다.
2. Fork할 시점을 활성 Pi 대화 분기의 **완료된 leaf**로 확정하고 원본 세션 파일·leaf ID를 보존한다.
3. Main이 응답 중이면 현재 미완성 실행을 포함하지 않는다. 사용자에게 제외된 부분을 알린다.
4. **동일 cwd여도 Resume가 아닌 별도 새 세션 Fork**를 강제한다. Orca 기본 `rpc-launch-resolution.ts`가 동일 cwd에서 Resume하는 현 동작을 그대로 쓰면 안 된다.
5. 새 세션 파일/ID가 원본과 다르고, 선택한 활성 분기까지 계승했는지 검증한다. 실패한 경우 'Fork 완료'라고 표시하지 않는다.
6. Pi 대화 복제는 파일 시스템·미커밋 코드·설정·Pi Extension 구성을 복제하는 것과 다르다. 다른 cwd에서는 시스템 프롬프트·AGENTS.md 등 실제 모델 입력이 달라질 가능성을 별도로 안내·검증한다.

## 4. Support → Work 결과 전달: 확정 사용자 경험

### 4.1 흐름

1. Support의 테스트 작업이 끝나면 사용자가 해당 세션 결과를 열어 확인한다.
2. 사용자 액션 **`Work에 보내기`**를 선택한다.
3. Support가 특정 Work와 연결돼 있으면 그 Work를 기본 대상으로 사용한다. 복수 대상 또는 원본이 불명확하면 사용자가 명시적으로 선택한다.
4. Orca의 **해당 Work Native Chat**을 열고, 결과를 **입력창 초안**으로 준비한다.
5. 내용은 사용자가 자유롭게 수정·삭제·보완할 수 있다. **전송은 사용자가 직접 수행**한다.
6. 전송되지 않은 초안은 Pi 모델 컨텍스트에 새 메시지를 만들지 않는다. 그 자체로 Work 실행을 시작시키지 않는다.
7. Main에는 어떤 결과도 자동으로 전달하지 않는다.

### 4.2 초안 내용

- 실행한 작업과 짧은 결과 요약(성공/실패/실행 불가 구분)
- 실패한 테스트와 오류 원인에 대한 실제 관찰 내용
- 상세 로그나 증거로 이동할 수 있는 원본 Support 세션 식별 정보
- 코드 기준이 확실할 때만 Worktree/브랜치/커밋 또는 검사 시점 메타데이터
- 어떤 조치를 취할지는 사용자가 초안에 작성하거나 수정하도록 둔다. 검증되지 않은 원인을 사실처럼 만들어 넣지 않는다.

### 4.3 조작·오류 정책

- Work의 기존 입력 초안은 절대로 조용히 덮어쓰지 않는다. 같은 입력창에 덧붙일 때도 사용자가 변경 내용을 확인할 수 있어야 한다.
- Work가 다른 Worktree에 있더라도 **실제 Orca 세션 ID**로 대상을 식별한다. Worktree/화면의 현재 포커스만 보고 추정하지 않는다.
- 대상 세션이 닫혔거나 없는 경우 메시지를 전송하거나 새 Work를 몰래 생성하지 않는다. 이유를 알리고 결과를 Support에 남긴다.
- 초안 저장 실패/불확실성은 성공으로 표시하지 않는다. 복사 등 사용자의 복구 동작을 제공한다.
- 기존 Orca Native Chat의 입력 내용, 이미지 첨부, 편집 중 상태를 보존한다.
- 사용자가 전송하기 전까지 Support 결과는 **Work 대화 기록에 남지 않는다**.

### 4.4 Orca 코드 재사용 지점(기존 upstream main 조사)

| 목적 | 확인한 Orca 코드 | 사용 원칙 |
| --- | --- | --- |
| 세션별 초안 식별/영속화 | `src/renderer/src/components/native-chat/native-chat-composer-draft-store.ts`의 `structuredAgentSessionDraftScopeKey`, `appendToNativeChatComposerDraft` | 초안은 세션 단위로 다루고 기존 작성 중인 텍스트를 보존 |
| 초안 지속성 | `native-chat-composer-draft-persistence.ts`, `native-chat-composer-draft-storage.ts` | 새 초안 DB를 만들지 않음 |
| Agent 선택 | `src/renderer/src/lib/notes-send-agent-targets.ts`, `running-agent-targets.ts` | 기존 Agent 대상 표시/활성 상태 확인 방식을 재사용하되 cross-worktree 대상 확장 필요 |
| Native Chat으로 **즉시 전송** | `src/renderer/src/lib/agent-message-send.ts` | 이번 UX에 **그대로 호출하지 않음**. 이 함수는 즉시 모델 메시지 제출 경로 |
| Orca session 주소 | `src/main/runtime/orchestration/structured-session-mail-address.ts` | 직접 전송/메일은 별도 기능. 이번 초안 채우기와 혼동하지 않음 |

**현재 확인한 것은 가능한 재사용 지점이다.** Support 결과의 버튼과 다른 Worktree의 대화 초안으로 이동하는 연결은 추가 구현이 필요하다. 기존 Orca가 그 기능을 이미 제공한다고 말하지 않는다.

## 5. 역할 관계와 Git 작업 공간을 혼동하지 않기

```text
Orca Project
└─ Worktree A
   ├─ Main 1 (Pi session)
   ├─ Main 2 (Pi session)
   ├─ Work 1 ──forked from Main 1──▶ [현재 A 또는 별도 B Worktree]
   └─ Support 1 ──independent──▶ [현재 A 또는 별도 C Worktree]
```

Support가 Work의 테스트 결과를 전달한다고 Main이나 Work의 Pi 대화를 상속하지 않는다. 코드 변경 기준도 단순히 '같은 Main'이 아니라 실제 Git 작업 위치·브랜치·스냅샷에 따른다.

- 같은 Worktree에서 Support 테스트 중 Work가 파일을 수정하면 테스트 결과의 코드 기준이 혼재할 수 있다.
- 별도 Worktree에는 미커밋 변경이 자동으로 전달되지 않는다. 이를 위한 명시적 복제 기능과 비용은 추후 설계 사항이다.
- Support의 테스트 실행은 기본적으로 외부 수정이 없는 작업이어야 하며, 실제 테스트 스크립트의 파일 생성/수정 가능성은 검토해야 한다.

## 6. Orca 통합 시 구현 우선순위와 제약

1. **기초 연결**: Orca Worktree/기존 Pi 세션을 Main으로 지정·여러 개 탐색·보존.
2. **정확한 Work Fork**: 활성 완료 leaf + 동일/상이한 cwd에서 원본 오염 없이 새 Pi 세션 생성, provenance 저장, 실패 복구.
3. **Native Chat 준비 상태**: Fork 후 빈 Work 대화 열기(초기 prompt 자동 제출 금지). Pi TUI 선택/우회 경로 유지.
4. **독립 Support 생성**: 현재/별도 Worktree 선택. Orca 기존 세션/Agent 상태/실행 경로 재사용.
5. **결과 → 입력창 초안**: Support 결과에서 대상 Work를 해석하고 기존 Orca 초안 저장/복원 경로로 추가, 대상 Work 열기. 절대 `sendMessageToAgent`를 직접 호출해 자동 전송하지 않는다.
6. **Orca 기본 리뷰 흐름**: 자체 Diff 대시보드/검토 자동화를 새로 만들지 않는다.

## 7. 아직 확정하지 않은 항목

- Work와 Support의 작업 공간 선택 화면에서 **초기 기본 선택값**.
- Main/Work 종료 및 Worktree 삭제 시 UI 연결 관계와 기존 Pi 세션 보존의 세부 생명주기.
- Support 별도 Worktree에서 **미커밋 코드**를 검사할 스냅샷/복제 방식.
- 한 Work에 기존 초안이 있을 때 자동 덧붙이기 외에 미리보기/병합 방식의 구체 UI.
- 같은 Work와 Support가 서로 다른 머신에 있을 때 Native Chat 초안 이동 지원 범위.
- Extension 중 RPC에서 UI가 지원되지 않는 항목의 구체 호환 매트릭스 및 TUI 전환 안내.

## 8. 구현 범위에 포함하지 않는 것

- 자동 개발 시작, 자동 전송, 자동 Diff 검증, 자동 Git Merge/Cherry-pick
- Orca 기존 Git Diff/Agent Dashboard/Session History 복제
- 모든 Work를 Orca Orchestration Worker로 강제하기
- Main 전체 대화의 임의 요약 또는 Support로의 자동 복제
- CI·테스트 코드 추가 (별도 요청 없이 수행하지 않음)

## 관련 근거

- Orca 제품 적합성 조사: [ORCA_PRODUCT_FIT_AND_PI_EXTENSION_AUDIT.md](./ORCA_PRODUCT_FIT_AND_PI_EXTENSION_AUDIT.md)
- Orca Native Chat draft: https://github.com/stablyai/orca/blob/main/src/renderer/src/components/native-chat/native-chat-composer-draft-store.ts
- Orca Native Chat send: https://github.com/stablyai/orca/blob/main/src/renderer/src/lib/agent-message-send.ts
- Orca Session orchestration: https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/orchestration.mdx
- Pi RPC sessions: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md
