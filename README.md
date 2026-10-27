# Pi Compose

**Keep the reasoning. Delegate the work.**

Pi Compose는 [Pi](https://github.com/earendil-works/pi)를 기반으로, Main에서 충분히 논의한 요구사항·선택 이유·강한 제약을 **원본 Pi 대화 그대로 Fork**해 개발할 수 있도록 연결하는 코딩 Harness입니다.

Main은 그대로 둡니다. 실제 구현은 새 Pi Agent와 별도 Git Worktree에서 진행합니다. 구현 중 Main에서는 다른 설계를 계속할 수 있습니다. 여러 Agent를 관리하기 위한 별도 AI Runtime이나 Git 관리 시스템을 만들지 않습니다.

## 설치 — 현재 재설계 브랜치

> 이 브랜치는 PR #3에서 분기한 **검증용 개발 버전**입니다. 기존 PR #2·#3과 `main`은 그대로 유지됩니다. macOS 전체 사용 흐름은 아직 실사용 검증 전입니다.

macOS에서 기존 설치 스크립트를 사용할 수 있습니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/feat/reference-led-core/scripts/install.sh \
  | PIC_COMPOSE_REF=feat/reference-led-core bash
```

이미 Pi·Git·tmux·workmux가 설치됐다면:

```bash
npm install -g --ignore-scripts --no-audit --no-fund \
  "git+https://github.com/SEONGMINY/pi-compose.git#feat/reference-led-core"
```

Node.js 22.19.0 이상이 필요합니다. 기존 Pi 인증·설정·세션은 교체하지 않습니다.

```bash
pic doctor       # 설정과 의존성 확인
pic setup        # 필요한 초기 구성만 복구
cd ~/projects/my-app
pic
```

Pi에서 처음 사용한다면 `/login`과 `/model`을 설정합니다. 실행 중인 Pi에서 새 Extension을 인식하지 못하면 `/reload`를 사용하세요.

## 첫 개발 위임

### 1. Main에서 설계합니다

예를 들어 다음을 충분히 논의합니다.

> 프로필에 displayName을 추가해야 해. 기존 name은 이전 클라이언트가 사용하므로 절대 제거하면 안 돼. 왜 호환성을 지켜야 하는지도 함께 정리하자.

### 2. 구현을 맡깁니다

Main에서 직접 말합니다.

```text
지금 논의한 프로필 구현을 새 개발 Agent에게 맡겨줘.
Main은 유지해 줘.
```

또는 `/compose`에서 **현재 대화 Fork → 새 Worktree에서 개발**을 선택합니다. `/compose launch 프로필 구현`도 사용할 수 있습니다.

기본값은 **현재 Pi 대화 Fork + 새 Git Worktree**입니다. 원본 세션을 다시 고르거나 브랜치 이름을 직접 입력할 필요가 없습니다. 브랜치는 작업명과 무작위 접미사로 제안하며 Git 충돌을 확인합니다.

실제 작업 지시, 원본 세션 ID, Git 기준, 브랜치와 경고를 확인하고 **실행을 승인**해야 Agent가 생성됩니다. 원본 대화가 아직 저장되지 않았다면 자동으로 Independent로 바꾸지 않고 이유를 알려줍니다.

다른 원본 Pi 대화, Independent 또는 Shared Directory는 `/compose`의 **다른 실행 방식**이나 `/compose advanced`에서 선택합니다.

### 3. Main에서 계속하고 필요할 때 돌아옵니다

실행 명령 성공은 모델의 구현 성공이 아닙니다. Compose는 **정확한 tmux/Child Pi 연결**과 **원본 Pi parentSession 확인**을 따로 기록합니다. 원본 대화 계보가 확인되지 않았다면 Fork 완료라고 주장하지 않습니다. 모델이 모든 제약을 이해했는지는 실제 대화를 직접 확인해야 합니다.

`/compose`로 해당 Agent를 선택하면 기존 터미널로 돌아갑니다. Child에서는 **Main으로 돌아가기**를 선택해 정확한 원본 창으로 복귀합니다. 새 Agent를 중복 실행하지 않습니다.

### 4. 실제 코드 변경을 확인합니다

`/compose` → 작업 선택 → **Git 변경 검토**를 선택합니다.

선택한 Worktree의 브랜치와 생성 당시 Git 기준 커밋을 다시 확인한 뒤, 변경·미추적 파일 목록과 Git Diff를 읽습니다. **Handoff는 필요하지 않습니다.** 긴 Diff는 축약해 표시하며, 미추적 파일의 내용은 Diff에 포함하지 않는다고 알려줍니다. 코드를 병합하거나 Worktree를 삭제하지 않습니다.

원하면 개발 Agent의 `/compose-handoff`와 `/compose-verify`로 별도 인계·독립 검증을 실행할 수 있습니다. 이 기록은 실제 Git Diff와 다른 **주장/검증 증거**로 취급합니다.

### 5. 이전 대화를 이어갑니다

같은 프로젝트의 저장된 Pi 대화는 `/compose sessions`에서 찾거나 Pi 기본 `/resume`에서 고릅니다. 실행 중인 Agent로 이동하는 것과 저장된 대화를 재개하는 것은 다른 작업입니다. 별도 대화 DB를 만들지 않습니다.

## 무슨 도구가 무엇을 하나요?

| 도구 | 담당 |
| --- | --- |
| **Pi** | 모델·인증·세션·Fork/Resume·Extension·대화 |
| **Pi Compose** | 명시적 위임과 승인·원본 계보·Child/작업 공간 연결·안전한 복귀 |
| **Git** | Worktree·브랜치·기준 커밋·실제 코드 변경 |
| **tmux / workmux** | 실행 창·Worktree 시작·관찰·터미널 복귀 |

원본 Pi 세션의 작업 경로가 Git 루트와 다르면 workmux의 세션 탐색 제약을 피하기 위해 **Git Worktree 생성 + Pi의 공식 `--fork <정확한 JSONL 파일>` + tmux** 경로를 사용합니다. 이때도 명시적인 실행 승인과 안전한 재시도 원칙은 동일합니다.

`pic diagnostics export --days 1`로 오류 단계 및 익명화된 연결 이벤트를 내보낼 수 있습니다. 프롬프트, 실제 프로젝트 경로, Git Diff, API 키는 진단 파일에 포함하지 않습니다.

**자세히:** [실제 사용법](docs/USAGE.md) · [설치·업데이트](docs/SETUP.md) · [레퍼런스 기반 설계 근거](docs/REFERENCE_LED_DESIGN.md) · [실사용 수용 시나리오](docs/SCENARIOS.md)

> **검증 범위:** 이 버전은 GitHub 브랜치에 구현이 반영된 상태입니다. 실제 macOS 인증 모델, tmux/workmux 및 Ghostty에서 전체 End-to-End 개발 위임 성공은 아직 증명되지 않았습니다. 코드를 반영했다는 사실을 실사용 검증으로 대체하지 않습니다.
