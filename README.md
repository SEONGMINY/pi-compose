# Pi Compose

Pi에서 요구사항과 설계를 충분히 논의한 뒤, **그 대화는 유지하고 개발만 다른 에이전트에게 맡기고 싶을 때**가 있어요. 별도로 실행한 에이전트에게 설계 배경을 다시 설명하거나, Git Worktree와 터미널을 준비하는 일은 반복하기 번거롭습니다.

**Pi Compose는 Pi에서 개발 작업을 분리해 실행하고, 이전 작업을 다시 찾아갈 수 있게 도와주는 도구예요.** 기존 대화를 Fork해 설계 맥락을 이어받을 수도 있고, 맥락이 필요 없는 작업은 새 세션에서 시작할 수도 있어요. Git Worktree와 tmux 실행도 선택한 방식에 맞춰 연결합니다.

## 실제로 사용하는 모습

Main에서 API 변경을 논의하면서 기존 클라이언트의 호환성을 위해 `label` 필드를 유지하기로 결정했다고 해볼게요. 설계를 마쳤다면 같은 내용을 새 에이전트에게 길게 다시 설명하지 않고 개발을 시작할 수 있어요.

```text
/compose launch 앞서 합의한 API 변경을 구현해줘
```

Pi Compose가 **어떤 대화를 이어받을지**, **어느 작업 공간에서 개발할지** 물어봅니다. 여기서는 `Fork existing Pi session`과 `Git Worktree`를 선택하고, 원본으로 `Current Pi session`을 지정합니다.

새 Git Worktree와 tmux 창에서 Pi가 기존 대화를 Fork해 개발을 시작해요. 원래 Main 대화는 그대로 남아 있습니다.

![실제 녹화: Fork된 개발 에이전트가 기존 호환성 제약을 확인한 뒤 코드를 수정하고 테스트하는 모습](docs/assets/compose-fork-working.jpg)

개발 에이전트의 작업을 확인한 뒤에는 **tmux에서 원래 Main 창으로 돌아와** 설계 대화를 이어갈 수 있어요. Fork된 작업 때문에 Main의 대화가 새 개발 로그로 채워지지 않습니다.

![실제 녹화: Main 창으로 돌아온 뒤 앞서 합의한 호환성 제약과 이유를 다시 설명하는 모습](docs/assets/compose-main-return.jpg)

화면은 실제 macOS 사용 녹화에서 해당 장면만 잘라낸 것입니다. 예시는 하나의 작업을 Fork한 결과이며, 여러 개발 에이전트의 상태를 한 화면에서 자동 관리하는 기능을 보여주는 것은 아닙니다.

### 다른 작업이라면?

코드 탐색이나 테스트처럼 이전 대화가 필요 없다면 `Independent new session`을 선택하면 돼요. 같은 디렉터리를 사용할 수도 있고, 파일 변경을 분리하려면 Git Worktree를 선택할 수도 있습니다.

이미 진행한 작업을 다시 찾을 때는 `/compose back`으로 현재 프로젝트의 저장된 Pi 대화와 workmux 작업을 탐색할 수 있어요. **원래 Main tmux 창으로 돌아가는 것과 저장된 작업을 찾는 것은 다른 동작**입니다.

## Pi와 workmux만 사용할 때와 무엇이 다른가요?

Pi에는 대화를 Fork하는 기능이 있고, workmux에는 Worktree에서 에이전트를 실행하는 기능이 이미 있어요. 두 도구를 직접 사용할 수도 있습니다.

그때는 **어느 Pi 세션을 Fork할지 확인하고**, 작업에 맞는 실행 옵션을 준비해 workmux나 tmux 명령을 사용해야 해요. Pi Compose에서는 **Pi 대화 안에서 `/compose launch`를 실행해 원본 대화와 작업 공간을 선택**합니다. 세션을 찾고 실행 명령을 조합하는 반복 작업을 줄이는 방식이에요.

Pi Compose가 모든 작업을 자동으로 분배하거나 완료 여부를 판정하는 것은 아닙니다. **어떤 일을 분리할지, 언제 코드를 합칠지는 개발자가 결정합니다.**

## 설치 및 첫 실행

현재 macOS에서 설치할 수 있어요. Node.js 22.19.0 이상이 필요합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

Git 프로젝트로 이동해 tmux에서 `pic`을 실행하세요.

```bash
cd /path/to/your-project
tmux new-session -s pic-work pic
```

기존 tmux 안에서 실행한다면 `pic`만 입력하면 됩니다. 처음 Pi를 사용한다면 `/login`으로 로그인하고 `/model`에서 모델을 선택하세요. 설치 도중 tmux나 workmux가 필요하면 Homebrew를 이용하므로 Homebrew가 준비돼 있어야 합니다.

**사용 전 확인:** Git Worktree는 커밋을 기준으로 생성되므로 현재 디렉터리의 미커밋 변경은 새 Worktree에 복사되지 않아요. 같은 디렉터리에서 여러 에이전트를 실행하면 변경 사항이 겹칠 수 있습니다.

작업 인계(Handoff), 독립 검토(Verify), workmux Dashboard가 필요하다면 `pic features`로 선택형 기능을 설치하고 Pi 설정 화면에서 켜고 끌 수 있어요. [사용 가이드](docs/USAGE.md)에는 명령과 옵션, 작업 탐색 방법을, [설계 문서](docs/README.md)에는 구현 배경과 제약을 정리했습니다.
