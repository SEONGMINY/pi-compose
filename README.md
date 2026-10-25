# Pi Compose

Pi에서 새 코딩 에이전트를 실행할 때, **이전 대화를 이어받을지와 코드를 어디에서 수정할지 한 번에 선택할 수 있어요.**

설계를 오래 논의했는데 새 에이전트에게 배경을 다시 설명하고 싶지 않을 때가 있어요. 반대로 코드 탐색이나 테스트처럼 이전 대화가 필요 없는 작업도 있죠. Pi Compose는 [Pi](https://github.com/earendil-works/pi)의 세션 기능과 Git, tmux, [workmux](https://github.com/raine/workmux)를 연결해 이런 작업을 Pi 안에서 시작할 수 있게 해줘요.

## 사용 예시

Pi에서 요구사항과 구현 방향을 논의한 뒤, 개발 작업을 다른 에이전트에게 맡겨보세요.

```text
/compose launch 앞서 논의한 변경 사항을 구현해줘
```

실행할 때 두 가지를 선택해요.

- **이전 대화를 이어받을까요?** `Fork`를 선택하면 지정한 Pi 대화를 분기해 새 에이전트를 시작해요. 기존 대화와 관계없는 작업이라면 `Independent`로 시작할 수 있어요.
- **어디에서 작업할까요?** `Git Worktree`를 선택하면 별도 브랜치와 작업 디렉터리에서 개발해요. `Shared Directory`를 선택하면 현재 디렉터리를 함께 사용해요.

예를 들어 `Fork → Git Worktree → Current Pi session`을 선택하면, 원래 대화는 남겨두고 새로운 Pi 세션에서 기존 논의를 이어받아 개발할 수 있어요. 새 Worktree와 실행 창을 준비하는 과정은 Pi Compose가 연결해 줍니다.

이전에 진행한 작업을 다시 찾고 싶다면 `/compose back`을 사용할 수 있어요. 현재 프로젝트에 저장된 Pi 대화와 workmux 작업을 찾아볼 수 있습니다.

## 시작하기

macOS에서 설치할 수 있어요.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
```

작업할 프로젝트로 이동한 뒤 tmux에서 실행하세요.

```bash
cd /path/to/your-project
tmux new -s pic-work
pic
```

이미 tmux를 사용 중이라면 새 세션을 만들 필요는 없어요. 처음 Pi를 사용한다면 `/login`으로 로그인하고 `/model`에서 모델을 선택하세요. Node.js 22.19.0 이상이 필요해요. tmux나 workmux가 없다면 설치 스크립트가 Homebrew를 사용하므로 Homebrew가 준비돼 있어야 합니다. [설치 관련 안내](docs/adr/0006-github-installer.md)

## Pi와 무엇이 다른가요?

Pi에는 이미 세션 Fork와 Resume이 있고, workmux는 Git Worktree와 에이전트 실행을 지원해요. Pi Compose는 이 기능을 새로 만드는 대신, **Pi 화면에서 대화와 작업 공간을 선택하고 실행하는 과정**을 연결해요.

기본 기능 외에 Dashboard, 작업 인계(Handoff), 별도 검증(Verify)이 필요하다면 `pic features`로 추가할 수 있어요.

## 알아둘 점

Git Worktree는 Git 저장소에서만 사용할 수 있고, 커밋을 기준으로 만들어져요. 원래 작업 디렉터리에서 **아직 커밋하지 않은 변경사항은 새 Worktree로 복사되지 않습니다.** Shared Directory를 여러 에이전트가 함께 수정할 때는 파일 변경이 겹치지 않도록 주의하세요.

작업을 시작하고 Git 변경사항을 병합하는 시점은 사용자가 결정해요. Pi Compose가 작업 완료나 병합까지 자동으로 처리하지는 않아요.

자세한 명령어와 옵션은 [사용 가이드](docs/USAGE.md)에서, 프로젝트를 이렇게 설계한 이유는 [설계 문서](docs/README.md)에서 확인할 수 있어요.
