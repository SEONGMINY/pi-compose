# Architecture — Pi Compose

- 정책 원본: [PRD](PRD.md) (최신 합의 2026-11-09)
- 실제 사용: [Usage](USAGE.md)
- 상태: **직접 실행과 요청 대기 구현 코드 작성, macOS 실사용 검증 전**

과거 Ghostty Overview/Sidebar/Summary Overlay의 기술적 시도는 Git 이력에 보존합니다. **현행 아키텍처는 Pi TUI를 직접 사용하며 별도의 관리 화면을 만들지 않습니다.**

## 1. 책임 분리

| 구성 요소 | 책임 | 재구현하지 않는 부분 |
|---|---|---|
| Pi 1.4.0 | 모델, 대화 트리, 저장 세션, Resume, ContextEdit/Compaction, Extension/TUI | Pi 세션/모델 런타임 |
| Ghostty macOS Native Split | 실제 Agent별 Terminal/Tab과 포커스, 화면 배치 | 터미널 멀티플렉서 |
| Git | 공유 디렉터리, Git Worktree, 브랜치·병합 | Git/Worktree 관리 엔진 |
| pi-intercom 0.18.1 | 세션 메시지 전달, 연결 상태 및 Outbox 계약 | 자체 Agent 메시지 브로커 |
| Pi Compose | 정확한 역할 신원, Fork/Support 생성, 사용자 요청 Handoff 근거·승인 | 별도 서버, DB, Sidebar |

## 2. Main 새 세션 시작과 복구

```text
pic (bare)
  ├─ canonical cwd 확인
  ├─ cwd에서 stable product ID 계산
  ├─ 새 Pi session UUID 및 main bootstrap 생성
  └─ 현재 터미널에서 pi --extension compose.ts --session-id <new UUID>
       └─ session_start: compose_agent_identity 기록
```

- 새 Main에 자동 지시를 보내지 않습니다.
- bootstrap은 현재 프로세스의 환경에만 전달합니다. `-r`, `-c`, `--session`은 새 Main 메타데이터를 주입하지 않고 Pi 저장 세션의 신원을 사용합니다.
- 첫 대화 전에 원본 Pi가 아직 세션 파일을 작성하지 않았을 수 있습니다. 이 상태를 이미 저장된 Main이라고 간주하면 안 됩니다.
- 복구 중 기존 Main/Work/Support의 역할을 변환하지 않습니다. 동시에 두 프로세스에서 같은 세션을 안전하게 재개한다는 별도 보장은 하지 않습니다.

관련 코드: `bin/pic.mjs`, `src/agent-bootstrap.ts`, `extensions/agent-identity.ts`.

## 3. 직접 위임과 Native Split

```text
Main / Work / Support의 Pi 입력창
  │
  └── 입력 이벤트: >w, >s, >>w, >>s
       ├── 정확한 현재 Compose 신원·활성 분기 확인
       ├── 현재 Ghostty Terminal UUID 확인
       ├── Work → 선택한 Pi 세션의 활성 완료 분기 createBranchedSession
       ├── Support → 독립 Pi Session UUID
       ├── >> 선택 시 → 현재 Workspace의 HEAD에서 새 Worktree
       └── 현재 Ghostty Terminal을 anchor로 Native Split
            └── private launch ticket → 새 Pi 프로세스, 정확한 신원
```

- `>w @세션`은 프로젝트가 일치하고 정확한 ID가 있는 저장 세션만 출처로 허용합니다. 표기명/cwd에서 Fork ID를 추측하지 않습니다.
- 원본 Pi JSONL은 불변입니다. Work의 Fork 출처/요청자/파일 작업 디렉터리/새 Pi Session ID를 각각 별도 기록합니다.
- Support는 Fork하지 않습니다. 처음 생성할 때의 task 외에 자동으로 Main 전체 대화를 전송하지 않습니다.
- Native Split은 `listGhosttyTerminals`, `getFocusedGhosttyTerminalId`, `splitGhosttyTerminal`을 재사용하고, 실패 시 다른 Tab을 추측하거나 중복 Agent를 자동 생성하지 않습니다.
- Terminal 생성 영수증은 Pi 프로세스 준비·사용자 지시 처리 완료의 증거가 아닙니다.
- 기존 `native-agent-entry.mjs`의 Launch Ticket 필드 `overviewTerminalId`는 하위호환 이름입니다. 새 호출에서는 **실제 요청자 Terminal ID를 값으로 사용**하며 Sidebar를 생성하지 않습니다. 이름을 정리하는 후속 리팩터링은 기능 동작 확인 이후 별도로 진행할 수 있습니다.

관련 코드: `extensions/direct-delegation.ts`, `src/native-agent-launch.ts`, `src/native-work-fork.ts`, `src/native-worktree.ts`, `src/ghostty-native.ts`, `bin/native-agent-entry.mjs`.

## 4. 완료된 Work의 공유 후보 자동 준비와 검토

