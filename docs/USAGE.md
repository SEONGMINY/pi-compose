# 사용 가이드

[← README](../README.md)

이 문서는 Pi Compose를 실제 작업에 사용할 때 필요한 선택과 명령을 정리합니다. Pi Runtime, 세션, 모델 인증, Extension 로딩은 기본적으로 [Pi](https://github.com/earendil-works/pi)가 담당합니다.

## 시작하기

macOS에서는 [설치 스크립트](../scripts/install.sh)를 사용합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
cd ~/projects/my-app
pic
```

인자 없는 대화형 `pic`을 일반 터미널에서 실행하면 현재 디렉터리의 tmux 세션(`pic-...`)을 만들거나 기존 세션에 연결합니다. 이미 tmux 안에 있다면 중첩하지 않습니다. 분리(`Ctrl+b`, `d`)한 후 같은 디렉터리에서 `pic`을 다시 실행하면 원래 작업으로 돌아갑니다. 옵션을 전달하는 Pi CLI 및 비대화형 사용은 이전과 동일합니다. tmux가 없을 때는 오류를 반환하고 설정 파일을 수정하지 않습니다.

첫 실행에는 Pi TUI에서 `/login`으로 제공자를 인증하고 `/model`로 모델을 선택합니다. Azure를 사용하지 않는다면 Azure 설정은 필요하지 않습니다. 기존 `pi`의 설정·인증·세션·Skill·Theme가 공유됩니다.

## 새 에이전트를 실행할 때

```text
/compose preview 회원 API 구현
/compose launch 회원 API 구현
```

Pi 선택 UI에서 **컨텍스트**와 **작업 공간**을 각각 정합니다.

| 선택 | 의미 | 사용하기 좋은 경우 |
| --- | --- | --- |
| Fork | 사용자가 지정한 Pi 대화에서 새 대화를 분기 | Main에서 합의한 요구사항·선택 근거·강한 제약을 이어서 개발할 때 |
| Independent | 이전 대화를 상속하지 않는 새 세션 | 별개의 조사나 코드 탐색처럼 대화 맥락이 필요하지 않을 때 |
| Shared Directory | 현재 작업 디렉터리 사용 | 같은 체크아웃에서 작업할 때. 다른 에이전트의 동시 수정에 주의 |
| Git Worktree | 별도 브랜치·체크아웃 | 변경 파일을 분리해 개발할 때. workmux가 필요 |

이 둘은 독립적인 선택이므로 네 가지 조합이 가능합니다.

Fork는 **어느 Pi 세션을 원본으로 삼을지 직접 선택**해야 합니다. Pi Compose가 최근 세션이나 현재 세션을 자동으로 Main이라고 간주하지 않습니다. Worktree를 선택하면 새 브랜치 이름을 입력합니다. workmux Fork에는 원본 세션의 작업 디렉터리와 저장소 루트가 일치해야 하는 제약이 있습니다.

`/compose preview`는 실행 계획만 표시합니다. `/compose launch`는 사용자가 명시적으로 선택한 옵션으로 실행합니다. 자연어로 에이전트 생성을 요청하면 `compose_launch` Tool이 **실행 전 승인을 요청**합니다.

Worktree Launch는 workmux의 `--background` 옵션을 사용해 현재 Main 화면에 남습니다. 개발 에이전트를 보려면 `/compose work`에서 선택하세요. Shared Launch도 별도 tmux 세션에서 시작하고 Main 화면을 유지합니다.

시작 명령이 성공했다는 결과가 곧 모델이 정상 응답 중이라는 뜻은 아닙니다. 실제 Agent 상태는 해당 Pi/tmux/workmux 환경에서 확인해야 합니다.

## 이전 작업으로 돌아갈 때

```text
/compose work
/compose work 회원 API
/compose back 회원 API
```

현재 프로젝트의 Pi 저장 대화, workmux Worktree, Pi Compose가 만든 실행 중 tmux 대상을 하나의 선택 UI에서 보여줍니다. 실행 중 tmux 세션은 **대상이 존재한다는 사실만** 보여주며 모델이 작업 중인지, 완료했는지는 알 수 없습니다.

- **실행 중인 tmux 대상:** tmux 안에서 선택하면 해당 세션으로 이동합니다. 새 에이전트를 만들지 않습니다. tmux 바깥에서는 직접 연결 명령을 안내합니다.
- **저장된 Pi 대화:** Pi의 공식 세션 전환 API로 현재 프로세스에서 대화를 전환합니다. 일반적인 Pi 저장 대화 선택은 기본 `/resume`도 사용할 수 있습니다.
- **열린 Worktree:** 선택한 workmux 대상을 사용자 확인 후 엽니다. workmux 창의 열림 상태는 해당 Pi 대화가 실제 실행 중이라는 증거가 아닙니다.
- **닫힌 Worktree:** 해당 Worktree의 저장된 Pi 대화 중 정확한 세션을 직접 선택하고, 새로운 Pi 프로세스 생성에 동의한 경우에만 재개합니다.
- **새 tmux에서 명시적으로 재개:** `/compose resume`. 저장된 대화의 단순 전환과는 다른 동작입니다.

자연어로 **“회원 API 작업을 찾아줘”**라고 요청하면 `compose_find_work`가 읽기 전용 목록을 제공합니다. **“회원 API 작업으로 돌아가고 싶어”**라고 요청하면 `compose_return_work`가 선택 UI를 열 수 있습니다.

자연어로 저장된 Pi 대화를 선택했을 때는 정확한 `/compose back id:<세션ID>` 명령이 입력창에 준비됩니다. **사용자가 Enter를 눌러야** 실제로 전환됩니다. 입력 중인 초안이 있다면 덮어쓰지 않습니다. 이는 Pi Tool에서 세션 직접 전환 API를 사용할 수 없는 제약에 따른 방식입니다.

검색은 현재 프로젝트 범위입니다. 다른 프로젝트의 모든 대화나 tmux 프로세스를 자동 탐색하지 않습니다.

## Handoff와 독립 검증 (선택형)

```bash
pic features
```

Pi의 별도 선택형 Package를 설치한 뒤 `pi config` UI가 열립니다. **최초 설치 때 Dashboard·Handoff·Verify 세 기능이 모두 켜지므로**, 사용하지 않는 항목은 해당 UI에서 해제합니다. 현재 프로젝트에만 설치하려면 `pic features --local`을 사용합니다. 선택한 기능의 설정은 일반 `pi`와 `pic`가 공유합니다. 이미 열려 있는 Pi TUI에는 `/reload`로 변경된 Extension 구성을 다시 불러오거나 `pic`을 재실행해 적용합니다.

### 작업 결과 인계

```text
/compose-handoff
/compose-handoff <workmux-agent-handle>
```

현재 세션의 Pi 모델에 Handoff 작성을 요청합니다. `compose_handoff` Tool이 Git 변경 파일, HEAD, 작업 중인 변경, `git diff --check` 등을 확인하고 **구현 결과·WHY/원래 제약·실제로 수행한 검사·남은 일**을 모읍니다.

수신자를 지정한 경우에만 사용자 승인 후 `workmux send`를 호출합니다. **전송 성공은 수신·읽음·정확성을 보증하지 않습니다.** 자동 병합·Worktree 삭제도 수행하지 않습니다.

### 필요한 경우 별도 검증

```text
/compose-verify
/compose-verify main
```

사용자 승인 후 별도의 Pi `--print` 호출에서 변경 사항과 관련 근거를 읽기 전용으로 검토합니다. `main` 같은 기준 Ref를 지정하면 그 기준 이후의 변경을 포함해 검토합니다. 기준을 생략하면 검사 범위가 제한됩니다. 긴 Diff와 변경 파일 목록은 일부 잘릴 수 있고, 개발자가 작성한 Handoff도 **검증 전 주장**으로 취급합니다.

검증 결과는 자동 승인이나 Git 병합이 아닙니다.

### Worktree 화면 배치

workmux는 기본 설정에서 Pane 두 개를 생성할 수 있습니다. Pi Compose는 사용자의 기존 workmux 설정이나 Hook을 자동으로 덮어쓰지 않습니다. 기본적으로 한 에이전트 화면에 집중하려면 프로젝트의 `.workmux.yaml`에서 다음처럼 설정할 수 있습니다.

```yaml
panes:
  - command: <agent>
    focus: true
```

workmux의 `panes` 정의는 기존 Pane 배열을 대체합니다. 현재 프로젝트에서 개발 서버나 별도 Shell을 실행하고 있다면 해당 설정을 유지하거나 조정하세요. 분할 화면은 tmux 또는 workmux Pane 설정을 통해 필요할 때 사용할 수 있습니다.

### 작업 View

Pi가 tmux 안에서 실행 중이고 Dashboard Extension을 켠 경우:

```text
/compose-workmux
/compose-workmux worktrees
```

workmux의 Dashboard를 tmux 팝업으로 엽니다. Pi Compose가 별도 Dashboard나 에이전트 상태 저장소를 만들지는 않습니다.

## 그 밖의 직접 제어

| 명령 | 용도 |
| --- | --- |
| `pic config` | Pi 리소스 설정 TUI |
| `pic config --local` | 프로젝트 범위 Pi 리소스 설정 |
| `pic --resume` | Pi 기본 저장 세션 선택 |
| `pic --model <모델>` | 이번 실행에서 사용할 Pi 모델 선택 |
| `pic -e <extension-path>` | Pi Extension 추가 로드 |
| `pi-compose --help` | 고급 CLI: 실행 계획, 명시적 재개, Git Worktree 조회 등 |

`pic`은 Pi Runtime 위에 기본 Compose Extension을 더하는 진입점입니다. 사용자 정의 Extension·Skill·Theme를 계속 사용할 수 있으며, 일반 `pi`도 독립적으로 실행할 수 있습니다. `pic update`는 Pi의 기존 update 명령으로 전달되므로 **Pi Compose 업데이트는 설치 명령을 다시 실행**하세요.

## 더 자세한 자료

- [아키텍처와 책임 경계](ARCHITECTURE.md)
- [요구사항과 선택 원칙](PRD.md)
- [구현 계획 및 남은 검증 범위](IMPLEMENTATION_PLAN.md)
- [실제 도구 연동 검증 기록](validation/phase6-integration.md)
- [설치·업데이트의 설계 결정](adr/0006-github-installer.md)
