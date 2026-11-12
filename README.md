# Pi Compose

**Main에서 중요한 결정과 이유를 보존하고, 구현은 실제 Pi 대화를 Fork한 Work에서 진행하는 Coding Agent Harness입니다.** 독립 탐색·테스트는 Support가 맡습니다.

Pi·Ghostty·Git의 기존 기능을 사용하며 별도의 Sidebar, Overview, 서버 또는 데스크톱 GUI를 만들지 않습니다.

## 시작

```bash
cd /path/to/project
pic                   # 현재 프로젝트에서 새 Main
pic -r                # 저장 세션 선택·재개
```

| 입력 | 동작 |
| --- | --- |
| `>w 작업` / `>>w 작업` | 완료된 Pi 대화 Fork로 Work 생성 (공유 디렉터리 / Git Worktree) |
| `>s 작업` / `>>s 작업` | 독립 Support 생성 (공유 디렉터리 / Git Worktree) |
| `>r` / `>r @Work` | 기존 Work 세션 재개 (새 Fork 아님) |
| `><` | Work에서 Main의 최신 확정 정책 변경을 읽기 전용 검토 |
| `<` | Work에서 결과·WHY·검증 상태를 확인하고 Main에 Handoff |

Main이 확정한 정책은 Work에 자동 전달됩니다. `><`는 필수 동기화 명령이 아니며, Work의 Handoff는 정책 채택이나 Git Merge가 아닙니다. **정책 전달·실제 구현·테스트 성공은 별도로 구분**합니다.

[Vision](docs/VISION.md) · [PRD](docs/PRD.md) · [사용 가이드](docs/USAGE.md) · [문서 안내](docs/README.md)