```text
Work 실행 중 입력 "<" / "< @session"
  ├─ Pi input 이벤트에서 action: handled (Steering/followUp 미전달)
  ├─ 메모리상 대기 요청: 송신 세션 ID·현재 leaf·수신 조건
  └─ Work 기존 실행은 계속
       └─ Pi agent_settled
            ├─ aborted/error/완료 보고 없음: 요청 폐기, 이유 알림
            └─ 완료 assistant 보고: 검토 가능 상태 표시
                 └─ 사용자가 다시 "<" 제출
                      ├─ 원래 Pi 세션·분기 검증
                      ├─ 수신자의 정확한 intercom 주소 검증
                      ├─ 필요한 완료 근거에서 초안 생성
                      ├─ 사용자 검토·전송 승인
                      └─ pi-intercom Outbox 요청
```

- 대기 요청은 Work 대화에 기록하는 모델 지시가 아니며, 다른 Main/Work 세션으로 자동 이관하지 않습니다.
- **A안(2026-11-09):** Work가 과제 완료를 명시적으로 보고한 경우 실행 종료 뒤 별도 모델 호출로 완료 여부를 분류하고 공유 후보를 추출합니다. 후보·원문 Entry ID는 Work 세션의 `compose_handoff_candidates` custom entry에 기록하며 Main 모델에 전송하지 않습니다.
- `ask_user`가 활성화돼 있으면 Work의 별도 모델 턴에서 기존 모델 전용 도구를 호출해 다중 선택·자유 입력·추가 의견을 받습니다. 이 턴에는 `ask_user`만 활성화하며 사용자 반응 전까지 다른 Agent의 포커스를 가져오지 않습니다. 이후 Work 모델이 작성한 초안은 별도 custom entry에 보관합니다.
- `<` 수동 전송은 저장된 후보/검토된 본문을 우선 사용하며 Pi 기본 `ctx.ui.editor`와 명시적인 전송 확인을 거칩니다. 후보 선택/생성만으로 intercom 전송·Main 정책 변경은 발생하지 않습니다.
- 작업 완료를 확정하는 것은 아닙니다. `agent_settled`는 Pi run 정리 시점일 뿐이고, 완료 판정은 Work의 마지막 완료 보고와 그 주장에 근거한 모델의 분류 결과입니다. 사용자 실사용에서 완료 오분류를 검증해야 합니다.
- 새 Work run 또는 활성 분기가 변하면 이전 응답에 연결된 미검토 초안을 잘못 전송하지 않도록 요청을 무효화합니다.
- sourceEntryId/active leaf 및 정확한 session ID를 확인하며, 검토와 전송 사이에 변했을 때는 실패 처리합니다.
- 전송 요청, broker 전달, 수신 Agent의 모델 처리·승인은 각기 다른 증거입니다.

관련 코드: `extensions/direct-handoff.ts`, `extensions/handoff-draft.ts`, `extensions/handoff.ts`, `src/agent-relationships.ts`.

## 5. Handoff 출처와 품질

현재 초안 생성은 마지막 완료 Work 보고의 일부 발췌문, 최근 사용자 지시, 관련 도구 결과를 후보로 하여 별도 `streamSimple()` 호출로 인용문을 선택합니다. Pi Entry ID와 **원문 문자열 일치**를 확인합니다.

이는 인용문이 실제 기록에 존재한다는 검사이지 아래 항목의 의미 정확성까지 검증하지는 않습니다.

- 금지·허용 조건, 부정문, 승인 주체, 기존 정책과의 충돌
- 테스트 코드 존재/테스트 실행/테스트 성공의 구분
- Work 보고/실제 도구 관찰/사용자 명시 승인 구분
- Compaction·ContextEdit 이후 참조 가능한 원본 범위

이전 실험 자료와 [QMSum](https://aclanthology.org/2021.naacl-main.472/), [FActScore](https://aclanthology.org/2023.emnlp-main.741/), [SummEdits](https://aclanthology.org/2023.emnlp-main.600/), [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)은 검증 근거로만 사용합니다. 논문이 Pi Compose 자체를 검증한 것은 아닙니다.

## 6. 검증된 레퍼런스와 남은 공백

- [pi-intercom 0.18.1 `/handover`](https://github.com/nicobailon/pi-intercom/tree/v0.18.1): 대상 선택 → 요약 생성 → Pi 기본 Editor에서 수정 → 전송. 새 작업을 이어받는 용도라 Main의 승인 없는 정책 변경을 방지하는 Compose 계약과 동일하지 않습니다.
- [pi-ask-user](https://github.com/edlsh/pi-ask-user): 모델이 호출하는 `ask_user`를 이용해 사용자에게 질문·선택·자유 입력을 받습니다. 도구의 `exposure: model-only` 때문에 별도 Compose `streamSimple()` 내부에서 자동 호출되지는 않습니다.
- [Pi 1.4.0 Extension](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md): 모델 호출, `input`, `agent_settled`, `ctx.ui`를 재사용합니다.

**코드 구현:** `ask_user`가 활성화되면 Work 모델 턴에서 자동 질문을 시작하고, 사용자의 후보 선택/추가 의견을 Work 보고 초안으로 저장하도록 작성했습니다. 이 모델-도구 경로 및 실제 TUI 통합 동작은 **아직 macOS 실행 검증 전**입니다.

## 7. 제외된 과거 설계

멀티프로젝트 Overview, 제품/메시지 Sidebar, 별도 Summary Overlay, Sidebar 기반 프로세스 종료 UI는 최신 결정으로 제외됐습니다. 기존 소스에 남아 있는 Legacy helper는 배포되지 않는 경로로 취급하며, 현행 `pic` 실행·위임에 의존하지 않습니다.
