# Pi Compose

**Keep the reasoning. Delegate the work.**

Pi Compose는 Main의 요구사항과 설계 이유를 이어받아 다른 개발 Agent를 실행하는 [Pi](https://github.com/earendil-works/pi) 기반 Harness입니다.

Main에서 충분히 논의한 뒤, **그 대화를 Fork해서 개발하거나**, 맥락이 필요 없는 탐색·테스트는 **Independent Agent**에게 맡길 수 있습니다. 작업 관찰과 터미널 관리는 Git·tmux·[workmux](https://workmux.dev/)가 담당합니다.

## 설치와 최초 설정

macOS에서는 [공식 설치 스크립트](scripts/install.sh)를 사용합니다. 이 명령은 현재 **main** 버전을 설치하며, Draft PR #3의 설정 통합 기능은 머지 후 적용됩니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

아직 Draft인 **PR #3**을 사용하려면 다음 **같은 설치 스크립트의 개발 브랜치 버전**을 사용합니다. 이 경로는 공식 설치와 동일하게 Node.js·Pi·tmux·workmux 누락 및 `pic` 실행 파일 충돌을 확인합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/feat/task-hub-ghostty/scripts/install.sh \
  | PIC_COMPOSE_REF=feat/task-hub-ghostty bash
```

이미 의존성이 준비됐다면 이전의 직접 npm 설치도 지원합니다. `--ignore-scripts`로 설치해도 최초 설정은 npm Hook이 아니라 `pic`에서 실행됩니다.

```bash
npm install -g --ignore-scripts --no-audit --no-fund \
  "git+https://github.com/SEONGMINY/pi-compose.git#feat/task-hub-ghostty"
```

```bash
cd ~/projects/my-app
pic
```

최초 대화형 `pic` 실행에서 **Navigation, Handoff, Verify를 별도 선택 없이 자동 준비**합니다. 외부 workmux 상태 Hook만 타 에이전트에도 영향을 줄 수 있으므로 별도 승인을 받고 공식 `workmux setup --hooks` 설정 화면으로 연결합니다. 사용자가 이전에 명시적으로 비활성화한 항목은 재활성화하지 않습니다.

진단 이벤트는 **기본 로컬 수집**이며 프롬프트·코드·Git Diff·실제 경로를 저장하지 않습니다. 끄려면 `pic diagnostics off`, 공유할 보고서를 만들려면 `pic diagnostics export`를 사용합니다.

```bash
pic doctor              # 설정/의존성 읽기 전용 확인
pic setup               # 누락 항목 명시적 재설정
pic diagnostics export  # 최근 7일 UX 데이터 + 집계 JSON 1개 생성
```

**[진단 이벤트·지표·보존 정책](docs/UX_DIAGNOSTICS.md)** · **[설치·업데이트](docs/SETUP.md)** · **[실전 시나리오 5개](docs/SCENARIOS.md)**

기존 Pi 설정, Extension, Skill, 세션은 유지합니다. 사용자가 비활성화한 기능은 재설치나 업데이트로 강제 활성화하지 않습니다. 최초 모델 연결은 Pi에서 `/login`, `/model`을 사용합니다.

## 실제 개발 흐름

**1. Main에서 요구사항을 논의합니다.**

> 회원 API를 만들자. 클라이언트 호환성 때문에 기존 토큰 갱신 방식은 절대 변경하지 마.

**2. 명시적으로 위임합니다.** 자연어도 명령어와 동일하게 실제 실행 승인 단계로 연결됩니다.

```text
지금 논의한 회원 API 구현을 새 Agent에게 맡겨줘.
현재 대화를 Fork하고 별도 Worktree에서 개발해 줘.
```

또는 모델의 추가 설명 없이 직접 선택합니다.

```text
/compose launch 회원 API 구현
```

Context(**Fork / Independent**)와 Workspace(**Shared / Worktree**)는 서로 독립적으로 선택할 수 있습니다. 원본 Pi 세션, 브랜치, 실제 위임 지시를 검토하고 승인해야 Agent/Worktree가 만들어집니다. 계획만 확인하려면 `/compose preview`를 사용하세요.

**3. Main에서 계속 개발합니다.** 위임 명령이 성공한 것과 Agent가 실제 작업을 수행하거나 완료한 것은 다릅니다.

**4. 필요한 작업만 찾거나, 전체 현황을 관찰합니다.**

| 하고 싶은 일 | 실행 | 실제 담당 |
| --- | --- | --- |
| 원래 Main 또는 관련 Agent 찾기 | `/compose` | Pi Compose · 정확한 tmux 창 |
| 여러 프로젝트의 Agent 상태·출력 확인 | `/compose monitor` | workmux Dashboard |
| 이전에 프로필·결제 등 기능을 논의한 대화 찾기 | `/compose sessions` | Pi의 기존 저장 대화 |
| 기존 고급 작업 탐색·명시적 Resume | `/compose back`, `/compose resume` | Pi / workmux / tmux |

`/compose`는 Pi의 기본 선택 UI를 사용합니다. **현재 위치와 원래 Main**, 생성 순서가 유지되는 **관련 Agent**, **새 위임**, **전체 현황**, **이전 대화**만 제공합니다. Agent를 선택하면 **기존 창으로 이동**, **정확한 위임 지시 보기**, **인계·검토 결과 보기** 중 하나를 고릅니다. 이미 실행 중인 Pi를 중복 시작하지 않습니다.

macOS에서 `Option+W`가 동작하지 않더라도 **`/compose`를 기본 명령으로 사용**할 수 있습니다.

**5. Agent 결과를 확인합니다.**

Handoff와 Verify는 최초 기본 설정에서 준비되므로 별도 활성화 명령이 필요하지 않습니다. 기존에 실행 중이던 Pi에 기능이 보이지 않으면 `/reload` 후 확인하세요.

Agent에서 다음을 실행합니다.

```text
/compose-handoff
/compose-verify main
```

Handoff에는 구현 내용, 원래 이유와 강한 제약, 실제 검사, 미해결 사항을 정리합니다. Verify는 **별도의 읽기 전용 Pi 실행**으로 Git 변경과 계약을 확인합니다. Worktree의 경로·브랜치 또는 확인된 Child Pi 세션 ID가 Pi Compose가 시작한 작업 **단 하나에 정확히 일치하면**, Main의 `/compose` → 해당 작업 → **인계·검토 결과 확인**에서 이동 없이 보고서를 읽을 수 있습니다.

Handoff는 개발자의 주장이고 검토 결과도 자동 승인이나 Git 병합이 아닙니다. Shared Directory의 변경을 특정 Agent의 작업으로 추측해 귀속하지 않습니다. Main의 대화에 긴 로그를 자동 주입하지 않습니다.

## workmux Dashboard

`/compose monitor`는 tmux 안에서 기존 workmux Dashboard를 엽니다. Dashboard는 작업 목록, 실행 출력 미리보기, Git 변경 정보, 프로젝트 간 탐색을 지원합니다.

**Pi Agent가 Dashboard에 표시되려면 workmux의 상태 Hook이 필요합니다.** 신규 설치 시 최초 `pic`이 별도로 동의를 구하고 `workmux setup --hooks`를 열어줍니다. 해당 과정을 건너뛰었다면 `pic setup`에서 다시 설정할 수 있습니다.

Pi와 workmux를 재시작하거나 새 Agent를 실행해야 Hook을 인식할 수 있습니다. Pi의 *작업 중/최근 응답 종료*와 **실제 구현 완료, 인계, 검증, 코드 통합**은 다릅니다. Pi의 사용자 입력 대기 상태는 Hook만으로 항상 알 수 없습니다.

Dashboard는 workmux에 등록되지 않은 Shared Directory Pi 세션을 모두 찾는 기능이 아닙니다. 이런 Agent와 원래 Main은 `/compose`로 탐색합니다. Dashboard에서의 Worktree 제거·Agent 종료 기능은 workmux가 제공하는 사용자 직접 조작이며 Pi Compose가 자동 실행하지 않습니다.

## Pi와 역할을 나누는 기준

| 담당 | 하는 일 |
| --- | --- |
| **Pi** | 모델, 기존 대화·Fork·Resume, 기본 TUI |
| **Pi Compose** | 명시적인 위임 옵션, 승인, 원본 Main 관계, 정확한 작업 복귀, 인계 증거 연결 |
| **Git** | 코드 변경, Worktree, Diff |
| **tmux / workmux** | 실행 창, 프로젝트 간 작업 관찰·전환·출력 미리보기 |

Pi Compose는 자체 Agent Runtime·대화 DB·상시 모니터링 데몬을 만들지 않습니다. Ghostty 전용 탭 자동 제어도 더 이상 기본 기능에 포함하지 않습니다. 터미널 자체의 탭/창과 workmux의 기존 탐색 기능을 활용합니다.

[상세 사용법](docs/USAGE.md) · [설계 결정](docs/adr/0007-reference-led-navigation.md) · [수동 사용 검증표](docs/validation/task-hub-ux.md)

<sub>현재 PR #3은 Draft입니다. 전체 macOS/Ghostty/인증된 Pi 모델 실사용 흐름은 별도 검증이 필요합니다. 자동 테스트 통과만으로 UX가 검증됐다고 주장하지 않습니다.</sub>
