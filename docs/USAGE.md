# Pi Compose 사용 가이드

[← README](../README.md)

## 1. 실행 준비

```bash
cd ~/projects/my-app
pic
# workmux가 만든 별도 Pi에서도 Compose 기능을 사용하려면 최초 한 번:
pic navigation enable
```

`pic`은 프로젝트별 tmux 세션에 연결됩니다. 기존 Pi 인증과 세션을 사용합니다. Worktree Agent는 `workmux add --agent pi`로 실행되므로 사용자 Pi의 Navigation Package를 인식해야 동일한 명령과 자연어 도구가 나타납니다. 적용하려면 이미 실행 중인 Agent에서 `/reload`를 실행하거나 새 Agent를 시작하세요.

`pic features`로 Handoff/Verify 선택형 Package를 활성화할 수 있습니다. `pic features --local`은 프로젝트 범위 설치입니다.

## 2. Main에서 위임하기

```text
지금까지 논의한 프로필 표시명 구현을 새 Agent에게 맡겨줘.
현재 Pi 대화를 Fork하고 새 Git Worktree를 만들어 줘.
기존 name 필드는 클라이언트 호환성 때문에 절대 제거하지 마.
```

위임 실행을 **명시적으로 요청한 자연어**는 `compose_launch` Tool을 통해 실행 계획과 승인으로 연결됩니다. 구현을 다른 Agent에 맡기는 게 좋을지 **논의만 하는 요청**은 실행 의도가 아닙니다.

```text
/compose launch 프로필 표시명 구현
/compose preview 프로필 표시명 구현
```

직접 명령어를 사용할 때는 작업명 입력, Context(Fork/Independent), Workspace(Shared/Worktree), 필요 시 정확한 원본 Pi 세션과 브랜치를 순서대로 선택합니다. 자연어에서 이미 특정한 정보는 다시 질문하지 않으며, 명시되지 않은 필수 옵션은 사용자 결정이 필요합니다.

위임 전 **Pi 기본 `confirm()`**에 실제 지시 원문, Context, Workspace, 원본 ID, 브랜치, 경고가 표시됩니다. 확인하면 실행하며, 취소하면 어떤 Agent나 Worktree도 생성하지 않습니다. 실제 Fork가 선택된 세션의 대화 맥락을 완전하게 보존했는지는 개별 확인이 필요합니다. Fork는 작업 디렉터리의 미커밋 코드를 새 Worktree에 복제하지 않습니다.

## 3. 같은 기능의 Main↔Agent

```text
/compose
```

Pi 기본 선택 UI를 사용하며 예시 순서는 다음과 같습니다.

```text
← Main으로 돌아가기                (정확히 연결된 경우)
현재 화면 · 프로필 구현 Agent
프로필 표시명 구현 [작업 ID] · Fork · 화면 연결됨
프로필 테스트 작성 [작업 ID] · Independent · 기록만 있음
+ 새 Agent에게 작업 위임
전체 작업 관찰 · workmux Dashboard
이전 Pi 대화·기능 찾기
```

원래 Main을 모르면 Main을 추측해 표시하지 않습니다. 같은 작업명은 각각의 식별자가 있으며, 선택 항목과 현재 위치를 별개로 보여줍니다. 작업 목록은 실행 상태에 따라 재정렬하지 않습니다.

작업을 선택하면 **기존 Agent로 이동 / 실제 위임 지시 확인 / 결과 인계·검토 확인 / 목록 복귀**를 고릅니다. 위임 지시와 Handoff는 읽기 전용 Pi Dialog에 표시됩니다. 화면 이동은 정확한 기존 tmux **세션 및 창 ID**를 다시 확인하고 나서 수행합니다. 대상이 없거나 모호하면 **새 Pi를 실행하지 않습니다**.

아직 대상이 연결되지 않은 과거 작업은 실행 가능한 것처럼 표시하지 않습니다. `/compose back`은 기존 workmux·tmux·Pi 기록을 탐색하는 고급 경로로 유지합니다. 닫힌 Worktree의 재개는 정확한 저장 Pi 세션을 선택하고 새로운 프로세스 실행에 **별도 동의**해야 합니다.

## 4. 여러 프로젝트의 작업 관찰

```text
/compose monitor
```

현재 tmux 내부에서 **workmux Dashboard**가 열립니다. Pi Compose가 상태나 터미널 미리보기를 따로 구현하지 않습니다. Pi 작업의 실시간 관측에는 사용자 설정이 필요합니다.

```bash
workmux setup
```

workmux의 공식 설정 명령으로 Pi의 상태 Hook을 설치할 수 있습니다. Hook을 설치하지 않으면 Dashboard의 Agents 화면에 작업이 보이지 않을 수 있습니다. 상태 Hook은 Pi의 입력 대기를 완벽히 표시하지 못하며, 최근 응답 종료는 개발 완료가 아닙니다.

