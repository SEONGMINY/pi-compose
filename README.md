# Pi Compose

Pi에서 설계를 논의하다 보면, 기존 대화는 남겨두고 개발만 다른 에이전트에게 맡기고 싶을 때가 있어요. 새로운 에이전트를 실행하려고 세션을 찾고, Git Worktree를 만들고, 터미널 창까지 준비하는 일은 번거롭고요.

**Pi Compose는 Pi에서 새 코딩 에이전트를 실행하고 이전 작업으로 돌아가는 과정을 연결하는 도구예요.** 기존 대화를 이어받아 개발하거나, 맥락이 필요 없는 작업을 독립적으로 시작할 수 있습니다. 어떤 작업을 어디에서 실행할지는 직접 선택해요.

## 어떤 작업에 사용할 수 있나요?

| 상황 | Pi Compose에서 할 수 있는 일 |
| --- | --- |
| Main에서 요구사항과 예외를 오래 논의했고, 그 내용을 바탕으로 구현을 맡기고 싶을 때 | **기존 Pi 대화를 Fork**해 별도 에이전트를 시작합니다. 원래 대화는 유지돼요. |
| 코드 탐색이나 테스트처럼 이전 대화가 필요 없는 작업을 분리하고 싶을 때 | **독립 세션**으로 시작합니다. 필요하면 개발 작업과 별도 디렉터리를 사용할 수도 있어요. |
| 여러 작업을 진행하다 이전 대화나 Worktree로 돌아가고 싶을 때 | **`/compose back`**으로 현재 프로젝트에 저장된 Pi 대화와 workmux 작업을 찾을 수 있어요. |

## 실제로 사용해 보면

예를 들어 Main에서 API 변경을 논의하면서 *기존 필드는 호환성 때문에 유지한다*는 조건을 확정했다고 가정해 볼게요.

이어서 Main의 Pi 입력창에서 개발 작업을 실행합니다.

```text
/compose launch 앞서 논의한 API 변경을 구현해줘
```

Pi Compose가 선택 화면을 엽니다. 이 경우에는 **Fork existing Pi session → Git Worktree → Current Pi session**을 선택하고 새 브랜치 이름을 입력하면 돼요.

- Pi가 기존 대화를 Fork해 새 개발 세션을 시작합니다. 구현 에이전트에게 설계 배경을 처음부터 다시 설명할 필요가 줄어듭니다.
- workmux는 별도 Git Worktree와 tmux 창을 준비합니다. 새 에이전트가 작업하는 동안 원래 Main 대화는 그대로 남습니다.
- 새 창에서 에이전트의 작업과 변경 결과를 확인하고, tmux 창을 전환해 Main에서 하던 논의를 이어갈 수 있어요.

아래는 실제로 Fork + Worktree를 실행한 뒤 개발 에이전트가 기존 호환성 조건을 확인하고 작업한 화면입니다.

![Fork한 개발 에이전트가 기존 API 호환성 조건을 유지한 채 변경 내용을 보고하는 실제 Pi 화면](docs/assets/fork-agent-result.jpg)

<sub>실제 사용 녹화에서 작업 결과 부분만 잘라낸 화면입니다. Pi Compose는 작업을 시작하지만, 코드 검토와 Git 병합 여부는 사용자가 결정합니다.</sub>

Pi 자체에도 세션 Fork 기능이 있고, workmux도 Worktree에서 에이전트를 실행할 수 있습니다. **Pi Compose가 추가하는 부분은 Pi 안에서 실행할 대화와 작업 공간을 선택하고, 기존 도구들을 연결해 작업을 시작하는 흐름**입니다.

## 설치하고 시작하기

macOS에서 사용할 수 있어요. Node.js 22.19.0 이상이 필요합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

프로젝트 디렉터리에서 `pic`을 실행하면 됩니다. Git Worktree 작업을 시작하려면 tmux 안에서 실행하세요.

```bash
cd /path/to/project
tmux new-session -s pic-work pic
```

이미 tmux 안에 있다면 새 세션을 만들 필요는 없어요. 처음 Pi를 사용한다면 `/login`으로 로그인하고 `/model`에서 모델을 선택하세요. 설치 스크립트는 필요한 tmux와 workmux를 Homebrew로 설치할 수 있지만, Homebrew 자체는 설치하지 않습니다.

## 더 필요한 기능

기본 기능 외에 **workmux Dashboard**, 작업 결과 정리(**Handoff**), 별도 코드 검토(**Verify**)가 필요하다면 `pic features`로 선택형 기능을 설치할 수 있어요.

Worktree는 커밋을 기준으로 생성되므로 기존 디렉터리의 **미커밋 변경사항은 새 Worktree에 복사되지 않습니다.** 같은 디렉터리에서 여러 에이전트를 실행하면 파일 변경이 겹칠 수 있고요. Pi Compose가 여러 에이전트의 상태를 하나의 화면에서 자동 관리하거나 변경 사항을 병합해 주지는 않습니다.

[사용 가이드](docs/USAGE.md)에서 다른 실행 방법, 작업 복귀, 선택형 기능을 확인할 수 있어요. [설계 문서](docs/README.md)에는 구현 배경과 판단 근거를 정리했습니다.
