# ADR 0007 — 검증된 도구에 맡기는 Agent 탐색·관찰·결과 회수

- 상태: **채택 — B안 전체 구현에 적용**
- 선행: [ADR 0001](0001-context-and-delegation.md), [ADR 0002](0002-user-controlled-execution.md), [ADR 0004](0004-pi-native-optional-views.md)
- 배경: PR #3의 Overlay·Dialog·Ghostty 탭·자체 상태 UI를 반복 개선했으나 사용자가 긴 로그·겹침·작업 구분 비용을 계속 보고함.

## 참조한 검증된 사용자 경험

| 참조 | 제공하는 경험 | Pi Compose에 가져온 판단 |
| --- | --- | --- |
| [Claude Code Subagents/Agent Teams](https://code.claude.com/docs/en/sub-agents) | 짧은 독립 조사와 지속적인 Agent 협업을 구분 | 메인 맥락을 보존하는 Fork와 Independent를 유지, 불필요하게 모든 조사 세션을 관리하지 않음 |
| [Codex CLI agent_navigation.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/agent_navigation.rs) | 부모·자식 Agent 전환과 안정된 목록 순서 | Main·현재·관련 Agent를 정확한 ID로 구분하고 상태에 따라 정렬하지 않음 |
| [Kiro CLI 세션·Crew](https://kiro.dev/docs/) | 활성 Agent 관찰과 과거 대화 선택을 구분 | 실행 창 탐색과 저장 대화 탐색을 분리 |
| [workmux Dashboard](https://workmux.dev/guide/dashboard/) | 여러 프로젝트의 실제 출력·Git·상태 관찰 | 중복 TUI/상태 파서 제거; 원래 workmux를 선택형 사용자 UI로 직접 호출 |
| [Pi TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md) | 내장 select/confirm과 Extension | 기본 선택·확인 UI 재사용; 복잡한 custom render() 제거 |

레퍼런스 기능을 모두 복제하지 않고 **원본 맥락이 어디서 왔는가**와 **사용자가 언제 실행을 승인했는가**처럼 기존 도구 사이에서 잃는 정보만 Compose가 책임진다.

## 새 책임 경계

- **Compose:** 실행 요청·승인·원본 Pi 세션 지정, Context/Workspace 분리, 정확한 tmux·Worktree 연결, 사용자용 작업명·실제 지시, 명시적 Handoff/Verify 증거 연결.
- **Pi:** 인증·세션·대화·Native UI·Fork/Resume·코딩 Agent 실행.
- **tmux/workmux:** 실행 창·Worktree·다중 프로젝트 관찰, 가능할 때 상태·출력 미리보기. **Shared Directory 작업의 모든 상태를 알 수 있다고 주장하지 않는다.**
- **사용자:** 생성·검증·통합·종료·삭제의 실행 결정. Compose가 자동 Git 병합이나 Worktree 정리하지 않음.

## 제품 UX 계약

1. `/compose`: 현재 프로젝트의 Main·관련 Agent 선택. **지속 상태 모니터링, 로그 미리보기, Git diff 렌더링 없음.**
2. `/compose monitor`: workmux Dashboard를 tmux 팝업에서 호출. **Pi Hook 미설치라면 목록이 비어 있을 수 있음**. Pi의 waiting 상태는 보장되지 않음.
3. `/compose sessions`: 현재 프로젝트의 Pi 저장 대화 → Pi `ctx.switchSession()`. 다른 프로세스·Worktree 생성 없음.
4. Handoff/Verify: 사용자 요청으로만 실행하고 기록 당시 Git HEAD를 포함해 정확히 단일 Worktree에 매핑. 독립 검토가 존재해도 결과 승인이나 Git 통합을 뜻하지 않음.
5. Ghostty의 AppleScript 탭 자동 제어는 제거. 터미널 전용 동작을 기본 계약으로 만들지 않음. 기존 tmux/workmux 창 이동 재사용.
6. Child Pi에서는 사용자가 `pic navigation enable`을 선택해 동일한 Launch·관련 Agent·저장 대화 탐색 도구를 로드함. 별도 사용자 설정의 무단 변경 없음.

## 실행 식별과 한계

실행 대상은 tmux **세션+창 ID**, Worktree는 **프로젝트 루트+실제 경로+workmux handle+Git branch**, 원본 대화는 Pi Session ID로 확인한다. 이름이 같다는 이유로 새 작업을 기존 Agent로 추측 연결하지 않는다. 마지막으로 확인한 tmux 창이 종료됐거나 바뀌었으면 자동 재실행하지 않는다.

현재 Pi Compose에는 **Fork 이후 실제 자식 Pi Session ID가 즉시 검증되었다는 보장이 없다**. 사용자에게 Launch 성공을 실제 Pi 모델 준비·개발 완료로 표시하지 않는다.

이 결정은 기존 ADR 0004의 핵심인 **Pi-native 및 선택형 View 재사용**을 유지하되, 기본 `/compose monitor`에서 설치된 workmux Dashboard를 호출할 수 있도록 진입점만 추가한 것이다. 선택형 `/compose-workmux`도 호환된다.
