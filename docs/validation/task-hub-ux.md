# PR #3 — 레퍼런스 기반 Launch·Navigation·Result UX 수동 점검

기준: `feat/task-hub-ghostty`. **이번 구현에서 GitHub Actions, E2E는 실행하지 않았습니다. 실macOS/Ghostty·인증된 Pi 모델 화면은 검증하지 못했습니다.** 이 문서는 실행 가능한 확인 절차이지 이미 통과한 검증 보고가 아닙니다.

## 변경된 경계

- **유지:** 사용자 명시적 실행, Fork/Independent, Shared/Worktree, 원본 Main 세션, 정확한 tmux 창, Pi 저장 대화, Handoff/Verify, 명시적 Resume
- **통합:** 자연어와 Slash 모두 단일 Pi `confirm()` 승인 사용; Child Agent에서도 같은 `compose_launch` Tool 사용
- **대체:** 자체 Task Hub Overlay/Dialog 렌더러 → Pi `ctx.ui.select()`; 전체 출력/상태 → workmux Dashboard; 이전 기능 → Pi SessionManager
- **제거:** Compose 내부 workmux 상태 JSON 파서와 Ghostty 네이티브 AppleScript 탭 제어
- **호환 유지:** `/compose work`, `/compose back`, `/compose resume`, `/compose-workmux`(선택형)
- **중요:** workmux Dashboard Agents 보기는 Pi 상태 Hook이 필요하며 `workmux setup`은 사용자가 실행합니다. Shared Pi가 모두 표시되지는 않습니다.

## 검증 매트릭스

| 시나리오 | 사용자 조작 | 완료 기준 |
| --- | --- | --- |
| 최초 진입 | `pic` | Pi 기본 대화 정상, Compose 상태 안내가 최소, Main 세션 기존 실행 보존 |
| 실행 의도 없는 논의 | "Agent에게 맡기는 게 나을까?" | 작업·Worktree 생성 없음 |
| 명시적 자연어 | "현재 대화 Fork, Worktree에서 구현해 줘" | 실행 옵션 및 지시 원문 확인, 승인 전 변경 없음 |
| 직접 명령 | `/compose launch API 구현` | 자연어와 같은 승인 컴포넌트, Source/Workspace/브랜치 분리 |
| 취소 | 실행 확인에서 취소 | tmux·Worktree에 새 대상 없음 |
| 작업 탐색 | `/compose` | Main, 현재 Agent, 연결된 작업만 적절히 구분. 동명이인 각각 식별됨 |
| 순서 안정성 | 3개 Agent 중 하나 종료 | 실행 가능 여부가 바뀌어도 목록 기본 순서 유지 |
| 정확한 이동 | Main → Agent A → Main → B | tmux의 동일 세션·창 ID 재사용, 중복 Pi 미실행 |
| 연결 정보 없거나 종료 | 오래된 작업 선택 | 새 Pi 자동 실행 없음. 고급 Resume 경로 분리 |
| 모니터 | `/compose monitor` | workmux Dashboard 실행; 에이전트 Hook 설정 시 상태·미리보기 확인 |
| Workmux 미지원 | Shared Directory 또는 Hook 미설치 | 대체 경로 `/compose` 존재, 거짓 상태·완료 없음 |
| 기능 복귀 | `/compose sessions 프로필` | 정확한 Pi 저장 대화 선택, 같은 프로세스에서 전환 |
| 다른 프로젝트 | 각 프로젝트 tmux/workmux | Compose에 별도 프로젝트 관리 DB 없음 |
| 결과 작성 | Worktree Agent의 `/compose-handoff` | Git HEAD와 주장·WHY·미해결 사항 수집, 미수행 테스트 구분 |
| 독립 검토 | `/compose-verify main` | 실제 승인 후 읽기 전용 Pi, 검토 범위와 미검증 구분 |
| Main에서 결과 | `/compose` → 해당 Agent → 결과 보기 | 터미널 이동 없이 읽기. 기록 당시 HEAD 및 개발자 주장/독립 검토 구분 |
| Shared 결과 | Shared Agent에서 Handoff | 실제 Child Session 연결이 검증되면 Main에서 보고서를 확인하되 Git 변경 작성자는 추측하지 않음 |
| 좁은 화면 | 60×16, 80×24, 120×35 | Pi 네이티브 선택 UI·확인 Dialog 가독성, 입력·취소 복원 |
| 긴 한글 지시 | 한글 100자·여러 줄 금지사항 | 텍스트 손상·오해 없이 읽을 수 있어야 함. 실제 검증 전 미완료 |
| Ghostty와 일반 터미널 | 각각 동일 명령 | `/compose` 기본 동작은 Ghostty 전용 AppleScript에 의존하지 않음 |

## 구분해야 할 증거

- **정적 코드 검토:** Shell 인자를 무단 변경하지 않는지, 등록된 명령이 정확히 한 번인지, 동일한 ID로 tmux 창을 확인하는지, 중복 렌더러/상태 데이터베이스가 없는지 확인할 수 있습니다.
- **단위 수준:** 작성된 Extension 테스트는 사용자 요청에 따라 이번에는 실행하지 않았다면 `미실행`으로 보고해야 합니다.
- **실제 macOS Pi:** Fork 전달, workmux Hook, Dashboard 프로젝트 간 탐색, TUI 입력 복원, Ghostty/tmux 창 이동은 사용자의 실제 환경에서 확인이 필요합니다.

### 설치 전제

```bash
pic navigation enable
workmux setup
pic features
```

첫 번째는 Worktree Agent의 Pi Navigation 등록, 두 번째는 선택적인 workmux 상태 Hook 설치, 세 번째는 선택형 결과 인계/검토 기능입니다. 각각 Pi 설정과 전역 사용자 환경에 영향을 줄 수 있으므로 **사용자가 직접 선택해 실행**합니다.

이전 기록에 정확한 Main·Worktree 연결이 없다면 비슷한 이름만으로 연결하지 않습니다. 실사용 검증에서 문제가 나왔을 때는 무작정 Overlay를 되살리지 않고 명시된 작업 흐름과 원본 식별을 먼저 확인합니다.
