# Pi Compose × Orca — Native Agent Actions

이 브랜치는 Orca에서 터미널을 열고 `pic-orca`를 입력하는 기존 실험 단계를 넘어,
**실제 Orca 사이드바에서 Main/Work/Support Agent를 생성하고 자동으로 Pi 터미널 탭을 시작**합니다.

## Orca 원본에 연결한 위치

**업스트림:** stablyai/orca, 고정 커밋 `4a39d186da72a496b29a9ec5c523bbbf0a3460d8`.

| 원본 코드 | 추가 기능 |
| --- | --- |
| `src/renderer/src/components/sidebar/sidebar-header-actions.tsx` | 기존 프로젝트/새 Workspace 버튼 옆에 **Pi Compose** 메뉴 |
| `src/renderer/src/components/terminal/terminal-tab-create.ts` | 기존 함수를 **변경 없이 사용**해 실제 Pi TUI 탭 생성 |
| `src/preload/index.ts`, `api-types.ts` | 허용된 Main/Work/Support 동작만 노출 |
| `src/main/startup/main-process-ipc-bootstrap.ts` | 최소한의 Pi Compose IPC 등록 |
| `src/main/pi-compose-ipc.ts` (신규) | Renderer 요청 검증, 별도 Node bridge 호출 |

UI는 Orca의 React Dialog, Button, 터미널 관리 기능을 그대로 사용합니다. 새 Electron 앱·터미널 렌더러·계정 시스템을 만들지 않습니다. 스크립트는 **원본 Orion 소스**가 아니라 **원본 Orca 소스**의 특정 코드에 작은 변경만 적용합니다.

Orca 업스트림 원본은 `.cache/orca-upstream`에 있으며 MIT 라이선스와 저작권 고지를 보존합니다. 변경된 upstream은 이 Git 저장소에 대량 복사하지 않고 `orca-overlay/` 변경 파일 및 `scripts/orca-native-overlay.mjs`로 관리합니다. 핀된 버전이 바뀌거나 예상한 원본 코드가 다르면 **자동 덮어쓰기 대신 오류로 중단**합니다.

## 실제 사용 흐름

1. Orca에서 로컬 Git 프로젝트를 선택합니다.
2. 왼쪽 사이드바 상단의 **Pi Compose 아이콘(겹친 레이어 모양)**을 누릅니다.
3. **Main Agent**를 선택하고 대화 이름을 입력해 생성합니다. 새 Pi 터미널이 Orca 탭으로 실행됩니다.
4. Main에서 요구사항·의사결정의 이유·강한 제약까지 실제 Pi와 논의합니다. Pi JSONL이 원본입니다.
5. 같은 프로젝트에서 다시 Pi Compose 메뉴를 열어 **Work Agent**, 정확히 이어받을 Main, 개발 지시, Git 작업 공간을 선택합니다.
6. Pi Compose가 먼저 **정확한 Main 세션 파일**을 확인하고 JSONL 전체를 Fork합니다. 복제 항목이 모두 일치하지 않으면 실행하지 않습니다. 성공하면 **Orca의 실제 새 터미널 탭**에서 해당 Work 세션이 지시와 함께 시작됩니다.
7. **Support Agent**는 Main 대화를 복제하지 않고 새 Pi 세션 ID에서 작업을 시작합니다. 프로젝트/작업 관련 Main ID만 별도 레코드로 기록합니다.
8. Agent 터미널 분할·닫기·종료 및 로그인은 Orca의 UI를 사용합니다.

**직접 터미널에 `pic-orca`나 `/compose-work`를 입력할 필요가 없습니다.** 기존 명령은 디버깅·비상 경로로 남깁니다.

## 지키는 계약

- Main은 여러 개. 제품/작업/기능별로 독립적인 Pi 세션을 보유합니다.
- Work는 선택된 **정확한 Main JSONL**에서 Fork합니다. 요약 프롬프트로 대체하지 않습니다.
- Support는 독립적인 Pi 세션. Main의 실제 대화 기록을 주입하지 않습니다.
- Fork/Independent와 Shared/Worktree는 **각각 다른 선택**입니다.
- Pi 대화와 실험 로그가 다른 Agent나 Main의 LLM 컨텍스트에 자동 추가되지 않습니다.
- Pi JSONL이 설계 정본, Git이 코드 정본입니다. 자동 커밋/병합/Worktree 삭제 없음.
- 실행 전 Fork 실패, 터미널 시작 실패를 명확히 구분합니다. 이미 준비된 세션이나 Worktree는 **중복 생성/삭제하지 않습니다**.
- Work/Support 탭을 종료했다가 다시 실행해도 **첫 개발 지시를 자동으로 중복 전송하지 않습니다**. 최초 실행에서만 한 번 전송하고 이후에는 동일 Pi 세션을 재개합니다. 최초 Pi 프로세스가 시작에 실패했다면 작업을 재지시해야 할 수 있습니다.
- 인증과 모델 선택은 기존 Pi/Orca의 공식 방식을 사용합니다.

## 주의: Worktree 표시의 현재 제약

현재 Worktree를 선택하면 Pi 프로세스 자체는 새 Git Worktree 폴더에서 시작합니다.
그러나 **Orca 사이드바의 작업 폴더·Git 검토가 자동으로 그 새 Worktree로 전환되지는 않습니다.**
UI에서 이를 명시합니다. 이때 Orca Git 화면이 표시하는 기준 폴더와 Work 실제 작업 폴더를 혼동하지 마세요.

다음 단계에서 Orca의 기존 Worktree 등록/전환 API를 통해 관계를 연결해야 합니다.

## macOS 실행

```sh
git fetch origin
git switch feat/orca-native-agent-actions
npm install
npm run orca:dev
```

기본 요구사항: macOS, Node 24, pnpm, Pi 설치 및 기존 모델 인증, Git.

스크립트가 기존 Orca 체크아웃에 **앵커 기반 최소 패치**를 적용합니다.
원본 체크아웃에 예기치 않은 사용자 변경이 있으면 중단하며 재설치/삭제를 시도하지 않습니다.

필요하면 별도로 `npm run orca:prepare`를 실행해 원본 검증·패치를 먼저 할 수 있습니다.
다른 브랜치에서 생성한 Pi 대화, Git Worktree, 기존 PR #7~#11은 변경·삭제하지 않습니다.

## 검증

- `npm run test:orca`: 실제 Pi SessionManager Fork, 새 Main 등록/빈 대화 차단, 독립 Support, 다른 프로젝트 Main 차단, 덮어쓰기 방지.
- macOS CI: 고정 Orca checkout, overlay 적용, Orca 원본 TypeScript 검사.
- **실기 E2E 미검증**: Orca GUI에서 Main → Work 실제 모델 구현 → Support 독립 실행 → Orca 네이티브 종료/재개 및 Git Diff. CI 빌드가 이를 대체하지 않습니다.

현재의 완료 범위는 **Orca UI에서 Pi Compose Agent를 생성하고 Orca 터미널 탭을 자동 시작시키는 첫 통합**입니다. Orca Agent 목록의 Main/Work/Support 계층 시각화, Worktree 자동 전환, 모델 실행 기반 검증은 아직 미완료입니다.
