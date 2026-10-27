# Pi Compose ADE — macOS Runtime 기술 검증 (1차)

> 기준: fix/live-delegation-recovery에서 분기한 spike/ade-macos-runtime-validation. **API 소스 확인 및 재현 스크립트 작성 단계**로, macOS 모델 실연동이나 ADE 구현 완료 보고서는 아니다.

## 제품 계약

- 기능·주제마다 독립된 Main을 생성. 정확한 Main Pi 대화를 Fork해 Child가 개발하고, Main 대화는 그대로 유지한다. 요약을 Fork로 대체하지 않는다.
- 사용자 명시적 위임 이후 Child가 기존 설계 안에서 자율 구현한다. 중요한 계약 변경은 Main에서 사용자 결정.
- 여러 세션을 동시에 관찰하되 Child 로그·TODO·Diff는 Main 모델 메시지에 자동 삽입하지 않는다.
- Agent 보고·실제 Git 변경·검토 완료·Git 통합을 구분한다. 자동 병합·Worktree 삭제 금지.
- macOS 창 닫기는 창만 닫고, Cmd+Q 앱 종료 시 Child 실행도 중단한다. 세션과 미커밋 코드는 보존하며 재시작 시 자동 모델 실행 금지.

## 확인된 근거 — Pi v1.4.0 소스

1. [SessionManager.forkFrom](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/session-manager.ts)는 정확한 원본 JSONL과 target cwd를 받아 별도 ID/cwd의 Child JSONL을 생성한다. Child header의 parentSession에 원본 경로를 기록하고, 원본의 모든 non-header entry를 복제한다. 원본 세션을 변경하지 않는 구현이다.
2. [Pi SDK](https://pi.dev/docs/latest/sdk)의 createAgentSession은 cwd와 sessionManager를 받으며, subscribe로 모델/도구 이벤트를 관찰할 수 있다.
3. [AgentSessionRuntime.fork](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/agent-session-runtime.ts)는 해당 Runtime의 활성 세션을 교체한다. **Main Runtime에서 직접 호출해 Main을 교체하는 방식은 부적합하다.** 별도 Child 실행 주체를 사용한다.
4. [Pi RPC](https://pi.dev/docs/latest/rpc)는 별도 프로세스에서 명령과 실시간 이벤트를 전달한다. prompt의 success는 수락일 뿐 작업 완료를 뜻하지 않는다.
5. Git Worktree는 별도 checkout이다. Source의 미커밋 파일까지 복제하는 기능은 아니다.

원본 기록 복제는 실제 모델의 모든 설계 이유·금지 강도 이해를 보장하지 않는다. 활성 컨텍스트, 신규 개발 지시, 모델 응답, 실제 Git 변경을 분리해 확인한다.

## 검증 매트릭스

| 검증 대상 | 현재 상태 |
| --- | --- |
| v1.4.0 Fork API/세션 계보 | 소스 확인 |
| 실제 SDK SessionManager Fork 동작 | 재현 스크립트 작성, 실행 전 |
| Main·Child의 동시 모델 실행 | 미검증 |
| 실시간 Pi Assistant/Tool 이벤트 | 공식 API 확인, 실연동 미검증 |
| TODO·실행 로그의 Main 컨텍스트 비유입 | ADE 통합 후 검증 필요 |
| Git Diff → Child에게 의견 전달 | 통합 후 검증 필요 |
| macOS 종료·재실행 및 Child 안전 재개 | macOS 통합 후 검증 필요 |

## 실행 가능한 모델 없는 스모크

macOS 저장소 체크아웃에서 Node 22.19 이상과 npm 의존성을 설치한 다음 실행한다.

    npm ci
    node scripts/ade-fork-smoke.mjs

스크립트는 임시 Git 저장소/Worktree와 실제 Pi의 SessionManager를 사용한다. exact parentSession, 새 cwd, 원본 대화 복제, active branch 동일성, Child 메시지 독립성, Git 변경 격리를 검증하고 테스트용 임시 폴더만 정리한다. 사용자 작업 공간을 수정하지 않는다. 모델 호출·macOS E2E는 범위 밖이다.

## macOS 실기 검증 (실행 전)

1. 인증된 Pi Main에 '기존 name 필드를 호환성 때문에 절대 제거하지 말라'는 결정과 이유를 기록하고 JSONL을 저장.
2. 별도 Git Worktree에서 정확한 Main JSONL로 Child를 Fork하고 source/child session ID, parentSession, target cwd, active branch, base SHA를 확인.
3. Main을 계속 사용하면서 Child에게 실제 개발 지시 전송. 수락, Pi 실행 이벤트, 모델 응답, 실제 코드 수정, 완료 보고를 구분.
4. Child가 강한 제약을 실제 코드에서 지켰는지 확인. Main 대화 기록과 코드 불변 검증.
5. Child 여러 개를 Main과 동시에 관찰. Child의 TODO/도구 출력이 Main 대화에 삽입되지 않음을 확인.
6. Child 중단 후 같은 저장 세션 재개. 중복 Fork·작업 손실이 없는지 확인.
7. macOS 창 닫기, Cmd+Q, 정상/강제 종료를 따로 검증하고 실제 프로세스 생존 상태와 복원 동작 확인.

## 아키텍처 후보 (미확정)

ADE GUI는 Pi 세션들의 표시와 작업 전환을 담당한다. 실행은 Child별 독립 SessionManager/SDK Runtime 또는 RPC 프로세스가 담당하는 후보를 비교한다. 프로세스 격리와 macOS 종료 정책상 Child별 RPC가 유력하지만 실제 Pi Extension/세션 수명주기 검증 전에는 확정하지 않는다.

## 이번 실행 환경 한계

이번 작업 환경은 Linux, Node 22.16.0이고 pi/tmux가 설치돼 있지 않으며 npm 외부 DNS 접속이 실패했다. 따라서 스모크 스크립트의 **Node 구문 검사만 실행·통과**했으며 실제 Pi 의존성을 통한 스모크나 macOS 인증 모델 E2E는 실행하지 못했다. 이를 PASS로 표현하지 않는다.
