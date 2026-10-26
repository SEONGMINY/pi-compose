# ADR 0006 — macOS용 GitHub 설치·업데이트 진입점

- 상태: **채택 — 사용자 승인에 따라 구현 (실사용 검증 범위 별도 기록)**
- 작성일: 2026-10-25
- 선행 결정: [ADR 0005](0005-pic-entry-and-pi-settings.md)

> **2026-10-26 변경:** 설치 스크립트 자체는 사용자 Pi 설정을 건드리지 않는 원칙을 유지합니다. 설치 후 **최초 대화형 pic 실행**은 명시적 동의에 따라 권장 기능을 설정하도록 [ADR 0008](0008-first-run-setup.md)에 업데이트됐습니다. 기존 결정의 원래 이유는 보존합니다.

## 문제

기존 최초 설치는 Pi 패키지 이름, GitHub 저장소, 로컬 경로, npm 전역 설치를 각각 알아야 했다.
업데이트에도 저장소 위치와 수동 Git/npm 작업이 필요했다.
개인용 Harness의 배포·설정 인프라를 확대하지 않으면서 설치·재설치 반복 조작을 줄여야 한다.

## 결정

1. **macOS 우선**: `scripts/install.sh`를 GitHub Raw URL로 공개한다. 안내하는 사용자 명령은 하나다.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/SEONGMINY/pi-compose/main/scripts/install.sh | bash
   ```

2. Pi Compose는 npm Registry에 공개하지 않고 `npm install -g git+https://github.com/SEONGMINY/pi-compose.git#<SHA>`로 설치한다.
   먼저 `git ls-remote`에서 현재 HEAD를 확인해 **동일한 Git 커밋을 정확히 설치**한다. GitHub main 재설치 시 npm 캐시로 갱신이 누락되지 않게 한다.
3. Node.js `>=22.19.0`와 Git이 필요하다. Node가 없고 Homebrew가 준비돼 있으면 `brew install node`에 위임한다.
   **사용자 기존 Node가 구버전이면 강제 업그레이드하지 않고 중단**한다.
4. Pi가 없는 경우에만 공식 npm 패키지 `@earendil-works/pi-coding-agent`를 설치한다. 기존 Pi의 설치 방식·버전·설정은 보존한다.
5. tmux·workmux가 누락됐으면 기존 Homebrew를 이용해 설치한다. 둘 다 이미 있다면 재설치·업그레이드하지 않는다.
   **Homebrew 자체는 자동 설치하지 않는다**: 설치 시 권한 승인, Xcode 도구·PATH 설정 등 사용자의 통제에 맡긴다.
6. npm은 `bin.pic`를 전역 설치한다. Alias, PATH 또는 Shell 초기화 파일을 변경하지 않는다.
   `sudo` 권한 상승을 수행하지 않고, 실행 파일 확인에 실패하면 해결 지침과 함께 종료한다.
7. 설정·인증·세션 저장소를 생성하거나 수정하지 않는다. `pic features`의 선택형 기능 설치도 자동 실행하지 않는다.
8. **업데이트는 같은 한 줄 재실행**이다. Pi나 의존 프로그램을 자동 업데이트하지 않으며, Pi Compose만 다시 설치한다.

## 고려했지만 채택하지 않은 방식

| 방식 | 채택하지 않은 이유 |
| --- | --- |
| npm Registry 공개 배포 | 개인용 단계에서 publish 권한·버전 배포 작업 추가 |
| 직접 Git Clone + 로컬 npm install | 저장소 경로와 Git Pull·설치를 사용자가 관리해야 함 |
| Homebrew 전용 Formula/Tap | 새 릴리스마다 Formula와 버전 추적 부담 |
| Homebrew 자동 설치·Shell 수정 | 사용자가 승인하지 않은 시스템 변경 위험 |
| 자체 업데이트 데몬·버전 DB | 불필요한 상태·업데이트 시스템 추가 |

## 제약과 향후 방향

- Homebrew가 없는 깨끗한 macOS는 필요한 도구를 자동 설치할 수 없다. 명령 하나가 항상 성공한다는 의미는 아니다.
- main의 원격 실행 스크립트와 npm GitHub 패키지는 변경 가능한 최신 소스다.
  설치가 안정되면 **GitHub 릴리스 태그 고정과 검증 가능한 릴리스**를 검토한다.
- 설치 명령이 성공해도 모델 로그인·Worktree Hook 구성·실제 Pi/workmux 멀티 에이전트 검증까지 완료된 것은 아니다.
- `curl | bash` 실행 전 공개 소스를 검토할 수 있게 한다.
- **실제 macOS (Apple Silicon, Node 22.19.0) 검증 완료:**
  Homebrew로 tmux·workmux 설치, 공식 Pi npm 설치, GitHub HEAD SHA 고정 npm 전역 설치,
  `pic` 실행, 선택형 Extension 패키지 파일 존재, 재설치 및 Pi 설정·세션 파일 보존.
  [macOS 설치·재설치](https://github.com/SEONGMINY/pi-compose/actions/runs/40185554756).
- **서로 다른 GitHub 커밋 사이 실제 업데이트 확인:** 이전 커밋을 전역 설치한 뒤,
  공개된 `curl | bash` 한 줄을 실행해 최신 README가 설치됐음을 확인했다.
  [macOS 업데이트 검증](https://github.com/SEONGMINY/pi-compose/actions/runs/40185838846).
- **실행 명령 변경:** 현재 전역 명령은 `pic`이고 기존 Pi Compose `pico` 링크는 npm 업데이트에서 제거된다. macOS 시스템 `pico` 편집기는 그대로 유지된다. GNU groff의 다른 `pic` 명령이 있으면 설치 전에 실패하도록 보호한다.
  [macOS 이름 변경 검증](https://github.com/SEONGMINY/pi-compose/actions/runs/40186852376).
- **미검증:** Homebrew 미설치·기존 Node 구버전 환경에서의 안내 UX,
  모델 인증된 Pi 대화/Worktree Fork, Intel macOS 설치, Shell 별 PATH 환경.

[README](../../README.md) · [Implementation Plan](../IMPLEMENTATION_PLAN.md)
