# Pi Compose — 실사용 검증 시나리오

[← README](../README.md) · [상세 사용법](USAGE.md) · [레퍼런스 기반 설계 근거](REFERENCE_LED_DESIGN.md)

이 문서는 기능 목록이 아닌 **사용자의 목표를 끝까지 수행하는 수용 기준**입니다. 시나리오를 실제 실행했다고 주장하지 않습니다. PR #3을 보존한 `feat/reference-led-core` 브랜치를 실제 macOS에서 확인해야 합니다.

## 준비

```bash
pic doctor
# Node >= 22.19.0, Pi / tmux / workmux 정상 설치와 Pi 설정 확인
cd ~/projects/my-app
pic
```

Pi 안에서 `/login`·`/model`을 확인합니다. 새 기능이 보이지 않는 기존 Pi에서는 `/reload`를 사용합니다. 별도의 테스트 Git 저장소와 변경해도 되는 작업 파일을 권장합니다.

## A — Main 대화에서 첫 개발 위임

1. Main에서 기존 `name` 필드와 호환성 이유, 제외한 대안을 논의합니다. 구체적으로 “기존 name은 절대 제거하면 안 된다”를 명시합니다.
2. Main에서 `/compose` → **현재 대화 Fork → 새 Worktree에서 개발**을 선택하거나 “지금 논의한 내용을 별도 Agent에게 구현 맡겨줘”라고 명시합니다.
3. 별도 Context·Workspace 선택 없이 실제 작업 지시를 입력하고, 정확한 Pi 세션 ID, Fork 여부, 새 브랜치, 실행 경고를 읽고 **승인**합니다.
4. 실제 Child tmux 창과 Pi session id가 연결되는지 확인합니다. Child JSONL의 `parentSession`이 승인한 Main 파일과 일치해야 Fork 출처가 확인된 것입니다.
5. Child에서 이전 제약을 볼 수 있는지, 해당 지시로 개발을 진행하는지 **직접 확인**합니다. 모델이 모든 제약을 이해했는지는 세션 헤더로 증명할 수 없습니다.
6. Main 세션과 대화는 보존돼야 하며, 사용자는 메인에서 다른 설계를 계속할 수 있어야 합니다.

**완료 기준:** Main을 잃지 않고, 정확한 Fork된 Child가 개발 지시를 받고 코드를 변경할 수 있음. 외부 `workmux`나 `tmux` 명령 성공만으로 PASS 처리하지 않음.

## B — Agent / Main 전환

1. Main에서 `/compose`를 열어 기존 Agent를 선택하고 **기존 Agent 화면으로 이동**합니다.
2. Child에서 `/compose`의 **← Main으로 돌아가기**로 복귀합니다.
3. 메인의 기존 대화가 유지되는지 확인하고, Agent 화면으로 반복 이동합니다.
4. 실행 중인 Agent 수와 tmux 창 수가 전환 때문에 증가하지 않아야 합니다.

**완료 기준:** 정확한 기존 창을 사용하며, 다른 프로젝트나 이름이 같은 Agent로 임의 이동하지 않음.

## C — 다른 기능 대화와 저장 세션 복귀

1. 같은 프로젝트의 다른 기능을 논의한 Pi 대화를 미리 저장합니다.
2. `/compose sessions` 또는 `/compose sessions <검색어>`를 실행합니다.
3. Pi의 SessionManager에서 검색된 **정확한 세션 ID**를 확인해 선택합니다.
4. 대화가 같은 Pi 프로세스에서 전환되고, 새 Child/tmux 프로세스가 생기지 않아야 합니다.
5. 현재 디렉터리 범위에서 목록에 없는 대화는 Pi의 `/resume`을 확인합니다.

**완료 기준:** 저장 대화 재개와 살아 있는 Agent 터미널 전환을 구분하며, 이전 대화를 잃지 않음.

## D — Worktree 생성 및 Pi Fork 실패

1. 이미 있는 브랜치나 유효하지 않은 Git 경로로 계획 단계 실패를 유도합니다.
2. Git에 새 작업이 생성되지 않았는지 확인합니다.
3. 실행 명령 뒤 tmux 단계가 실패하면 Git Worktree가 남아 있을 수 있습니다. 이를 **실패**로 표현하고 삭제하지 않은 채 `git worktree list`를 안내해야 합니다.
4. 확인 없이 새로운 Agent를 중복 실행하거나 기존 Worktree를 삭제하지 않아야 합니다.
5. 실패 후 Main 원본 대화가 여전히 사용 가능해야 합니다.

**완료 기준:** plan / dispatch / target 실패를 구분하고, 기존 세션·Git 변경을 보존합니다.

## E — 원본 Pi 세션이 저장소 하위 디렉터리에서 시작한 경우

1. Git 저장소 `src/` 같은 하위 디렉터리에서 `pic`으로 Main 대화를 시작합니다.
2. 그 대화를 Fork + Worktree로 위임합니다.
3. 계획이 source cwd ≠ repo root를 확인하면 workmux 세션 탐색 대신 `git worktree add`와 정확한 `pi --fork <Main JSONL 파일>` 실행 경로를 승인창에서 안내합니다.
4. Child의 원본 계보·실제 실행 창·새 Worktree와 브랜치가 연결돼야 합니다.
5. 기존 `src/`의 미커밋 변경은 자동 이동하지 않아야 합니다.

