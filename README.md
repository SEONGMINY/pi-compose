# Pi Compose

**Keep the reasoning. Delegate the work.**

Pi Compose는 Main의 요구사항과 설계 이유를 이어받아 다른 개발 Agent를 실행하는 [Pi](https://github.com/earendil-works/pi) 기반 Harness입니다.

Main에서 충분히 논의한 뒤, **그 대화를 Fork해서 개발하거나**, 맥락이 필요 없는 탐색·테스트는 **Independent Agent**에게 맡길 수 있습니다. 작업 관찰과 터미널 관리는 Git·tmux·[workmux](https://workmux.dev/)가 담당합니다.

## 시작하기

macOS, Node.js 22.19 이상, Pi, tmux, workmux가 필요합니다.

\`\`\`bash
# main의 안정 설치/업데이트
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash

cd ~/projects/my-app
pic
\`\`\`

PR #3의 **아직 머지되지 않은 개발 버전**을 사용하려면 위 명령 대신 다음을 실행하세요.

\`\`\`bash
npm install -g --ignore-scripts --no-audit --no-fund \
  "git+https://github.com/SEONGMINY/pi-compose.git#feat/task-hub-ghostty"
\`\`\`

\`pic\`은 프로젝트별 tmux 세션을 재사용합니다. 이미 tmux 안에서는 세션을 중첩하지 않습니다. 최초 Pi 인증은 \`/login\`, 모델 선택은 \`/model\`입니다. 기존 Pi 로그인과 대화 기록을 재사용합니다.

**Worktree 안의 개발 Agent에서도 Compose 명령과 자연어 위임을 사용하려면** 아래 명령을 최초 한 번 실행하세요.

\`\`\`bash
pic navigation enable
\`\`\`

기존에 실행한 Pi에서는 \`/reload\`가 필요합니다. 설치된 Extension을 전역 Pi 설정에서 해제하려면 \`pic navigation disable\`을 실행합니다.

## 실제 개발 흐름

**1. Main에서 요구사항을 논의합니다.**

> 회원 API를 만들자. 클라이언트 호환성 때문에 기존 토큰 갱신 방식은 절대 변경하지 마.

**2. 명시적으로 위임합니다.** 자연어도 명령어와 동일하게 실제 실행 승인 단계로 연결됩니다.

\`\`\`text
지금 논의한 회원 API 구현을 새 Agent에게 맡겨줘.
현재 대화를 Fork하고 별도 Worktree에서 개발해 줘.
\`\`\`

또는 모델의 추가 설명 없이 직접 선택합니다.

\`\`\`text
/compose launch 회원 API 구현
\`\`\`

Context(**Fork / Independent**)와 Workspace(**Shared / Worktree**)는 서로 독립적으로 선택할 수 있습니다. 원본 Pi 세션, 브랜치, 실제 위임 지시를 검토하고 승인해야 Agent/Worktree가 만들어집니다. 계획만 확인하려면 \`/compose preview\`를 사용하세요.

**3. Main에서 계속 개발합니다.** 위임 명령이 성공한 것과 Agent가 실제 작업을 수행하거나 완료한 것은 다릅니다.

**4. 필요한 작업만 찾거나, 전체 현황을 관찰합니다.**

| 하고 싶은 일 | 실행 | 실제 담당 |
| --- | --- | --- |
| 원래 Main 또는 관련 Agent 찾기 | \`/compose\` | Pi Compose · 정확한 tmux 창 |
| 여러 프로젝트의 Agent 상태·출력 확인 | \`/compose monitor\` | workmux Dashboard |
| 이전에 프로필·결제 등 기능을 논의한 대화 찾기 | \`/compose sessions\` | Pi의 기존 저장 대화 |
| 기존 고급 작업 탐색·명시적 Resume | \`/compose back\`, \`/compose resume\` | Pi / workmux / tmux |

\`/compose\`는 Pi의 기본 선택 UI를 사용합니다. **현재 위치와 원래 Main**, 생성 순서가 유지되는 **관련 Agent**, **새 위임**, **전체 현황**, **이전 대화**만 제공합니다. Agent를 선택하면 **기존 창으로 이동**, **정확한 위임 지시 보기**, **인계·검토 결과 보기** 중 하나를 고릅니다. 이미 실행 중인 Pi를 중복 시작하지 않습니다.

macOS에서 \`Option+W\`가 동작하지 않더라도 **\`/compose\`를 기본 명령으로 사용**할 수 있습니다.

**5. Agent 결과를 확인합니다.**

선택형 Handoff/Verify Extension을 사용하려면:

\`\`\`bash
pic features
\`\`\`

Agent에서 다음을 실행합니다.

\`\`\`text
/compose-handoff
/compose-verify main
\`\`\`

Handoff에는 구현 내용, 원래 이유와 강한 제약, 실제 검사, 미해결 사항을 정리합니다. Verify는 **별도의 읽기 전용 Pi 실행**으로 Git 변경과 계약을 확인합니다. Worktree 경로와 브랜치가 Pi Compose가 시작한 작업 **단 하나에 정확히 일치하면**, Main의 \`/compose\` → 해당 작업 → **인계·검토 결과 확인**에서 이동 없이 보고서를 읽을 수 있습니다.

Handoff는 개발자의 주장이고 검토 결과도 자동 승인이나 Git 병합이 아닙니다. Shared Directory의 변경을 특정 Agent의 작업으로 추측해 귀속하지 않습니다. Main의 대화에 긴 로그를 자동 주입하지 않습니다.

## workmux Dashboard

\`/compose monitor\`는 tmux 안에서 기존 workmux Dashboard를 엽니다. Dashboard는 작업 목록, 실행 출력 미리보기, Git 변경 정보, 프로젝트 간 탐색을 지원합니다.

**Pi Agent가 Dashboard에 표시되려면 workmux의 상태 Hook이 필요합니다.** 사용자가 직접 선택해 설정하세요.

\`\`\`bash
workmux setup
\`\`\`

Pi와 workmux를 재시작하거나 새 Agent를 실행해야 Hook을 인식할 수 있습니다. Pi의 *작업 중/최근 응답 종료*와 **실제 구현 완료, 인계, 검증, 코드 통합**은 다릅니다. Pi의 사용자 입력 대기 상태는 Hook만으로 항상 알 수 없습니다.

Dashboard는 workmux에 등록되지 않은 Shared Directory Pi 세션을 모두 찾는 기능이 아닙니다. 이런 Agent와 원래 Main은 \`/compose\`로 탐색합니다. Dashboard에서의 Worktree 제거·Agent 종료 기능은 workmux가 제공하는 사용자 직접 조작이며 Pi Compose가 자동 실행하지 않습니다.

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
