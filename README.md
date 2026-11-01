# Pi Compose

**설계를 논의하던 [Pi](https://github.com/earendil-works/pi) 대화는 그대로 두고, 그 맥락을 이어받은 다른 에이전트에서 개발할 수 있어요.**

AI와 요구사항을 논의할 때는 무엇을 만들지뿐 아니라 **왜 그렇게 결정했는지**, 어떤 대안을 제외했는지, 무엇을 절대 바꾸면 안 되는지도 함께 정합니다.

새 에이전트에게 이 내용을 짧게 요약해서 전달하면 중요한 이유나 제약이 빠질 수 있어요. 반대로 한 대화에서 구현·테스트·디버깅까지 모두 진행하면 코드 탐색 결과와 오류 로그가 쌓여 다음 설계를 논의하기 어려워집니다.

Pi Compose는 **원래 대화를 유지하고, 필요한 작업만 별도 Pi 세션으로 분리**합니다.

![Pi Compose에서 제품별 Main·Work·Support를 탐색하고 실제 Ghostty Split으로 전환하는 화면](docs/assets/demo/pi-compose-overview.gif)

*프로덕트별로 에이전트를 살펴보고, 작업 중인 Pi 화면으로 이동하는 Overview.*

## 실제로 어떻게 개발하나요?

예를 들어 프로필 API에 새 필드인 `displayName`을 추가한다고 해볼게요.

### 1. Main에서 설계와 제약을 정합니다

Main에서는 새 필드가 필요한 이유와 기존 클라이언트에 미칠 영향을 논의합니다. 이 과정에서 **이전 클라이언트의 호환성을 위해 `label` 필드는 제거하지 않기로** 결정했어요.

이제 구현할 차례입니다. 하지만 그 이유까지 다시 설명한 새 프롬프트를 만들 필요는 없어요.

### 2. 기존 대화를 Fork해 Work에서 구현합니다

Main의 Pi 입력창에서 작업을 요청합니다.

```text
>>w 앞서 합의한 프로필 API 변경을 구현해줘. 기존 클라이언트 호환성도 유지해줘.
```

`>>w`는 **현재 Pi 대화를 실제로 Fork한 Work**를 만들고, **별도 Git Worktree**에서 코드를 수정하도록 요청하는 단축 명령입니다.

Work는 새 세션이지만 앞서 논의한 설계의 이유와 제약을 이어받습니다. 구현 과정에서 발생하는 긴 도구 출력이나 테스트 기록은 Work에 남고, Main에는 자동으로 추가되지 않아요.

![Main의 대화를 Fork한 Work가 별도 Git Worktree에서 기존 호환성 제약을 지키며 개발하는 화면](docs/assets/demo/pi-compose-work-fork.gif)

*같은 설계 맥락을 이어받아 개발하지만, 실행 기록과 파일 변경은 분리됩니다.*

### 3. Main으로 돌아와 다음 결정을 이어갑니다

Overview에서 원래 Main을 선택하면 **기존 Pi 대화로 돌아갑니다.** Work의 코드 변경이나 로그가 Main 대화에 자동으로 복사되지는 않아요.

Work에서 다른 에이전트도 알아야 할 사실이 나왔다면, 사용자가 전달할 내용과 받는 에이전트를 직접 고릅니다. 현재는 Pi의 `/compose handoff` 명령으로 원본 메시지를 확인하고 전송을 요청하는 경로가 준비돼 있습니다.

![Work에서 전달할 내용을 선택하고 기존 Main 대화로 돌아오는 화면](docs/assets/demo/pi-compose-main-handoff.gif)

*구현은 Work에 남기고, 다음 판단에 필요한 내용만 선택해서 공유합니다.*

## 작업에 맞는 에이전트를 사용하세요

| 에이전트 | 어떤 일을 하나요? | 대화 맥락 |
| --- | --- | --- |
| **Main** | 요구사항, 설계, 제약, 중요한 결정과 그 이유를 논의 | 원본 Pi 세션 |
| **Work** | 설계 맥락이 필요한 기능 개발, 수정, 테스트 코드 작성 | 선택한 Pi 대화의 **완료된 지점을 Fork** |
| **Support** | 코드 탐색, 자료 조사, 테스트 실행 등 독립 작업 | 기존 대화를 상속하지 않는 새 Pi 세션 |

Work와 Support는 필요할 때 사용자가 직접 만듭니다. Main만 개발을 지휘하는 구조가 아니어서 Work에서도 다른 Work나 Support를 요청할 수 있어요.

### 컨텍스트와 작업 디렉터리는 별개입니다

**어떤 대화를 이어받을지(Context)**와 **어디에서 파일을 수정할지(Workspace)**는 서로 다른 선택이에요.

| | 현재 디렉터리 공유 | 새 Git Worktree |
| --- | --- | --- |
| **Work · 대화 Fork** | `>w 작업 내용` | `>>w 작업 내용` |
| **Support · 독립 대화** | `>s 작업 내용` | `>>s 작업 내용` |

다른 Pi 대화를 Fork하려면 `>w @세션검색어 작업 내용`처럼 입력해 **같은 프로덕트의 세션을 직접 선택**할 수도 있어요.

Git Worktree는 명령을 입력한 에이전트의 현재 Git `HEAD`에서 새 브랜치와 작업 디렉터리를 만듭니다. **원래 디렉터리의 미커밋 변경은 복사되지 않고**, Git 병합이나 Worktree 정리도 자동으로 수행하지 않습니다. 같은 디렉터리를 공유하는 작업은 파일 변경이 겹치지 않도록 직접 관리해야 해요.

## Pi와 무엇이 다른가요?

[Pi](https://github.com/earendil-works/pi)는 세션 Fork와 Extension으로 필요한 동작을 구성할 수 있는 코딩 에이전트입니다. Pi Compose는 이를 대체하는 새로운 Agent 런타임이 아니에요.

Pi Compose에서는 **대화를 유지하는 방법과 여러 Pi 작업을 탐색·실행·전환하는 흐름**을 Ghostty와 Pi Extension으로 묶습니다.

- `pic` Overview에서 프로덕트별 Main·Work·Support와 메시지 기록을 탐색합니다.
- 에이전트마다 독립적인 **실제 Pi TUI와 Ghostty Split**을 사용합니다. 다른 에이전트 화면을 복제하지 않아요.
- Main의 대화를 Fork하더라도 Work의 실행 기록을 원본 Main에 자동으로 넣지 않습니다.
- 공유할 내용과 받는 에이전트는 **사용자가 선택**합니다.

별도 데스크톱 GUI나 tmux·workmux·Orca 런타임을 사용하지 않습니다. **Pi의 기존 기능을 최대한 유지하면서 필요한 관리 경험을 더하는 것**이 목표입니다.

## 설치와 시작

현재 개발 대상은 **macOS + Ghostty**입니다. Node.js **22.19.0 이상**, Git, [Pi](https://github.com/earendil-works/pi)가 필요합니다.

현재 버전은 **실사용 통합 검증 전인 개발 버전**입니다. 아래는 수동 설치 경로이며, 기존 `scripts/install.sh`는 이전 tmux/workmux 의존성이 남아 있어 새 Ghostty 전용 설치 방법으로 안내하지 않습니다.

```bash
# Pi를 아직 설치하지 않았다면
npm install -g @earendil-works/pi-coding-agent@1.4.0

# Pi Compose 개발 버전
npm install -g --ignore-scripts git+https://github.com/SEONGMINY/pi-compose.git
```

Ghostty에서 작업할 프로젝트로 이동해 `pic`을 실행합니다.

```bash
cd /path/to/your-project
pic
```

Overview에서 `n`으로 Main을 만들거나, `o`로 저장된 Pi 대화를 직접 선택할 수 있도록 구현돼 있습니다. 처음 Pi를 사용한다면 `/login`으로 로그인한 뒤 `/model`에서 모델을 선택하세요.

더 자세한 조작과 주의사항은 [사용 가이드](docs/USAGE.md)를 확인해 주세요.

## 현재 개발 상태

Pi 세션 Fork, Ghostty Overview, Worktree 분리, 선택형 Handoff, 실행 상태 확인, **원본 메시지 근거를 보여주는 Summary Overlay**의 코드가 `main`에 반영돼 있습니다. **macOS 실사용·타입·통합 검증을 마친 릴리스는 아닙니다.**

특히 Summary는 현재 Pi 기록을 읽어 보여주는 **사실 기반 정보층**이에요. 경량 모델을 이용한 의미 요약, 중요 결정 자동 공유 후보, Summary에서 바로 보내는 Handoff UI, 완성된 메시지 사이드바와 종료·복구 경험은 아직 개발 중입니다.

제품 방향과 확정된 제약은 [PRD](docs/PRD.md), 동작 구조는 [Architecture](docs/ARCHITECTURE.md), 남은 개발 작업은 [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)에 정리했습니다.
