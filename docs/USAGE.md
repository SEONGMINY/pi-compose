# Pi Compose 사용 가이드 — 레퍼런스 중심 재설계

[← README](../README.md) · [설계 출처 및 차용 근거](REFERENCE_LED_DESIGN.md)

## 기본 흐름

**Main에서 대화 → 개발 위임 → Main에서 계속하기 → Child 열기 → Git Diff 검토 → Main 복귀.**

Pi Native Session에 쌓인 설계 맥락이 핵심입니다. 구현이 필요할 때 **현재 정확한 Pi 세션**을 Fork합니다. 요약 보고서는 원본 대화의 대체물이 아닙니다.

### 1. Pi Compose 시작

```bash
cd ~/projects/my-app
pic
```

Pi의 `/login`·`/model`은 기존 Pi 설정 그대로 사용합니다. 이미 저장된 대화는 `/resume`으로 이어갈 수 있습니다.

### 2. 위임 시작

Main과 충분히 논의한 뒤 다음처럼 입력합니다.

```text
지금 논의한 회원 API를 새 개발 Agent에게 맡겨줘.
클라이언트 호환성 때문에 기존 토큰 갱신 방식은 절대 변경하면 안 돼.
```

또는 `/compose` → **현재 대화 Fork → 새 Worktree에서 개발**, 혹은:

```text
/compose launch 회원 API 구현
```

대화 전체를 다시 요약해 입력할 필요는 없습니다. 개발 작업에 실제로 수행할 지시만 줍니다. 선택한 원본 세션의 Pi Branch에서 Fork가 수행됩니다.

**기본 설정**

| 항목 | 자동 선택 |
|---|---|
| Context | 현재 Pi 대화 Fork |
| Workspace | 별도 Git Worktree |
| Source | 현재 Pi 세션 파일 (정확한 ID 확인) |
| Branch | 작업명 + 충돌 방지 ID 자동 제안 |
| 실행 | **사용자에게 실제 승인 요청** |

진행 전에 Pi Native 확인창에서 원본 ID, 브랜치, 지시, 기존 미커밋 변경 경고를 확인합니다. 취소하면 새 Agent/Worktree를 만들지 않습니다. 저장된 세션 파일이 없다면 위임을 진행하지 않고 필요한 준비를 안내합니다.

다른 조합은 `/compose advanced`에서 각자 선택합니다. Fork/Independent와 Shared/Worktree는 독립적인 옵션입니다.

```text
/compose advanced 조사만 맡기고 파일을 수정하지 마
```

`/compose preview`는 기존 고급 사용자용 읽기 전용 사전 검증 경로로 남겨둡니다.

### 3. 실제 Child Pi 상태와 Main 보존

확인 후 새 Worktree가 생성되고 Child Pi를 시작합니다. Compose는 순서대로 다음을 구분합니다.

- 외부 명령 전달 성공
- 정확한 tmux/workmux 실행 대상 확인
- Child Pi의 실제 Session ID 연결
- Child 세션 헤더의 `parentSession`과 승인한 Main 파일 일치
- Pi 모델 실행 이벤트 관찰 (모델이 제약을 이해했다는 뜻은 아님)

위 단계 중 관찰하지 못한 사실을 성공으로 표시하지 않습니다. Pi의 턴 종료, Worktree 존재, Handoff, 개발 완료 및 통합도 각기 다른 사실입니다.

Main은 그 사이 그대로 남아 다른 요구사항을 논의할 수 있습니다.

### 4. 기존 Agent를 열고 Main 복귀

```text
/compose
```

Pi 기본 선택 UI에서 다음을 찾습니다.

- **현재 Main** 또는 정확한 Child 현재 위치
- **새 개발 위임**
- **관련 Agent** (작업명·실제 연결 여부)
- **다른 실행 방식** (필요할 때)
- **저장된 이전 대화**

기존 Agent를 선택하면 같은 tmux 창의 정확한 세션 ID 및 window ID로 이동합니다. **새 Pi를 시작하지 않습니다.** Child에서 `/compose`의 **← Main으로 돌아가기**는 승인한 Main의 정확한 tmux 창에 연결된 경우에만 나타납니다.

실행 대상이 없어졌다면 새 Agent를 임의 생성하지 않습니다. 기존 세션은 `/compose resume` 또는 Pi `/resume`을 통해 명시적으로 재개할 수 있습니다.

