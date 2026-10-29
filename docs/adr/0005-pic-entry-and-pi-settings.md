# ADR 0005 — `pic` 진입점과 Pi 설정 공유

- 상태: **이전 CLI·설치 구현의 역사적 기록 — 2026-10-30 새 Ghostty 방향에 대한 현재 실행 지침이 아님**
- 일자: 2026-10-25
- 선행: [ADR 0004](0004-pi-native-optional-views.md)
- 실행 명령 변경: 초기 구현은 `pico`였으며 이후 시스템 편집기 충돌을 피하기 위해 `pic`으로 변경했다. 아래 결정과 예시는 현재 이름 기준이다.
- [기존 설치에서 새 이름으로 변경한 macOS 검증](https://github.com/SEONGMINY/pi-compose/actions/runs/40186852376)

> 이 문서에 나타난 tmux/workmux·선택형 View/설치 절차는 과거 실제 코드 기준입니다. 새로운 제품 방향은 [PRD](../PRD.md)를 참조하세요. 현재 코드·설치 스크립트가 새 Ghostty 흐름을 구현했다는 뜻은 아닙니다.

## 문제

현재 Pi Compose의 CLI는 `launch`, `resume` 등 실행 명령만 제공한다.
Pi 내부에서는 기본 Extension을 따로 등록하거나 경로를 전달해야 했다.
선택형 Dashboard·Handoff·Verify는 파일 경로를 알아야 활성화할 수 있었고,
설정 파일을 직접 편집하게 만드는 비용이 있었다.

## 결정

1. **`pic`는 기존 `pi` 프로세스의 얇은 실행 진입점**이다. 직접 Runtime·TUI·세션 관리 기능을 구현하지 않는다.
2. npm 전역 설치를 위해 `package.json`의 `bin.pic`를 선언한다.
   실행 파일은 현재 cwd, Pi 인증·모델·세션·사용자/프로젝트 설정을 그대로 사용하고
   `extensions/compose.ts` 하나만 `--extension`으로 명시한다.
3. `pic`는 Pi의 모델·세션·기타 옵션을 그대로 전달한다. Pi 내장
   `config`·`install`·`remove`·`list`·`update`·`auth`·`mcp` 명령은
   **Pi CLI에 그대로 위임**하며 Compose Extension 인자를 추가하지 않는다.
4. Dashboard·Handoff·Verify는 **별도 로컬 Pi Package**인
   `packages/optional`로 제공한다. 하나의 Pi 설치 단위로 묶고 각 기능은
   `pi config`의 리소스 선택 UI에서 개별적으로 활성화·비활성화한다.
   그 외에 자체 Registry·설정 DB·TUI를 만들지 않는다.
5. `pic features [--local]`는 선택형 묶음을 **명시적으로**
   `pi install`하고 `pi config`를 열어주는 진입점이다.
   **현재 Pi 버전에서는 패키지 설치 직후 셋 모두 활성화**된다.
   불필요한 기능은 Pi config에서 끈다. 일반 `pic` 사용이나
   `pic config`만으로는 선택형 패키지를 설치하지 않는다.
6. 사용자 설정은 Pi가 소유한다. **`pi`와 `pic`의 선택형 Extension 설정은 공유**한다.
   `pic` 시작만으로 `settings.json`을 생성·삭제·변경하지 않는다.
7. 과거 `pi install <pi-compose 루트>`로 등록한 사용자의 설정은 변경하지 않는다.
   Pi의 리소스 경로 중복 제거에 의존하고, 필요 시 사용자가 `pi list`·`pi remove`로 정리한다.
8. 로컬 설치/배포에서는 Pi Runtime을 peer로 취급한다. npm 전역 설치 시
   peer를 자동으로 두 번 설치하지 않도록 optional peer 메타데이터를 추가했다.

## 선택하지 않은 접근

| 방식 | 결정 이유 |
| --- | --- |
| Shell Alias만 사용 | 매 사용자마다 Shell 수정과 위치 입력이 필요 |
| `pic` 전용 settings.json | Pi 설정·전역/프로젝트 우선순위와 중복 |
| 현재 루트 Package에 모든 Extension 등록 | 기본 Launch만 선택적으로 제공한다는 기존 결정을 훼손 |
| 모든 Extension마다 개별 공개 npm Package | 배포·버전 관리 비용 증가 |
| Pi config 기능 전체를 직접 복제 | 기존 Package Manager와 리소스 상태 관리 중복 |
| 설치 시 일반 Pi 설정 자동 수정 | 일반 `pi` 실행 환경에 예기치 않은 영향 |

## 검증 및 남은 한계

- **2026-10-25 격리 Ubuntu runner:** Node 22.19.0 / Pi 1.4.0에서 npm 전역 설치,
  `pic` 실행, 인자·cwd·종료 코드 전달, 선택형 Pi Package 등록,
  TypeScript 검사와 기존 Extension 테스트 24개 통과.
  [실제 실행 기록](https://github.com/SEONGMINY/pi-compose/actions/runs/40182260770).
- `pic features` 이후 Pi config에서 리소스 활성화/비활성화가 실제 적용되는지 확인한다.
- Pi 환경과 npm 전역 설치 방식에 따라 실행 파일 권한·경로와 peer 처리 결과가 다를 수 있어
  실제 설치 결과를 기준으로만 검증 완료라 기록한다.
- 설치된 Pi 패키지를 `pic`가 별도 파일로 추적하거나 자동 제거하지 않는다.
- **선택형 묶음 설치 시 세 기능이 한 번에 활성화되는 초기 상태는 남는 불편함**이다.
  향후 Pi 자체 리소스 기본 비활성 설정을 활용할 수 있는지 확인하고,
  실제 요구가 생길 때만 구현을 변경한다.

[README](../../README.md) · [Implementation Plan](../IMPLEMENTATION_PLAN.md)
