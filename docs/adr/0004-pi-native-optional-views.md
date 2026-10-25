# ADR 0004 — 기본 Launch와 선택형 View를 Pi 기본 확장 방식으로 조합

- 상태: **채택 — 사용자 확정**
- 결정일: 2026-10-25
- 관련: [PRD](../PRD.md), [TRD](../TRD.md), [Architecture](../ARCHITECTURE.md), [Phase 2 검증 기록](../validation/phase2-dashboard.md)

## 배경과 문제

Phase 2에서는 기존 `workmux dashboard`를 재사용하기 위해 `extensions/compose.ts`에
`/compose dashboard`와 Launch 명령을 함께 등록했다.

이 구성은 Dashboard를 새로 만들 필요가 없다는 점에서 비용이 낮지만,
**Pi Compose의 핵심 실행 기능과 특정 View를 한 번에 로드하게 한다.**
이후 사용자 정의 TUI를 추가하면 Launch Extension이 View 선택과 렌더링 책임을 계속 흡수할 수 있다.

사용자가 원하는 것은 **특정 Dashboard를 사용하는 Harness가 아니라,
필요한 Extension·Skill·View를 스스로 조합할 수 있는 Pi 환경**이다.

[my-pi](https://github.com/Jonghakseo/my-pi)는 이 철학의 참고 사례다.
해당 저장소의 디렉터리 구조를 그대로 복제하는 것이 아니라,
**Pi가 제공하는 리소스 발견·설치·선택 기능을 재사용한다**는 원칙을 참고한다.

## 결정

1. **Pi Compose 기본 Package는 Launch Extension 하나만 자동 로드한다.**
   `package.json`의 `pi.extensions`에는 `extensions/compose.ts`만 등록한다.
2. **workmux Dashboard는 선택형 Pi Extension으로 제공한다.**
   `extensions/optional/workmux-dashboard.ts`는 `/compose-workmux` 명령만 등록한다.
   기본 Extension 디렉터리의 자동 탐색 대상인 루트 `*.ts`나 하위 `index.ts`로 두지 않는다.
3. **사용자는 Pi가 지원하는 명시적 Extension 로딩 방식으로 View를 추가할 수 있다.**
   한 번의 실행은 `pi -e /path/to/pi-compose/extensions/optional/workmux-dashboard.ts`,
   계속 사용하려면 Pi 사용자·프로젝트 설정의 `extensions` 리소스 경로를 사용한다.
4. **CLI의 `pi-compose dashboard`는 기존 명령 호환성을 위해 유지한다.**
   이는 외부 도구를 직접 요청할 수 있는 명시적 진입점일 뿐,
   Pi 기본 Extension에서 Dashboard를 자동 로드하거나 상태를 관리한다는 의미가 아니다.
5. **새로운 View Provider·Registry·Plugin Host는 만들지 않는다.**
   Pi 내부 View는 `ctx.ui.custom()`·`setWidget()` 등 Pi Extension API를,
   외부 View는 해당 도구의 공개 명령·기존 프로세스를 사용한다.
6. **Launch의 작업 공간 실행 의존성은 별개의 문제다.**
   현재 Worktree Launch는 `workmux add`를 이용한다.
   Dashboard를 제거해도 Launch는 로드 가능하지만,
   **Worktree Launch 실행 시에는 여전히 workmux 실행 파일이 필요**하다.
   이를 숨기거나 지금 당장 범용 Backend Adapter 계층을 만들지 않는다.

## 선택형 View 로딩 예시

```bash
# 기본 Pi Compose 로컬 Package는 Launch만 활성화
pi install /absolute/path/to/pi-compose

# 필요한 한 세션에서만 workmux View 추가
pi -e /absolute/path/to/pi-compose/extensions/optional/workmux-dashboard.ts
```

지속적 사용을 원하면 `~/.pi/agent/settings.json` 등 Pi가 인식하는 설정의
`extensions`에 **해당 Extension 파일의 실제 경로**를 추가한다.
`package.json`의 명시적인 `pi.extensions` 목록 밖에 있는 파일은
`packages[].extensions` 필터만으로 다시 노출할 수 없다.

이 예시는 **로컬 소스 체크아웃을 기준으로** 한다.
별도의 배포 패키지로 사용자가 설치할 필요가 실제로 발생하면
그때 Pi Package로 분리할지를 검토한다. 지금 추가 npm 패키지를 만들지 않는다.

## 변경 범위

- `extensions/compose.ts`에서는 Dashboard 분기와 workmux import를 제거한다.
- 기존 `src/dashboard.ts`는 workmux 전용 호출 헬퍼로 유지한다.
- 선택형 Extension은 workmux 명령만 호출하며 Launch·세션 관리 구현을 소유하지 않는다.
- `bin/pi-compose.ts dashboard`는 유지한다.
- 테스트는 **기본 설치 시 View 미로딩**과 **View 단독 로딩**을 별도로 확인한다.

## 비교한 대안

| 대안 | 장점 | 선택하지 않은 이유 |
| --- | --- | --- |
| 기존 `compose.ts`에 모든 View 명령 추가 | 파일 적음 | Launch와 View의 활성화·변경 주기 결합 |
| `workmux` Dashboard를 기본 로드 | 별도 설정 없이 UI 제공 | 원하지 않는 View·tmux 요구를 사용자에게 강제 |
| Pi Package 안에 사용자 정의 Plugin Registry 구현 | 일관된 인터페이스 제공 가능 | Pi 자체 리소스 관리와 중복, 구축·관리 비용 증가 |
| 모든 View별 독립 npm Package를 즉시 생성 | 개별 배포 편의 | 초기 배포·버전 관리 비용 불필요 |
| **Pi Package 기본 Launch + 선택형 Pi Extension** | 작은 변경, Pi 호환, 기능 독립 선택 | 선택형 View는 사용자가 명시적으로 로드해야 함 |

## 수용 기준

- 기본 Pi Compose만 로드한 경우 `/compose launch`·`/compose preview`와 `compose_launch` Tool은 존재한다.
- **`/compose-workmux`는 사용자가 선택형 View 파일을 별도로 로드하지 않으면 등록되지 않는다.**
- 선택형 View만 로드했을 때 Launch Tool이나 세션 관리 로직이 추가로 등록되지 않는다.
- View를 사용하지 않아도 네 가지 Launch 실행 조합과 명시적인 사용자 실행 권한이 유지된다.
- View를 닫거나 교체하더라도 Pi 세션, 작업 공간, Git 상태를 임의로 삭제하지 않는다.
- 별도 Viewer·TUI 구현 시 기존 Launch Extension을 수정할 필요가 없다.

## 남은 검증

- 실제 Pi 버전에서 명시적인 로컬 Extension 로딩과 리소스 필터링 결과.
- 사용 중인 tmux/workmux 버전에서 팝업, 상태 Hook, Shared/Worktree 세션 관찰 여부.
- 선택형 View를 향후 npm/git 기반으로 별도 배포할 필요가 있는지.

**미검증 기술 사항은 실제 연동 단계에서 확인한다. 제품의 조합 가능성을 그 때문에 축소하지 않는다.**
