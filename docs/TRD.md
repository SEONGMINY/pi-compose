# TRD — Pi Compose 현재 기술 계약

- 제품 정책: [PRD](PRD.md) · 최신 합의 2026-11-09
- 사용 흐름: [Usage](USAGE.md)
- 아키텍처 원본: [Architecture](ARCHITECTURE.md)
- 검증 상태: GitHub 코드 반영, **Pi 1.4.0 + macOS Ghostty 통합 실사용 검증 전**

## 1. 사용하는 런타임과 기능

| 기능 | 원본/재사용 방법 | 제약 |
|---|---|---|
| Pi TUI와 저장 세션 | `@earendil-works/pi-coding-agent` | bare `pic`은 새로운 `--session-id` |
| Resume | Pi `-r`, `-c`, `--session`, `/resume` | 역할 바꾸지 않음, 최근 세션이 항상 Main은 아님 |
| Agent 신원 | `session_start`에서 `compose_agent_identity` | 현재 Pi 세션 ID와 정확히 일치해야 함 |
| Work Fork | `SessionManager.createBranchedSession` | 완료된 Assistant 지점·활성 분기·원본 JSONL 불변 |
| Support | 별도 Pi Session ID | Main 대화 상속 없음 |
| Git Worktree | Git CLI `worktree add -b` | 원본 HEAD 기준; 미커밋 변경 복사·Merge·자동 삭제 없음 |
| 새 Agent Split | Ghostty 1.3.1 AppleScript Native Terminal UUID | 현재 입력 Terminal 확인, Mac Automation 권한 필요 |
| 보호형 Main 전달 | 동일 사용자 로컬 영속 보관 + `pi-intercom@0.18.1` Extension Channel 알림 | 보관과 모델 처리·정책 채택 구분, 일반 Outbox 우회 금지 |
| 완료 공유 후보 준비 | Pi `ctx.modelRegistry.streamSimple()` + 비컨텍스트 `pi.appendEntry()` | Work 완료 보고 분류, 최대 5개 근거 후보 자동 저장; 완료 여부는 독립 증명 아님 |
| Handoff 요청 | Pi `input` 이벤트 + `agent_settled` | busy 요청은 `handled`, Steering/Follow-up 미전달 |
| Handoff 검토 | pi-ask-user 원본 `ask_user` (model-only) + Pi `ctx.ui.custom` 미리보기 | 선택된 후보 ID·근거·맥락 구성, R 재검토, S 명시적 저장 승인 |

## 2. Main 실행

`bin/pic.mjs`에서 호출된 디렉터리를 `realpathSync()`로 정규화하고 해당 경로의 SHA-256 앞 24자리로 안정적인 프로젝트 키를 만듭니다. 제품명은 `cwd-<hash>`, 표시 이름은 디렉터리 이름입니다. 동일 경로의 새 Main들은 제품 키를 공유하지만 세션 UUID는 새로 생성합니다.

`createAgentBootstrap` / `encodeAgentBootstrap`을 사용해 환경 변수 `PI_COMPOSE_AGENT_BOOTSTRAP_V1`를 전달합니다. Pi `--session-id`로 시작한 세션의 `session_start`에서 ID와 cwd가 일치할 때만 메타데이터를 기록합니다.

Pi 복구 명령은 해당 임시 bootstrap 환경을 제거해 **기존 저장 신원이 우선**하도록 합니다. 이전 Legacy Compose 세션은 기존 신원을 변경하지 않습니다.

## 3. Ghostty에서 현재 터미널 기준 Agent 생성

`extensions/direct-delegation.ts`는 사용자 입력 `>w`/`>s`/`>>w`/`>>s`만 가로챕니다. 모델의 일반 도구 실행이나 다른 텍스트에서는 Agent를 생성하지 않습니다.

`startNativeAgentFromTerminal`은 다음을 확인합니다.

1. macOS, 명시적인 작업 지시, 정확한 역할과 Fork 원본
2. 현재 Ghostty Terminal UUID와 사용자 입력 Terminal의 동일성
3. 해당 Terminal의 Ghostty Native Split 가능 여부
4. Work의 정확한 Pi session/leaf 또는 Support 새 UUID, Worktree 원본 Git HEAD
5. 일회용 Launch Ticket을 통한 새 Pi 실행과 반환된 Native Terminal 영수증

한 번의 Split 요청 결과가 불명확하면 자동 재요청하지 않습니다. `Ghostty Split created` 영수증만으로 Pi 모델 실행 성공을 선언하지 않습니다.

이전 Overview 함수와 Launch Ticket의 `overviewTerminalId` 명칭은 Legacy 호환 경로로 남아 있을 수 있으나, 새 요청에서 사용하는 실제 anchor는 사용자의 현재 Pi Terminal입니다. Sidebar는 생성되지 않습니다.

