# 2026-10-27 실사용 위임 정상화 — 검증 및 미확인 보고

**대상:** `fix/live-delegation-recovery`, Base = PR #4 `feat/reference-led-core`. PR #2/#3/#4와 `main`은 수정하거나 병합하지 않았습니다.

## 첨부 로그에서 실제로 확인된 사실

데이터: `pi-compose-ux-2026-10-27T10-54-42-695Z.json`과 `review(1).md`, 사용자가 제출한 실제 관찰.

- 전체 145개 이벤트 중 2026-10-27의 이벤트는 **41개**. 10월 26일에는 이전 테스트성/실행 이벤트가 함께 있습니다. 전체 145개의 성공률을 27일 단일 실사용 성공률로 해석하지 않습니다.
- 10월 27일 Fork + Shared 자연어 위임 1회, 승인 success, 명령 전달 success, `launch.agent_linked` success 1회.
- 10월 27일 `launch.context_linked`, `launch.agent_started`은 기록되지 않았습니다. 당시 바이너리 버전은 로그에 없으며 해당 이벤트 미수집이 원인일 수도 있습니다.
- `sessions.opened` 1회, `sessions.finished cancelled` 1회. 명령 자체가 존재하지 않았다고 단정할 수 없으며 UI 선택 취소 또는 다른 버전 여부는 추가 검증이 필요합니다.
- 사용자는 해당 작업이 Monitor에 보이지 않았고 새 Git 변경·커밋이 없었다고 보고했습니다. Shared Directory인 경우 workmux Dashboard의 Worktree 기록 부재가 곧 프로세스 부재라는 뜻은 아닙니다.
- 사용자 생성 기능의 고정 계약: **기존 `name` 필드의 의미와 클라이언트 호환성을 유지하고 절대 제거하지 않는다.** Pi Compose의 맥락 연속성 수용 시나리오에서 실제 준수 여부를 검사해야 합니다.
- **실제 설치된 Pi Compose Git 커밋, 실행 중 Main/Child Extension, 실제 모델의 prompt 처리 결과는 첨부 파일만으로 알아낼 수 없습니다.**

## 레퍼런스 → 구현 → 수용 기준

