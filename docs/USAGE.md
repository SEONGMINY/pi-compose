# Pi Compose 사용 흐름

[← README](../README.md) · [제품 정책](PRD.md)

> 이 문서는 2026-11-09 확정된 Sidebar 제거·Main 직접 실행 정책을 설명합니다. 해당 변경은 작업 브랜치의 코드이며 macOS Ghostty 실사용 검증을 거치기 전입니다. 이전 Overview / Summary Overlay 경로는 현재 목표 UX가 아닙니다.

## 1. Main 시작과 복구

```bash
cd /path/to/project
pic                  # 새 Main 세션을 현재 터미널에서 시작
pic -r               # Pi의 기존 세션 선택 창
pic -c               # 이 디렉터리에서 가장 최근 Pi 세션 계속
pic --session <ID>    # 특정 Pi 세션
```

- bare `pic`은 매번 신규 Main이며, 저장된 세션을 자동 선택하거나 Overview를 열지 않습니다.
- Pi 자체 `/resume`, `/new` 기능은 계속 사용할 수 있습니다.
- `-c`는 최근 세션을 재개할 뿐 Main 우선 선택이 아닙니다. 저장된 Work/Support는 역할을 유지합니다.
- 신규 Main의 프로젝트 신원은 정규화된 작업 디렉터리의 안정적인 해시로 정합니다. 같은 디렉터리에서 새 Main을 만들어도 세션 ID는 매번 다릅니다.
- 같은 Pi 세션을 두 프로세스에서 중복 재개하는 동작을 자동 방지한다고 보장하지 않습니다. 이미 실행 중인 세션이라면 해당 터미널로 돌아가세요.

## 2. 실제 개발 작업 위임

Pi TUI의 **입력 첫머리**에 다음 명령을 사용합니다.

| 입력 | 동작 |
|---|---|
| `>w 작업` | 현재 Pi 활성 완료 분기를 Fork한 Work 생성 |
| `>>w 작업` | Work Fork + 현재 Git HEAD 기준 새 Worktree 생성 |
| `>s 작업` | 맥락을 상속하지 않는 독립 Support 생성 |
| `>>s 작업` | Support + 별도 Git Worktree |
| `>w @세션ID 작업` | 같은 제품/프로젝트의 저장된 특정 Pi 세션을 찾아 Fork |

- 호출한 Pi가 있는 **현재 Ghostty Terminal을 확인하고 그 오른쪽으로 Split**합니다. 더는 Sidebar UUID가 필요하지 않습니다.
- Work Fork의 원본 대화 트리와 활성 완료 분기를 확인합니다. Work 로그는 Main 대화에 자동으로 복사하지 않습니다.
- Support는 독립 세션입니다. 컨텍스트가 필요한 작업을 Support에 임의로 보내지 않습니다.
- 새 Split 영수증은 Ghostty가 표면을 만들었다는 뜻이지 Pi가 시작됐거나 업무를 완료했다는 확인이 아닙니다.
- `>>`의 새 Worktree는 원본 미커밋 변경을 복사하지 않습니다. 작업 종료 시 Git 브랜치 병합·삭제도 자동 수행하지 않습니다.
- Agent 생성은 사용자 입력에 의해서만 시작합니다. 모델이 자동으로 생성하거나 병렬화하지 않습니다.

## 3. Work 실행 중 Handoff 요청

```text
Work가 응답/도구 실행 중
  사용자: <   또는   < @수신자
  Pi Compose: 요청 접수 (Work에 모델 메시지 주입 안 함)
  Work: 기존 작업 계속
  Work 응답 정상 종료
  Pi Compose: Handoff 검토 가능 안내 (모델 호출/전송 없음)
  사용자: <
  Pi Compose: 수신자 확인, 근거 기반 초안 생성, 출처 검토
  사용자: 직접 승인 또는 취소
  pi-intercom: 승인된 메시지만 전송 요청
```