workmux Dashboard는 `/compose monitor`로 열며, Pi Hook이 설정돼 있지 않다면 일부 Agent 상태를 관찰할 수 없습니다. 기본 위임에 Dashboard 설치·진입은 필수가 아닙니다.

### 5. 실제 Git 변경 검토

`/compose` → 작업 → **Git 변경 검토**를 선택합니다.

Compose는 저장된 정확한 Worktree/브랜치를 Git에서 다시 검증하고, 작업 시작 당시 Git 기준 커밋을 이용해 변경 파일 목록·미추적 파일 경로·Diff를 확인합니다.

- Handoff나 Verify를 실행하지 않아도 사용할 수 있습니다.
- Git Diff에는 새 미추적 파일의 *내용*이 포함되지 않을 수 있으므로 파일 목록과 구분합니다.
- 큰 Diff는 표시량을 제한합니다. 실제 Git을 통해 전체 Diff를 확인할 수 있습니다.
- 오래된 TaskRecord에 기준 SHA가 없다면 HEAD 기준으로 보여주고 이전 커밋이 누락될 수 있다는 경고를 표시합니다.
- Git 변경 검토 자체는 파일을 수정·Stage·Commit·Merge·삭제하지 않습니다.

선택적으로 구현 Agent에서 `/compose-handoff`, `/compose-verify`를 실행해 요약 주장·독립 검증 기록을 남길 수 있습니다. 이것은 실제 변경 검토를 대신하지 않습니다.

### 6. 저장 대화 재개와 복구

```text
/compose sessions
/compose sessions 프로필
```

현재 Pi의 저장 디렉터리와 작업 경로에 맞는 세션을 Pi `SessionManager.list()`로 찾습니다. Pi Native `/resume`은 다른 범위의 저장 대화를 찾을 때 사용합니다.

실행 중인 Agent로 가는 것은 **tmux 전환**, 기존 Pi 대화를 여는 것은 **세션 전환**입니다. 동일한 작업으로 취급하지 않습니다.

실패했을 때는 표시된 단계와 다음 명령을 확인합니다.

```bash
pic doctor
git worktree list
pic diagnostics export --days 1
```

원본 세션을 하위 디렉터리에서 시작했다면, workmux의 프로젝트 루트 기반 Fork 대신 Git의 Worktree 생성과 Pi `--fork <정확한 JSONL>`를 조합합니다. 준비된 Worktree를 무조건 삭제하지 않고 실패를 안내합니다. 같은 브랜치로 무작정 재실행하지 마세요.

## 기술 및 UX 경계

- Main 모델의 컨텍스트를 검증한다는 것은 **Pi 세션 Fork의 출처 확인**부터 시작합니다. 모델이 모든 제약을 이해했다는 주장과 다릅니다.
- Fork된 대화는 Git 미커밋 파일을 자동 복사하지 않습니다.
- Shared Directory에서는 Git 수정자를 Agent별로 확정할 수 없습니다.
- 실제 세션·Worktree·tmux의 정확한 ID가 없으면 이동과 결과 귀속을 추측하지 않습니다.
- 사용자 지시 없이 Git 병합·Worktree 제거·세션 삭제를 실행하지 않습니다.
- 현재 연구·구현 브랜치는 실제 macOS의 전체 흐름 검증 전입니다.

## 명령어 (기본 사용에 반드시 암기할 필요 없음)

| 명령 | 역할 |
|---|---|
| `/compose` | 위임·관련 Agent·작업 전환·이전 대화 |
| `/compose launch [task]` | 현재 Pi 대화 → 새 Worktree 기본 위임 |
| `/compose advanced [task]` | Context/Workspace/원본 세션 직접 선택 |
| `/compose sessions [query]` | 저장된 Pi 대화 찾기 |
| `/compose monitor` | 선택형 workmux Dashboard |
| `/compose preview [task]` | 이전 고급 경로의 실행 전 검증 |
| `/compose back`, `/compose resume` | 이전 환경과 호환되는 복귀·재개 |
| `/compose-handoff`, `/compose-verify` | 선택형 인계·독립 검증 |
| `pic doctor`, `pic setup` | 설치 상태 점검·복구 |

[설계 기준](REFERENCE_LED_DESIGN.md) · [수동 검증 시나리오](SCENARIOS.md) · [UX 진단](UX_DIAGNOSTICS.md)