Dashboard는 등록된 Agent·Worktree의 조회, 실제 출력 미리보기, Git 변경, 프로젝트 간 탐색에 사용합니다. Shared Directory의 개별 Pi 세션은 등록되지 않았을 수 있으므로 **`/compose`에서 정확한 기존 tmux 창을 찾습니다**. Dashboard에 표시되지 않는다고 작업을 종료하거나 새로 시작하지 않습니다.

원하지 않는 workmux 레이아웃 변경이나 자동 삭제는 하지 않습니다. Dashboard 내부의 `X`, Worktrees View의 `r` 등은 workmux 자체의 종료·삭제 동작이므로 직접 사용할 때 주의하세요.

## 5. 같은 프로젝트의 다른 기능 대화 찾기

```text
/compose sessions
/compose sessions 결제
```

Pi의 `SessionManager.list()`로 현재 프로젝트의 **저장 대화**를 찾아 이름·첫 발화와 정확한 세션 ID로 구분합니다. 선택하면 Pi의 `ctx.switchSession()`으로 **지금 Pi 프로세스 안에서** 대화가 전환됩니다. 새 Pi나 tmux 세션을 만들지 않습니다.

Pi가 자체 제공하는 `/resume`도 사용할 수 있습니다. 다른 프로젝트의 대화는 해당 프로젝트로 이동하거나 Pi 기본 기능을 활용하세요. Pi Compose는 전체 프로젝트를 통합하는 새 대화 DB를 만들지 않습니다.

자연어로 기존 작업을 검색할 때는 `compose_find_work`가 현재 프로젝트의 정보를 **읽기 전용**으로 확인합니다. 실제 복귀는 `compose_return_work` 또는 위 명령을 이용하며, 사용자 초안이 있으면 덮어쓰지 않습니다.

## 6. Handoff → Verify → Main에서 결과 확인

선택형 기능을 활성화합니다.

```bash
pic features
```

개발 Agent에서:

```text
/compose-handoff
/compose-verify main
```

Handoff는 Agent가 작성하는 **구현 주장**에 실제 Git 파일 상태, 브랜치, HEAD, staged/unstaged 및 미추적 경로를 추가해 요약합니다. 엄격한 금지사항의 이유를 생략하거나 실행하지 않은 테스트를 통과했다고 주장해서는 안 됩니다.

Verify는 사용자의 별도 확인을 받은 뒤 독립적인 Pi `--print` 읽기 전용 검토를 실행합니다. 원본 계약과 현재 Diff를 확인하되, 파일 및 출력이 길면 검토 범위가 제한될 수 있습니다. 검토 이후 Git이 바뀌면 기록도 최신 근거로 볼 수 없습니다.

**Main에서 `/compose` → 해당 Agent → `인계·검토 결과 확인`**을 선택합니다. 작업을 만든 Worktree 경로와 브랜치가 기록에 유일하게 일치한 경우에만 보고서 일부가 연결됩니다. Main의 활성 대화에 전체 로그를 자동 주입하거나, 결과를 자동 승인하지 않습니다.

Shared Directory에서는 여러 Agent가 Git 변경을 함께 만들 수 있습니다. 따라서 현재 구현은 Handoff/Verify를 Agent 세션에서 실행해 확인할 수 있지만, Git 변경을 특정 Agent의 것으로 **임의 귀속해 Main의 작업 기록에 연결하지 않습니다**. 원문은 실제 Agent 세션에서 확인하거나 명시적으로 `workmux send` 수신 대상을 선택합니다. 전송 성공은 상대가 읽었다는 증거가 아닙니다.

변경 통합, Git 병합, Worktree 삭제, 프로세스 종료는 모두 별도의 사용자 결정입니다.

## 7. 명령 요약

| 명령 | 역할 |
| --- | --- |
| `/compose` | 현재 기능의 Main·관련 Agent 탐색 |
| `/compose launch [task]` | 새 Agent 실행 옵션 선택 및 승인 |
| `/compose preview [task]` | 실행 전 계획만 확인 |
| `/compose monitor` | workmux Dashboard (설정된 Agent 관찰) |
| `/compose sessions [query]` | Pi 저장 대화로 이동 |
| `/compose back [query]` | 기존 고급 세션·Worktree·tmux 탐색 |
| `/compose resume` | 정확한 저장 대화를 새 Pi로 명시적 재개 |
| `/compose-handoff` | 선택형 인계 작성 |
| `/compose-verify [ref]` | 선택형 독립 검토 |
| `pic navigation enable` | Worktree Agent에서 같은 Pi 명령 활성화 |
| `workmux setup` | workmux Pi 상태 Hook 설정 |
| `pic features` | 선택형 Handoff/Verify 설정 |

[설계 판단](adr/0007-reference-led-navigation.md) · [실사용 점검 시나리오](validation/task-hub-ux.md)