| 문제 | 확인된 레퍼런스 사실 | Pi Compose 구현 | 검증 기준 |
| --- | --- | --- | --- |
| 중복 옵션/명령 | [Kiro `/spawn`](https://kiro.dev/docs/cli/reference/slash-commands/)은 작업 입력으로 병렬 세션 시작, Crew Monitor로 관찰 | 기본 Main Fork + Worktree, `/compose`에서 위임·작업 전환·복구·검토 | 한 번 승인으로 위임하고 Main 계속 사용 |
| 작업만 나타나고 준비 판단 불가 | [Orca Worktrees](https://www.onorca.dev/docs/model/worktrees)는 생성 진행/오류/Retry를 별도 표현 | tmux 대상, Pi Child 파일, 원본 `parentSession`, 새 User 프롬프트, Assistant 기록 독립 관측 | 각 단계에 명시적인 '확인/미확인' 증거 존재 |
| 불확실한 프롬프트 중복 전달 | [Orca Native Chat](https://www.onorca.dev/docs/agents/native-chat)은 Provider Transcript를 조사해 확인할 수 없는 전송을 'unconfirmed'로 남김 | Pi 세션 JSONL의 정확한 User 지시를 확인하고 없으면 재전송/중복 생성 안 함 | 새 위임 지시가 실제 세션에 존재할 때만 observed |
| Worktree Fork 버전 불일치 | [workmux 2026-10-23 changelog](https://workmux.dev/changelog/) v0.1.277에 Pi Fork 신규 추가 | 사전 `workmux --version` 검사; 미지원·판별 불가 시 Git+tmux+Pi Native --fork | 구 버전에서 workmux Pi Fork를 사용하지 않음 |
| 세션 복귀 | [Pi sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md) `/resume`, `--session`, `--fork` | tmux의 살아있는 작업 전환과 저장된 Pi Child 정확한 재개 분리 | 기존 Session ID 재개, 새 Fork/중복 Agent 생성하지 않음 |
| 변경 없는 작업도 검토 | [Orca Review AI Diff](https://www.onorca.dev/docs/recipes/review-ai-diff)는 Worktree 기준 diff 직접 검토 | Worktree의 승인 기준 Git Diff와 미추적 파일 목록 표시, Handoff 선택형 | Handoff 없이 Git 상태, diff, 비어 있음 구분 |
| 실제 버전 식별 불가 | Pi Compose 실사용 증거와 Kiro/Orca의 CLI 사용 구조 | installer-pinned SHA, `pic version`/`pic doctor`, 양쪽 Pi에서 `/compose version` | 설치된 커밋 및 *실제 로드된* Extension이 다르면 경고 |

일반 원칙: [OpenAI Harness engineering](https://openai.com/index/harness-engineering/), [OpenAI Codex App Server](https://openai.com/index/unlocking-the-codex-harness/), [Anthropic Long-running harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents). 이는 컨텍스트와 가시성의 중요성을 설명하지만 Pi Compose의 모든 UX/구현 결정을 검증하지 않습니다.

## 실제 코드 변경

- `src/provenance.mjs`와 `bin/setup.mjs`, `bin/pic.mjs`, `scripts/install.sh`: 설치한 commit SHA·Pi Compose package root·중복된 실행 파일·등록된 패키지·실행 중인 Extension 위치. 모듈 로드 시점 SHA는 스냅샷.
- `src/launch.ts`: 실제 workmux 버전이 Pi --fork를 지원하는지 검사. 지원이 불확실하면 Native Pi Fork+Worktree로 안전하게 폴백.
- `src/session-observation.ts`: Pi JSONL 내부의 정확한 새 User 지시와 이후 Assistant 메시지를 보수적으로 판별. 부재는 Unknown.
- `src/task-index.ts`: 정확한 기존 Child를 원본 session path + working directory + full prompt로 재연결. 종료 후 정확한 저장 Pi 세션 재개 시 tmux 대상 재연결.
- `extensions/task-hub.ts`: 실행 상태, Git 리소스, 잔여 문제 확인, 저장 Child 재개, Shared Git 변경(Agent 귀속 불가), Worktree Diff를 한 작업 상세에서 연결.
- `extensions/compose.ts`: 실패한 **승인된** 실행의 잔여 리소스 기록, 진실한 명령 전달 메시지, 현재 프로세스 버전 확인.
- `extensions/work-return.ts`, `src/diagnostics.mjs`: 저장 대화 결과 수와 취소 원인, 정확한 Child prompt/response 이벤트.

## 실행 확인 및 한계

| 검증 | 결과 | 증거/이유 |
|---|---|---|
| 실제 첨부 UX 이벤트 분석 | PASS | JSON의 27일 41 이벤트 / 경로별 카운트 |
| 최신 PR #4 코드 검토 및 별도 브랜치에서 구현 | PASS | GitHub 파일·커밋, Draft PR |
| 설치된 사용자 macOS Git SHA 확인 | NOT_RUN | 사용자 Mac 및 실행 중 Pi 세션 접근 불가 |
| 실제 Main/Child Extension 버전 비교 | NOT_RUN | 로컬 경로/실행 프로세스 접근 불가 |
| Pi Child 모델 인증·원본 지시 처리 | NOT_RUN | Pi/tmux/workmux 실행 환경 없음 |
| 실제 Main ↔ Child 터미널 복귀 | NOT_RUN | tmux 실행 환경 없음 |
| Git Diff 검토 인터페이스 및 실패 복구의 macOS 실사용 | NOT_RUN | 사용자 Mac 환경 없음 |
| 변경된 단위 테스트 소스 추가 | PASS | `test/provenance.test.mjs`, `test/session-observation.test.ts`, `test/launch-version.test.ts` |
| Node.js 모듈 문법 검토 (일부 CommonJS 변환) | PASS / LIMITED | 몇 개의 .mjs 소스만 파서 검사, TypeScript 전체 검증은 아님 |
| 전체 `npm run typecheck` 및 `npm test` | NOT_RUN | 연결된 GitHub 파일을 실행 환경에 clone 불가; 프로젝트 의존성 미설치 |
| GitHub Actions / E2E | NOT_RUN | 사용자 지시에 따라 실행하지 않음 |

## macOS 수용 검증 — 한 번에 전체 흐름

1. 재설계 브랜치 설치 → `pic version`, `pic doctor`에서 설치 SHA / workmux 버전 확인 → 실제 Main과 Child의 `/compose version` 비교. 구버전 프로세스는 재시작.
2. 테스트 저장소 Main에서 `name` 필드 호환성의 이유와 제약 논의, `/compose`에서 현재 대화 Fork + Worktree 위임 승인.
3. Child Pi 실제 생성, 정확한 parentSession, 위임 User 지시 기록, Assistant 응답 관찰. 모델이 `name` 금지를 정확히 이해·실행하는지 Child 대화 및 코드에서 확인.
4. 그동안 Main에서 다른 요구사항 논의. `/compose`에서 기존 Child로 이동했다가 정확한 Main으로 복귀.
5. 정확한 Worktree의 기준 SHA 이후 실제 변경, 새 파일, Git Diff 확인. 보고/테스트 결과와 코드를 비교. Shared 변경은 Agent에게 귀속하지 않음.
6. Child 창을 종료하고 `/compose` → 저장된 Child Pi 재개를 명시적으로 승인. 기존 JSONL Session ID가 유지되고 중복 Fork는 없어야 함.
7. Worktree 준비 후 tmux 실행 실패를 유도. Git과 기존 세션은 보존, '실행 실패/잔여 리소스'가 표시되고 중복 실행/자동 삭제가 없어야 함.
8. `/compose sessions`에서 저장된 이전 대화 조회 → 선택/취소/없음 원인 확인 → 정확한 대화로 복귀.
9. `pic diagnostics export --days 1`에서 `launch.prompt_observed` 및 `launch.response_observed`와 명령 성공의 차이 확인. 원문 프롬프트·파일 경로는 제외.

**릴리스 조건:** 인증된 Mac에서 위 1~9를 실제 수행하고, 실제 Pi 모델이 기존 `name` 필드를 제거하지 않는 사용자 생성 구현을 만들 수 있음을 검증. 그 전에는 제품의 전체 개발 흐름을 PASS로 선언하지 않습니다.