이 방식은 **실행 중 요청 허용**과 **검토 시 초안 생성**을 구분합니다. 요청한다고 Work를 중단하거나 Handoff 내용을 미리 모델로 생성하지 않습니다.

- 동일한 Work 실행 중 반복 요청은 중복 예약하지 않습니다.
- 실행 중단·오류로 완료된 Assistant 보고가 없다면 대기 요청을 폐기하며 성공으로 표시하지 않습니다.
- 요청 이후 새로운 Work 실행을 시작하거나 분기가 바뀌면, 오래된 기록을 다른 실행 결과로 오인하지 않도록 요청을 재확인합니다.
- 대기 요청은 현재 Pi 프로세스 메모리에만 존재합니다. 프로세스를 종료·재시작하면 복구되는 기능은 아닙니다.
- 사용자가 Handoff를 검토하지 않으면 초안을 생성하지 않고 메시지도 보내지 않습니다.
- `<<`에는 기능을 부여하지 않습니다.

## 4. Handoff 근거와 Main 보호

기존 Compose Handoff는 완료된 Work 답변, 최근 사용자 지시, 일부 도구 출력에서 원문을 발췌해 Pi Entry ID와 함께 전달합니다. 인용문이 원본에 존재하는지 검사합니다.

- 원본 문구가 존재한다는 사실만으로 승인 주체·부정문·검증 범위가 정확히 해석됐다고 보장하지 않습니다.
- `테스트 코드 존재`와 `테스트 실행 완료`, `Work의 제안`과 `사용자의 승인`은 별개입니다.
- Main이 받는 메시지는 검토 자료입니다. 사용자 승인 없는 정책 변경이나 자동 개발 명령이 아닙니다.
- `/compose handoff`는 기존 수동 Handoff 경로, `/compose messages`는 기록 확인 경로입니다.
- `pi-intercom`이 없는 경우, 수신 대상 신원이 확인되지 않는 경우, 원본 출처가 바뀐 경우 전송하지 않습니다.
- Outbox 전송 성공과 Main 모델 처리 완료는 별도 증거입니다.

## 5. 레퍼런스 재사용과 미구현 사항

- [Pi 1.4.0](https://github.com/earendil-works/pi): 세션·Fork·기본 TUI/Resume·`input` / `agent_settled` 이벤트
- [pi-intercom 0.18.1](https://github.com/nicobailon/pi-intercom/tree/v0.18.1): 메시지 전달 및 Handover의 로딩·취소·편집 레퍼런스
- [pi-ask-user](https://github.com/edlsh/pi-ask-user): 사용자 질문·선택·자유 입력 레퍼런스

**미구현:** Handoff 초안을 Agent가 사용자 피드백에 따라 반복 재작성하는 통합 경험. `pi-ask-user`의 `ask_user`는 모델 전용 도구이므로, 현재 독립 `streamSimple()` 호출에 Skill을 설치하는 것만으로 연결되지 않습니다. 해당 부분은 별도 호환성·정확성 검증 후 진행합니다.

## 6. 직접 실사용 확인할 항목

1. macOS Ghostty에서 `pic` 실행 시 Sidebar가 없고 Main이 현 터미널에서 시작되는지
2. 새로운 Main의 응답 완료 후 `>w`/ `>s`가 같은 Ghostty Tab에서 별도 Split을 만드는지
3. `pic -r`로 Work를 복구하면 역할과 원래 Fork 관계가 유지되는지
4. Work 실행 중 `<`를 제출해도 Work가 Steering·중단되지 않는지
5. Work가 종료돼도 Main으로 자동 전송되지 않고, 사용자 검토·승인을 거쳐서만 전송되는지
6. Work 중단·세션 변경·수신 Main 오프라인 상태에서 안전하게 전송을 막는지

코드 반영과 실사용 검증은 별도로 기록합니다. 실사용 테스트 결과가 없다면 검증 완료라고 표현하지 않습니다.
