# Pi Compose — README 작성 근거 및 실제 사용 흐름 확인

> 2026-10-26. 본 문서는 README에서 설명한 경험이 현재 구현과 어디까지 일치하는지 정리하기 위한 기록입니다. **제품 기능 변경은 수행하지 않았습니다.**

## 가장 먼저 보여주기로 한 것

기존 README는 Context·Workspace 선택 화면을 먼저 보여줬습니다. 둘 다 같은 종류의 선택 UI였고, **선택 이후 실제 실행 대상이 생겼는지, Main이 남아 있는지**를 설명하지 못했습니다.

새 README에서는 실제 macOS의 **Independent + Shared Launch 이후 출력**과 `tmux list-sessions`를 첫 자료로 선택했습니다. 하나의 실제 분할 화면처럼 속이지 않고, 서로 다른 두 출력의 **일부를 재배치한 SVG**라고 명시했습니다.

- 기존 피커 이미지: `docs/assets/compose-context-picker.svg`, `docs/assets/compose-workspace-picker.svg`는 보존하되 README 본문에서는 사용하지 않습니다.
- 현재 대표 이미지: `docs/assets/compose-after-launch.svg`
- 본문에서 Mermaid 제거: 실제 화면과 함께 놓으면 실행 경험보다 구조 설명이 먼저 오는 문제가 있었기 때문입니다.

## 확인한 시나리오

| 시나리오 | 재현·구현 근거 | 해석 및 한계 |
| --- | --- | --- |
| A: Main에서 새 개발 에이전트 시작 | [macOS TUI에서 선택 후 Independent+Shared Launch](https://github.com/SEONGMINY/pi-compose/actions/runs/40226451266). `tmux`에서 Main과 새로운 `pc-...` 세션이 각각 확인됨 | Main 유지와 프로세스 시작을 확인. 인증된 모델의 코드 작성·원본 대화 Fork 성공은 **미확인** |
| A: Worktree 준비 | [macOS workmux 연동](https://github.com/SEONGMINY/pi-compose/actions/runs/40226451266). `feat/docs-research` Worktree가 Git·workmux 목록에 실제 생성됨 | 파일 공간과 tmux 창 생성 성공. 해당 창의 모델이 실제 개발을 진행하는지는 **미확인** |
| B: Independent | 위 Independent+Shared 및 Independent+Worktree 실행 결과 | 원본 Pi 세션을 인수로 전달하지 않는 구조를 확인. 모델의 대화 맥락 격리를 실제 응답으로 비교한 것은 아님 |
| C: 이전 작업 찾기 | 실제 macOS `/compose back` 선택 UI 출력, `extensions/work-return.ts` | 선택 UI 표시 확인. 복귀 후 모델과 계속 대화하는 경험은 **미확인**. 기본 탐색은 저장된 Pi 대화와 workmux 대상만 포함 |
| D: Handoff | `extensions/optional/handoff.ts`의 명시적 명령과 Git 결과 수집 로직 | **구현 확인**, 인증된 모델로 실제 보고서를 생성·전송한 end-to-end 실행은 미확인 |
| D: Verify | `extensions/optional/verify.ts`의 독립 `pi --print --no-session` 및 읽기 전용 도구 호출 | **구현 확인**, 모델이 반환한 실제 검증 보고와 Main 인계까지 미확인 |

테스트 환경에는 모델 로그인/API 키가 없어 새 Pi 세션에서 **`No API key found`**가 표시됐습니다. 해당 오류를 숨긴 상태로 모델이 일하는 이미지를 만들지 않았습니다.

## 문서 문제와 제품 사용성 문제를 구분하기

| 관찰 | 구분 | 후속 검토 |
| --- | --- | --- |
| 피커 화면 두 장으로는 실제 시작 결과가 보이지 않음 | README | 실행 후 Main과 새 tmux 세션이 남는 실제 캡처를 소개 |
| Launch 성공 메시지가 실제 모델 준비 상태를 보장하지 않음 | 제품 상태 가시성 | 사용자가 작업 상태와 준비 상태를 한 곳에서 구분할 수 있는지 검토 필요 |
| Shared Directory의 새 tmux Session은 `/compose back` 조회 목록에 포함되지 않음 | 제품 탐색 경험 | Pi 저장 세션·workmux·tmux를 어떻게 하나의 작업으로 묶을지 검토 필요. 지금은 README에 제한 사항 명시 |
| Main과 개발 에이전트를 한눈에 보여주는 기본 View가 없음 | 제품 사용자 경험 | Dashboard는 선택형 workmux View; 모든 Shared 작업을 통합해서 보여주지 않음 |
| Handoff·Verify가 자동으로 Main에 정보를 전달하는 과정이 아님 | 제품 흐름 | 사용자가 명시적으로 실행·수신·확인해야 하는 범위를 유지하거나 개선 논의 필요 |
| 전체 모델 기반 실행을 확인하지 못함 | 검증 범위 | 사용자 환경에서 인증 후 Fork→개발→인계→검증→복귀를 한 번 이어 실행할 필요 |

**이 문서 작업에서는 제품 사용성 문제를 해결하기 위해 Core·Extension·CLI를 변경하지 않았습니다.**

## 참고 자료가 실제 판단에 미친 영향

- [Pi 공식 README](https://github.com/earendil-works/pi): 프로젝트 소개와 설치를 짧게 유지하고, 기존 Pi가 제공하는 기능을 Pi Compose의 고유 기능으로 소개하지 않는 기준에 사용
- [my-pi](https://github.com/Jonghakseo/my-pi): 실제 TUI를 앞에 놓는 방식을 참고. Pi Compose의 경우 사용자에게 가치가 작은 두 선택 메뉴 대신 **선택 후 결과**를 우선
- [PRD](../PRD.md), [Domain Stories](../domain-stories/01-as-is-and-pain-points.md): Main의 설계 이유·제약 보존과 사용자 관리 부담 감소를 첫 메시지로 선택
- [Architecture](../ARCHITECTURE.md), [ADR](../README.md): Pi/Git/tmux/workmux 역할과 Context·Workspace의 독립적 선택을 과장 없이 기술
- [Implementation Plan](../IMPLEMENTATION_PLAN.md), [기존 통합 기록](phase6-integration.md): 기능 구현과 실제 모델 기반 통합 검증을 구분하는 기준

[← README](../../README.md)