**완료 기준:** 하위 디렉터리에서 논의한 Main의 원본을 버리지 않으면서 새 Worktree로 개발 가능.

## F — Git 변경과 후속 수정

1. Agent에서 파일을 수정합니다. 추적 파일 하나와 새 파일 하나를 만듭니다.
2. Main에서 `/compose` → 정확한 작업 → **Git 변경 검토**로 진입합니다.
3. 승인한 Git 기준 SHA부터의 변경과 미추적 파일 경로가 표시되고, 변경이 없으면 없다고 표시합니다.
4. Handoff 없이도 검토 화면이 열려야 합니다. 기록이 없는 과거 작업은 HEAD 기준의 한계를 고지합니다.
5. 변경을 다시 요청하고, 원하면 Child에서 `/compose-handoff`, `/compose-verify`를 사용합니다.
6. Main에 요약을 전달하되, 큰 로그·전체 Diff를 Main의 활성 컨텍스트로 강제 주입하지 않습니다.

**완료 기준:** 실제 변경과 Agent의 완료 주장을 구분하며 자동 병합이나 Worktree 제거가 없음.

## G — 다음 UX 진단

```bash
pic diagnostics status
pic diagnostics export --days 1
```

- Preview는 개발 Launch에서 제외합니다.
- `launch.agent_linked`는 Pi 연결, `launch.context_linked`는 `parentSession` 출처 확인, `launch.agent_started`는 관찰된 Pi 실행입니다.
- 모델의 제약 이해, 사용자의 화면 인지, 실제 제품 품질은 로그만으로 측정할 수 없습니다.
- 같은 작업을 여러 Pi 프로세스에서 실행하므로 `--run` 단일 실행 필터로 전체 연결 성공률을 추정하지 않습니다.

## 이번 브랜치의 검증 한계

- GitHub에 변경된 코드와 Unit Test 소스가 반영된 것과 해당 테스트가 실행·통과한 것은 별개의 사실입니다.
- GitHub Actions나 E2E는 사용자 이전 요청에 따라 실행하지 않습니다.
- macOS/Ghostty에서 로그인한 Pi 모델과 실제 workmux/tmux를 통한 전체 A~G 실사용 검증은 별도로 완료해야 합니다.

## H — 2026-10-27 실사용 재검증: 버전 → Fork → 구현 → 검토 → 복구

이 시나리오는 앞의 A~G를 **순차적인 사용자 경험 하나로 연결**합니다. 독립 테스트로 나눠 기능 구현 완료를 주장하지 않습니다.

1. 새 브랜치 설치 후 `pic version`으로 실제 Git SHA를 확인합니다. `pic doctor`로 복수 `pic` 경로, Pi Compose package registration, Pi/tmux/workmux 버전을 확인합니다.
2. Main Pi에서 `/compose version`을 확인합니다. Child에서도 각각 실행해 **실제로 로드한 코드**가 일치하는지 확인합니다. 파일 수정 시각이 프로세스 시작보다 늦으면 재시작합니다.
3. Main에서 “기존 `name`은 이전 클라이언트가 사용하므로 절대 제거하지 마라”를 이유와 함께 논의합니다. 개발 Agent에 구현을 명시적으로 위임하고, 원본 Pi 세션과 별도 Worktree 경로를 승인합니다.
4. `/compose`에서 해당 작업을 열어 실제 Child Pi Session ID, `parentSession`, Child User 메시지의 정확한 지시, 이후 Assistant 응답 관찰을 구분해 확인합니다. 미관찰 상태는 개발 성공/실패가 아니라 **확인되지 않음**이어야 합니다.
5. Child에서 실제 코드를 변경합니다. `name` 필드의 API/데이터 호환성을 깨뜨리지 않아야 하며, Main의 논의가 그대로 남아 다른 설계를 이어갈 수 있어야 합니다.
6. Main에서 기존 Child 터미널로 이동하고, **Handoff 없이** Git 변경·새 파일·Diff를 확인합니다. 결과와 제약을 검토한 뒤 Child/Main을 반복 전환해도 새 Agent가 생성되지 않아야 합니다.
7. Child 프로세스를 종료하고 `/compose` → 저장된 Child Pi 재개를 선택합니다. 정확한 Pi Session ID로 재개해야 하며 **두 번째 Fork를 만들지 않아야** 합니다.
8. 별도 실패 테스트로 Worktree가 생성된 후 tmux 실패 시 잔여 경로를 확인합니다. Worktree나 기존 세션을 자동 삭제하거나 동일한 작업을 무작정 재실행해서는 안 됩니다.
9. 이전 기능 대화 목록에서 저장된 Pi 대화를 검색해 이동합니다. 목록 없음과 취소는 서로 다른 이유로 기록해야 합니다.
10. `pic diagnostics export --days 1`에서 명령 성공, Child 연결, 정확한 Fork, 지시, 모델 응답 관측을 구분합니다. 진단에는 비공개 사용자 프롬프트/실제 파일 경로가 없어야 합니다.

**미검증:** 이 문서를 저장하는 것으로 성공한 것은 아닙니다. 인증된 macOS Pi/tmux/workmux에서 1~10을 실제 수행하고 오류가 없어야 최종 승인할 수 있습니다.
