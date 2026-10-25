# Phase 2 — 선택형 Dashboard / View

- 상태: **Pi Compose의 기본 Launch와 선택형 workmux View 분리 구현. 실제 Pi·tmux·workmux 연동 미검증**
- 확정일: 2026-10-25
- 제품 기준: [PRD](../PRD.md) · [Architecture](../ARCHITECTURE.md)
- 결정 이유: [ADR 0004](../adr/0004-pi-native-optional-views.md)
- 참고 사례: [my-pi](https://github.com/Jonghakseo/my-pi) (디렉터리 구조 복제 대상이 아닌 Pi 확장 구조의 사례)

## 1. 변경한 이유

첫 Phase 2 구현은 `extensions/compose.ts`에서 Launch와
`/compose dashboard`를 함께 등록했다. 그 결과 특정 View를 사용하지 않는 사용자도
Launch Extension을 로드할 때 Dashboard 명령이 함께 등록되는 결합이 있었다.

사용자와 확정한 방향은 다음과 같다.

- 기본 Pi Compose는 **Launch만 제공**한다.
- View·Skill·Extension은 사용자 선택에 따라 추가·교체한다.
- Pi의 기존 Package·Extension 로딩 규칙을 활용하고 별도 플러그인 시스템을 만들지 않는다.
- 기존 workmux Dashboard는 버리지 않고 **선택형 View**로 보존한다.
- 사용자의 실행 방식 선택, Main 컨텍스트 보호, Git 상태 보존에 관한 기존 계약은 유지한다.

## 2. 현재 구성

```text
pi-compose/
├── src/
│   ├── launch.ts                      # 공통 실행 로직; Dashboard import 없음
│   └── dashboard.ts                   # workmux 명령 연결 전용
├── extensions/
│   ├── compose.ts                     # 기본 Pi Extension: Launch / Preview / Tool
│   └── optional/
│       └── workmux-dashboard.ts       # 명시적으로 로드할 때만 workmux View
├── bin/
│   └── pi-compose.ts                  # launch + 기존 dashboard CLI (호환)
└── package.json                      # pi.extensions: ["extensions/compose.ts"]
```

`extensions/optional/workmux-dashboard.ts`는 Pi가 디렉터리에서 자동 탐색하는
`extensions/*.ts`나 `extensions/*/index.ts` 위치에 놓지 않았다.
Pi Package의 선언에서도 제외돼 있다.

이 구조에서 Launch와 View는 서로의 Extension 등록에 의존하지 않는다.

## 3. 로딩과 실행

```bash
# 기본 Package에 Launch만 등록
pi install /absolute/path/to/pi-compose

# 이 세션에서만 선택형 workmux View 로드
pi -e /absolute/path/to/pi-compose/extensions/optional/workmux-dashboard.ts
```

영구적으로 사용하려면 Pi 사용자·프로젝트 `settings.json`의 `extensions` 리소스에
**실제 로컬 파일 경로**를 추가한다.

```json
{
  "extensions": ["/absolute/path/to/pi-compose/extensions/optional/workmux-dashboard.ts"]
}
```

이 예시는 로컬 소스 checkout을 가정한다. Package Manifest가 노출하지 않은 Extension을
`packages[].extensions` 필터만으로 새로 활성화하는 것은 불가능하다.
실제 독립 배포가 필요해질 때만 별도 Pi Package를 검토한다.

### 명령의 책임

| 진입점 | 기본 활성화 | 기능 |
| --- | --- | --- |
| `/compose launch [task]` | 예 | 사용자 요청으로 개발 세션 시작 |
| `/compose preview [task]` | 예 | 실행 계획 확인 |
| 모델 `compose_launch` | 예 | 명시적 사용자 요청·확인 후 Launch |
| `/compose-workmux [agents\|worktrees]` | **아니오** | 선택형 workmux View의 tmux Popup |
| `pi-compose dashboard [--session] [--tab ...]` | CLI에서 명시적 사용 | 기존 workmux Dashboard 실행 |

이전 Pi 명령 `/compose dashboard`는 Launch와 View의 독립 활성화를 위해 제거했다.
실행 옵션과 View를 억지로 공유할 필요는 없다.
CLI의 `pi-compose dashboard`는 기존 사용자 호환성을 위해 유지했다.

## 4. 도구 선택에 따른 의존성

**View 교체와 실행 도구 교체를 구분한다.**

- 선택형 View: `src/dashboard.ts` + `workmux dashboard`를 참조한다.
- 기본 Launch: Pi 명령/Tool은 Dashboard 모듈을 **불러오지 않는다**.
- Worktree Launch: `src/launch.ts`는 아직 `workmux add`를 사용한다.
- Shared Directory Launch: Pi CLI와 tmux에 의존한다.
- 사용자가 다른 View를 구현하더라도 `src/launch.ts`나 기본 Extension을 수정하지 않아야 한다.
- Worktree 백엔드를 실제로 다른 도구로 교체할 필요가 생기기 전에는 범용 Adapter 인터페이스를 만들지 않는다.

## 5. 안전 및 라이프사이클

- View는 세션의 소유자나 영구 상태 저장소가 아니다. Pi·Git·tmux가 기존 상태를 유지한다.
- `/compose-workmux`는 Pi가 tmux 안에서 실행 중일 때만 tmux 팝업을 열려고 한다.
- 팝업을 닫는 행위가 Pi 세션 종료, Handoff, 코드 검증·통합, Worktree 정리를 뜻하지 않는다.
- workmux의 Pi 상태 Hook은 자동 설치하지 않는다.
- `Idle`·`Done`은 구현 완료나 사용자의 계약 변경 승인과 다르다.
- CLI를 명시적으로 호출한 경우를 제외하면 선택형 View의 외부 의존성을 기본 사용자에게 강제하지 않는다.

## 6. 검증 범위

기존 Phase 2에서 `src/dashboard.ts`의 위임 테스트 6개는 격리 Node 환경에서 통과했다.
이번 구조 변경은 다음 테스트를 추가·이동했다.

- 기본 `package.json`의 `pi.extensions`는 `extensions/compose.ts`만 선언하는지.
- 기본 Extension은 Launch 명령·Tool만 등록하는지.
- 선택형 View는 `compose-workmux` 명령만 등록하는지.
- 유효한 View 탭 선택, tmux 미사용 환경, tmux 팝업 생성, 실패 안내.
- 기존 `pi-compose dashboard` CLI 진입점과 `src/dashboard.ts`는 변경하지 않았음.

**이번 변경의 전체 TypeScript 검사 및 기존 모든 테스트의 실행 결과는 확인되는 범위만 별도로 기록한다.**
실제 Pi TUI에서의 Extension 로딩과 workmux 상태 Hook·tmux Popup 통합은
이 기능을 사용할 시점에 검증하며, 다음 단계 진행의 필수 Gate로 만들지 않는다.

## 7. 의도적으로 만들지 않은 것

- 자체 View Registry, Dashboard Provider API, Plugin Host 또는 확장 기능 DB.
- 세션 상태 Poller, tmux Session Manager, 자동 Hook 설치기.
- 모든 View마다 독립 npm 패키지를 지금부터 만드는 배포 구조.

사용자가 원하는 구성 요소를 Pi의 리소스 설정으로 추가할 수 있으면, 별도의 시스템을 만들 필요가 없다.