## 4. 진행 중 Handoff 대기/검토

`extensions/direct-handoff.ts`는 사용자 `<` 입력이 Pi의 streaming 중일 때 `action: handled`로 소비하고, 현재 Pi 세션 ID·leaf·수신자 질의를 임시 기억합니다. `agent_settled` 이후 중단 여부와 완료된 Assistant 보고를 확인한 뒤 Work의 UI에 검토 가능을 안내합니다.

- **대기 상태에서는 모델 호출을 시작하지 않습니다.** Work의 기존 Streaming을 중단하거나 다음 Prompt에 Handoff 명령을 섞지 않습니다.
- 사용자가 다시 `<`를 입력하면 후보를 재검토하거나 검증된 보호형 Work→Main 패키지 경로로 들어갑니다. 기존 일반 intercom Outbox 경로는 Main 보호를 우회할 수 없습니다.
- Work가 중단됐거나 완료 보고가 없다면 대기 요청을 무효화합니다. 대기 중/검토 중 세션 또는 Pi branch가 바뀌면 과거 데이터로 자동 전송하지 않습니다.
- 메모리상의 요청은 Pi 프로세스 재시작 뒤 유지하지 않습니다. 이 불변성과 실제 UI 이벤트 경합은 실사용 검증 대상입니다.
- `input`의 `streamingBehavior: steer|followUp`를 Handoff 메시지로 변경하지 않습니다.

## 5. 원본 Handover·AskUser 재사용 경계

[pi-intercom 0.18.1](https://github.com/nicobailon/pi-intercom/tree/v0.18.1)의 `performHandover`는 `buildHandoverText` → Cancel 가능한 Loader → `ctx.ui.editor` → 전송을 구현합니다. 이를 **하위호환된 Pi UI/취소 패턴으로 참고**할 수 있으나, 상위 Agent에게 다음 작업을 지시하는 Handover 프롬프트는 Main 컨텍스트 보호 정책과 그대로 호환되지 않습니다.

[pi-ask-user](https://github.com/edlsh/pi-ask-user)는 `ask_user`를 `exposure: 'model-only'`로 등록합니다. 독립 `streamSimple()`에서 직접 부르지 않고, 저장된 후보를 Work의 모델 `pi.sendMessage(..., { triggerTurn: true })` 턴으로 전달합니다. 해당 검토 턴에는 `pi.setActiveTools(['ask_user'])`로 모델 도구 표시를 제한하고 뒤에 복원합니다. 선택 응답을 고정 후보 ID로 매핑한 뒤, Work 활성 분기의 근거와 Fork 시점 맥락을 검색합니다. 별도 의미 검사를 거친 최종 본문을 미리보기로 보여주고 명시적 S 승인이 있을 때만 로컬 수신 보관함에 저장합니다. Main `/compose inbox`는 검토를 열 때만 활성 Pi 분기를 사용합니다. 이 연계는 **코드 작성 상태이며 Pi 1.4.0에서 실제 실행 검증 전**입니다.

## 6. 실제 검증 기준

| 분류 | 확인할 동작 | 아직 주장하면 안 되는 것 |
|---|---|---|
| 런처 | `pic` 새 Main·`pic -r/-c` 기존 세션 | 코드 존재만으로 실제 Ghostty 동작 성공 |
| 위임 | 현재 Terminal Split, Work 원본 Fork, Support 독립, Worktree 출처 | Split 생성이 업무 완료를 뜻함 |
| Handoff | 승인된 본문·근거의 로컬 보관, Main 수신 시 무주입, 검토 시 비교, D/I 명시적 사용자 행동 | 파일 보관이 Main의 읽음·정책 채택을 의미한다는 주장 |
| 컨텍스트 | Pi 원본 Entry ID, 승인·부정·실행 상태 | 문자열 포함만으로 의미 검증 완료 |
| 확장 통합 | `pi-intercom`과 `pi-ask-user` 사용자 피드백 처리 | 두 패키지 설치만으로 대화형 수정 완료 |

### 검증 자료

- [QMSum](https://aclanthology.org/2021.naacl-main.472/): 관련 구간을 찾아 필요한 정보를 선택하는 접근
- [FActScore](https://aclanthology.org/2023.emnlp-main.741/): 사실 단위 출처 대조
- [SummEdits](https://aclanthology.org/2023.emnlp-main.600/): 미세한 의미 왜곡의 위험
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/): 장문 맥락에서 정보 활용 한계

이 논문들은 Pi Compose 통합의 정확성·최적 UI·성능을 직접 검증하지 않았습니다. 기존 사용자 실험 데이터에서 실제 실패 사례를 찾아 회귀 검증해야 합니다.
