# Orca 통합 UX — 생성부터 다시 열기까지

이 브랜치는 PR #12의 작은 레이어 아이콘을 찾아서 누르던 경험을 개선합니다. Orca 터미널, Pi 원본 대화, Git Worktree는 새로 구현하거나 덮어쓰지 않습니다.

## 바뀐 흐름

1. Git 프로젝트에 등록된 Main이 없다면 최초 한 번 Main 만들기를 안내합니다. 이후에도 Orca 사이드바에 Pi Compose 영역이 남습니다.
2. Orca의 기존 + 버튼에서 Main / Work / Support를 생성합니다. 일반 Orca 작업 만들기는 같은 화면에서 선택합니다.
3. 회원가입 API 개발로 Main을 만들면 Pi Compose 프로젝트 트리와 Orca 터미널 탭에도 그 이름을 표시합니다.
4. 사이드바는 Main → Work / Support로 관계를 표시합니다. Work는 정확한 Fork, Support는 독립 세션입니다.
5. Agent 행을 누르면 열려 있는 Orca 탭을 먼저 포커스하고, 없다면 저장된 동일 Pi 세션을 다시 엽니다. 새 Fork를 만들지 않습니다.
6. 동일 Orca 작업 공간에서 허용되는 경우 기존 탭을 오른쪽으로 분할합니다. 불가능한 경우 버튼을 비활성화합니다.
7. 별도 Git Worktree는 Orca의 실제 Worktree 목록에서 확인된 경우에만 해당 공간에서 실행합니다. 미등록이면 세션·Worktree를 보존하고 안내합니다.
8. Pi 세션 준비 성공과 Orca 터미널 실행 성공을 구분하고, 탭 실행 실패 후 중복 Agent 생성을 막습니다.

## 지키는 제품 계약

- Main은 제품·기능·업무에 따라 여러 개이며 원본은 Pi JSONL입니다.
- Work는 지정 Main의 정확한 기록을 복제하며 요약 프롬프트로 대체하지 않습니다.
- Support는 Main 대화를 복제하지 않습니다.
- Work/Support 로그는 Main 모델 컨텍스트에 자동 삽입하지 않습니다.
- Pi 컨텍스트 선택과 Shared/Worktree 선택은 별개입니다.
- Pi 세션·코드·Worktree의 자동 삭제·정리·병합은 없습니다.

## 현재의 제약

Orca의 탭 분할은 작업 공간 소속과 레이아웃 소유자 제약을 받습니다. 서로 다른 Worktree의 Pi 터미널을 하나의 화면으로 드래그하는 기능은 아직 완성되지 않았습니다. 기존 세션을 복제하는 우회책은 사용하지 않습니다.

Orca의 Worktree 부모·자식 관계와 Pi의 Main·Work 세션 상속 관계는 다른 개념입니다. Main 트리는 기존 Orca 작업 공간 목록 위에 표시하며 두 관계를 혼동하지 않습니다.

현재 상태 표시만으로 Pi 모델 실행 완료를 주장하지 않습니다. 요청에 따라 CI·테스트 코드 작성·테스트 실행을 진행하지 않았습니다.

## 실행

    git fetch origin
    git switch feat/orca-predictable-workflows
    pnpm install
    pnpm orca:dev

기존 .cache/orca-upstream을 덮어쓰지 않도록 새 .cache/orca-upstream-compose에 고정 Orca 원본을 준비합니다. 기존 세션·Worktree·소스는 삭제하지 않습니다.
