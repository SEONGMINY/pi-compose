# Handoff P1–P5 구현 및 누락 감사 (2026-11-10)

> **기록의 범위(2026-11-10):** 아래는 PR #25의 기존 자동 후보·`ask_user`·`/compose inbox` 코드에 대한 구현/검증 감사입니다. 이후 사용자는 **Work `<`에서 명시적으로 결과를 보내고, Main은 수신 알림만 받으며 Inbox 명령 없이 필요할 때만 컨텍스트에 반영**하는 단순 UX를 새로 확정했습니다. 아래 검사 통과·키 조작이 최신 UX 구현 또는 macOS 실사용 검증을 증명하지 않습니다. 최신 정책은 [PRD](PRD.md)를 우선합니다.

상태: **P1–P5 코드 작성·GitHub Actions(Node 22/Ubuntu)에서 npm run check 통과. 실제 macOS/Ghostty 통합 E2E는 미검증.** CI의 정적·단위 검증과 실사용 결과를 혼동하지 않습니다.

## 확정된 계약

- 선택된 후보와 그 의미를 보존하는 데 필요한 근거·WHY·조건·범위만 공유한다. 무관한 후보를 포함하지 않는다.
- Work는 Pi Fork 당시 기록과 자신의 활성 분기만 본다. Fork 이후 Main 대화를 읽지 않는다.
- 수신 Main은 대화 주입 및 모델 실행 없이 로컬 보관함에 저장한다.
- 사용자가 `/compose inbox`에서 항목을 선택했을 때 **현재 Main 활성 분기**를 기준으로 비교한다. Compaction·ContextEdit을 적용한 Pi projection을 사용한다.
- 수신과 검토, 모델 논의, 선택적 정보 반영, 정책 승인, Git 병합은 각각 다른 상태다.
- 모델 검토 또는 문자열 인용이 실제 구현 성공/테스트 통과/사용자 승인을 증명하지 않는다.

## 단계별 구현 대조

| 단계 | 코드 위치 | 실제 구현 | 남은 외부 검증 |
| --- | --- | --- | --- |
| P1 근거·선택 정보 계약 | `src/handoff/package.ts` | 고정 후보 ID, 선택 범위, 후보 설명과 출처 원문 인용의 동시 보존, 필수 맥락, 발송 본문 해시, Work 출처 신원 | 실제 Pi Compaction·ContextEdit·깊은 Fork에 대한 provenance |
| P2 Work 결과 검증 | `extensions/handoff-ready.ts`, `extensions/handoff-package.ts`, `src/handoff/quality.ts` | 기존 ask_user 유지, 후보 ID 매핑, 선택된 후보만 포함, Fork 기록에서 조건/WHY 선택, 독립 의미 검사, 보완 요청, 실패 시 전송 차단 | 기존 4차 실험 원본 사례 전체의 동일 모델 재실행 및 모델 오탐률 |
| P3 Main 수신 보관 | `src/handoff/store.ts`, `extensions/handoff-inbox.ts` | 0700 디렉터리·0600 파일, ID별 영속 보관, 원자적 생성, 재개 시 검색, 프로젝트별 Extension Channel 알림(본문 미전송), Main 메시지 비주입 | macOS 파일시스템 crash/reconnect, 여러 Main, 세션 전환, 오프라인 전달 |
| P4 Main 최신 분기 비교 | `src/handoff/compare.ts` | 검토 요청 시 읽기 전용 별도 모델 호출, Pi projection 기반 관련 내용·최신 내용 추출, 시간 순서 포함, new/duplicate/conflict/insufficient 근거 ID, 분기 변화 중단 | 긴 Main 기록의 실제 회수율, 최신 승인/부정문/WHY 판단 정확성 |
| P5 Main 수신 UX | `extensions/handoff-inbox.ts`, `src/handoff/import.ts` | /compose inbox, 상세·근거 O, 명시적 논의 D(도구 비활성), 신규 보고만 선택적 반영 I, 중복 C, 보관 A, 보류 Esc, 미리보기와 전달 범위 구분 | 실제 Ghostty/Pi 화면에서 키 동작·장문 스크롤·저장 및 재개 |

## P1–P5 이후 같은 배치에 추가 구현

- Work `R` 보완 요청 후 원문 검색·품질 검사를 다시 수행하고 `S`에서 실제 본문을 명시적으로 승인한다.
- Main의 기존 승인 결정과 Work 보고의 권위를 분리한다. 새로 반영되는 정보는 확인된 정책이 아닌 *reported-only Work report*로 남긴다.
- Main에서 `D` 또는 `I`를 누르기 전까지 Main 모델을 호출하지 않고, 모델 대화가 시작되는 해당 턴에서는 실행·파일·위임 도구를 비활성화한다.
- Extension Channel은 제품별 네임스페이스로 격리하고, intercom 늦은 등록을 재시도한다.
- 기존 `<` 자동화/수동 경로에서 Main으로의 일반 intercom Outbox 우회 전송을 차단한다.
- 제한된 단위 회귀 테스트 추가: `handoff-package`, `handoff-main-comparison`, `handoff-import`. 자동화 검증 통과는 미확인.

## 기존 연구의 실패 유형 → 회귀/검증 연결

| 과거 관측 | 방어·평가 | 남은 것 |
| --- | --- | --- |
| '제거하면 안 됨'의 부정문 반전 | 원문 그대로 포함, 독립 의미 검증의 negation 검사 | 과거 원본 corpus를 그대로 사용한 판단 시험 |
| Work의 제안을 사용자 승인으로 오인 | 주장의 권위·보고 상태 구분, Main 반영을 명시적 행동으로 분리 | 실제 모델이 정책 승인으로 잘못 받아들이지 않는지 평가 |
| 미확인·미실행·계획·통과 혼동 | toolResult를 무조건 실행 성공으로 승격하지 않음, test-status 검토 | 실제 도구 exit code/실행 범위 의미 판단 사례 |
| 기존 WHY 누락 | 필요한 맥락 검색 + 별도 의미 감사 시 historical Fork 원문 제공 | 초기 Main 정책이 원본에서 멀리 떨어진 긴 세션 검증 |
| 맥락을 더 많이 넣었을 때 후속 판단 악화 | 선택 단위별 근거·필수 맥락만 전달, 수신 Main 최신 결정과 비교 | 기존 실험 조건 그대로 후속 판단 시험 |
| Fork 이후 Main 최신 정책과 충돌 | Work는 최신 Main을 읽지 않고, Main 검토 시점에서 연대기 있는 Pi projection 비교 | Fork 이후 대체 결정 실제 Pi 세션 시험 |
| 중요하지 않은 Work 로그 누적 | 패키지 미리보기·관련 증거만 보관, Main 자동 주입 금지 | 실제 토큰 비용·판단 품질 비교 |

연구의 기존 통과 수치는 제품의 실제 실패율이나 새 구현의 정확도를 나타내지 않는다. **원본 실험 ZIP을 이 작업에서 그대로 실행한 것은 아니다.** 누락된 원본 corpus 없이 임의의 수치를 재산출하지 않는다.

## 반드시 검증할 위험과 기능 경계

1. **macOS 실사용 미검증**: GitHub Actions Node 22/Ubuntu에서 `npm run check`가 성공했다. 그러나 Ghostty Native Split, 실제 Pi/ask_user/intercom 확장 조합의 수신·키 입력·재접속은 사용자 Mac에서 아직 실행하지 못했다.
2. **독립 의미 검증의 한계**: 별도 모델 평가도 근거·조건 누락을 놓칠 수 있다. 구조·원문 존재·해시 검사와 결합하되 확정 사실 판정기로 취급하지 않는다.
3. **원본 탐색 범위**: Work에서 제한된 Fork/작업 기록만 선택하므로 극단적으로 긴 Compaction/ContextEdit 사례는 아직 검증되지 않았다.
4. **전송 복구 검증 필요**: 발신 Work가 파일 저장 후 수락 기록을 쓰기 전에 종료되는 상황을 위해 리뷰·수신자·선택·수정 요청 기준의 안정적인 패키지 ID 및 기존 파일 복구 코드를 추가했다. 그러나 실제 프로세스 강제 종료·재개·반복 발송 E2E는 아직 미실행이다.
5. **알림은 확인증이 아님**: Extension Channel 알림 실패가 패키지 본문 유실을 뜻하지 않는다. 수신·모델 처리·정책 승인 상태를 분리해야 한다.
6. **보안 경계**: 로컬 동일 사용자 계정의 접근만 우선 지원한다. 사용자 계정 자체가 탈취된 경우나 악성 확장은 보호 범위 밖이다.
7. **UI 접근성**: 키보드 키 충돌, 화면 높이, 실제 질문/미리보기 자동 포커스, 장문 근거 렌더링 확인 필요.
8. **Main 정책 보호**: 일반 pi-intercom의 외부 수동 메시지는 별도 플러그인의 기능이다. Compose의 보호형 Handoff 경로만 강제하며 pi-intercom 자체를 모든 메시지에서 차단했다고 주장하지 않는다.

## 완료 판정

- **구현 충족**: P1~P5 코드 경로와 P6의 일부 자동 회귀 테스트를 작성했다.
- **자동 검증 완료**: GitHub Actions Node 22/Ubuntu의 `npm run check`(TypeScript + 모든 테스트) 통과. 예: [성공한 실행](https://github.com/SEONGMINY/pi-compose/actions/runs/42771786319).
- **실사용 검증 보류**: Ghostty/Pi Main·Work의 선택·수신·비교·보류, 모델 오류 시 fail-closed, 종료/재개, 중복 전송은 macOS에서 직접 확인할 것.
- **PR 정책**: 검증 확인 전 Draft 유지, main 병합 금지.


## 2026-11-10 구현 후 추가로 발견해 보완한 누락

- 후보 선택 결과에서 **사용자가 보았던 설명(description)**이 실제 전달문에서 사라질 수 있었습니다. 후보 요약을 'AI가 제안한 요약, 독립 검증 전'으로 명시하고 원문과 함께 전송하며 의미 검증 대상으로 포함했습니다.
- Work가 다른 Work에서 Fork될 때 `forkMainSessionId`가 원본을 Main이라고 잘못 표기할 수 있었습니다. 정확한 `forkSourceSessionId`로 수정했습니다.
- Main 채널 이름이 모든 프로젝트에서 같아 Handoff 존재 메타데이터가 다른 프로젝트에 보일 수 있었습니다. 제품별 분리된 namespace를 사용합니다.
- Main 비교 자료를 관련성 점수 순서만으로 모델에 제공하면 **이전 정책과 최신 정책의 시간 순서**를 오해할 수 있었습니다. Pi 활성 projection에서 추출한 기록의 원래 순서를 보존합니다.
- Main에서 논의를 선택한 경우 기존 파일/실행 도구가 활성일 수 있었습니다. 사용자가 선택한 해당 모델 턴 동안 도구를 비활성화합니다.
- Main의 정보 '반영'과 단순 논의·보관을 혼동할 수 있었습니다. `I`는 신규 가능성이 있는 Work 보고만 비정책성으로 반영하고 `D`는 단순 논의로 구분합니다.
- Work에서 품질 검사 실패 후 수정 요청이 불가능했습니다. `R` 보완 후 재검색·재평가·미리보기로 복귀합니다.
- 저장 성공 직후 Work가 강제 종료된 경우에 대한 멱등 복구 경로가 없었습니다. 안정적인 패키지 ID와 기존 파일 재사용 경로를 추가했습니다.

**아직 해결 완료라고 단정할 수 없는 항목:** TypeScript와 단위 테스트는 Linux CI에서 통과했습니다. 실제 Mac 프로세스와 원본 4차 실험 ZIP 전체의 판단 품질 재현은 아직 수행하지 못했습니다. CI 성공을 두 검증의 대체물로 해석하지 않습니다.

## 2026-11-10 추가 코드 감사: 확인한 결함과 수정

- **P5 렌더 오류**: `importBody`를 선언하기 전에 참조해 Main 검토 UI가 열리지 않는 결함을 수정하고, 인바운드 미리보기 테스트 추가
- **P2/P5 도구 보호**: `setActiveTools`만으로 Pi의 deferred/codemode 도구가 차단되지 않음. Work ask_user 턴은 ask_user만, Main 검토 턴은 도구 전체를 `tool_call` 단계에서 거부하도록 보완
- **P1/P2 오래된 결정 누락**: Work 기록 최근 36개/품질 감사 최근 18개 고정 방식 제거. 전체 활성 Fork/Work 분기에서 관련성 높은 근거·초기 사용자 조건·최근 메시지를 함께 선택하는 유한 검색과 회귀 테스트 추가. 검색이 완전성을 증명하지는 않음
- **P3 수신 보호**: Compose 일반 Outbox에서 Main 대상 전송을 옵션에 관계없이 차단. 별도의 pi-intercom 플러그인 전체를 차단한 것은 아님
- **P3 파일 안전성**: `O_NOFOLLOW`로 연 파일 핸들에 대해 검사 후 읽어 symlink swap 경합 방어
- **P3/P5 진행 상태**: `pi.sendMessage`가 턴을 큐에 넣었다는 사실과 모델의 실제 처리 완료를 혼동하지 않도록 `discussion-requested`, `import-requested` 상태 추가. 요청 상태도 Main inbox 목록에서 확인 가능
- **P5 오래된 Work 결과**: 마지막 후보 검토 뒤 Work 대화가 추가됐다면 과거 패키지 자동 전송을 보류
- **P5 사용성**: 요청 처리·보관·중복 상태를 재확인하고 이미 검토한 항목을 신규 목록에서 제거
- **P7 문서**: README/ARCHITECTURE/TRD/PLAN의 기존 editor→일반 Outbox 설명을 현재 보호형 Handoff 경로와 일치하도록 정정
- **실제 자동 검증**: GitHub Actions 워크플로 추가. 초기 타입 오류 4건(`src/overview.ts`의 Legacy narrowing 3건, 후보 테스트 fixture 1건)을 수정한 후 실제 `npm run check` 성공 확인

### 합의가 필요하거나 실제 검증이 남은 중요한 경계

1. **의미 품질의 충분성**: 관련성 검색이 오래된 WHY를 찾아도, 선택된 맥락이 Main의 올바른 후속 판단을 보장하지 않는다. 기존 Handoff 실험 원본 전체의 동일 조건 재실행은 별도 필수
2. **발송 차단 정책**: 필수 맥락 검색·품질 감사가 실패하면 현재 Work의 S 승인 버튼 자체를 비활성화한다. 사용자에게 불확실성을 표시한 제한적 전달을 허용할지는 제품 정책 미결정
3. **모델 처리 증거**: D/I 선택은 '요청됨'까지만 기록한다. 실제 Main 모델 턴의 완료·중단·반영 여부를 영수증으로 추적하려면 별도 상태 전이 설계가 필요
4. **컨텍스트 최신성**: Main 비교는 그 순간의 Pi 활성 projection과 유한 근거 구간을 사용한다. 검색 결과의 `new`는 '전체 기록에 절대 존재하지 않음'을 뜻하지 않는다. 중요 결정은 원문 재조회 가능해야 함
5. **실사용 UX**: Pi Extension Channel 등록 순서, Ghostty의 긴 본문·키 조작, Main 오프라인 재개, Work 저장 직후 프로세스 강제 종료 등은 Linux 단위 테스트로 대체 불가


## 품질 검토 기록(추가)

후보 선택의 원문·검증 상태뿐 아니라, **어떤 최종 본문을 의미 검사했는지** 감사할 수 있어야 한다. 승인된 보관본에는 `qualityReview`(검사 모델 ID, 시각, 방식, `checkedBodyHash`)를 저장한다. 해시가 실제 `finalMessageHash`와 일치하지 않으면 거부한다. 같은 패키지를 충돌 복구할 때도 수신 기록의 검토 메타데이터를 보존한다. 이것은 모델 검토 이력이며 정확성/독립 검증을 보장하는 증명이 아니다. 결함 보완 후 테스트 추가.



## Context Review 새 경로 (PR #25 Draft · 통합 검증 전)

- `extensions/context-review.ts`: Work `<`에서 현재 활성 분기 보고를 기반으로 후보를 구성하고, 선택 이전에 필수 조건·WHY·원문을 연결합니다. 선택·미리보기·전송을 일시적인 Pi TUI에서 처리합니다.
- `src/handoff/context-review.ts`: 선택된 정보와 그 필수 맥락·원문만 포함하고, 선택하지 않은 독립 후보를 제외한 전송문을 결정적으로 만듭니다. 전송문 해시·출처 검증을 재사용합니다.
- `extensions/handoff-candidates.ts`: 명시적 `<` 요청 시 후보를 생성하며 Work 미완료·차단 상태도 처리합니다. 모델 출력이 잘못되면 원문 인용 기반 검토로 대체합니다.
- `extensions/context-receive.ts`: Main `<`에서 현재 분기에 근거한 비교·명시적 반영을 수행합니다. `triggerTurn:false`로 모델을 자동 실행하지 않고 기록 이벤트로 반영 상태를 확인합니다.
- `extensions/compose.ts`: 자동 `ask_user` 완료 질문과 `/compose inbox`를 기본 경로에서 제거했습니다.
- `test/context-review.test.ts`: 선택 범위·공유된 WHY·원문·미검증 보고 및 모델 실패 대체 동작에 대한 단위 테스트를 추가했습니다.

**남은 검증:** 전체 원본 실험의 의미 품질, 현재 Main 분기 충돌, CLI/Extension 로딩, 좁은 Ghostty Split 키 입력·한국어 IME, 재시작·중복·오프라인 수신, GitHub Actions 최신 `npm run check` 결과는 아직 실사용 검증으로 확정하지 않았습니다. 모델이 WHY를 찾지 못한 경우 제한 보고로 사용자에게 명확히 알리고 확인을 받지만, 그 정책의 안전성은 추가 평가가 필요합니다.


## 2026-11-10 Ghostty 실사용 영상의 두 가지 실패 및 수정 (Draft)

1. **`<` 이후 정지처럼 보임:** 수신 Main 검색 → 후보 모델 생성 → Fork WHY·원문 검증 동안 마지막 단계에만 일시적 알림이 있었습니다. `extensions/context-review.ts`에서 비컨텍스트 상태 위젯으로 1/3~3/3 진행 상황을 *첫 비동기 작업 전에* 표시하고 진입/취소/실패 때 항상 정리하도록 했습니다.
2. **검토 화면의 키 조작 무반응:** 기존에는 목록/상세를 `Tab`으로 전환하지만 활성 영역을 표시하지 않았고, 상세 모드의 `Space`는 무시되며 선택 0건의 `Enter`도 조용히 무시됐습니다. 방향키는 항상 후보 이동, Space는 항상 선택, PageUp/Down은 상세 스크롤, Tab/E는 근거 화면, 0건 Enter에는 명시 안내로 변경했습니다.
3. **완전한 무반응의 가능 원인 별도 대응:** Pi 1.4.0의 `ctx.ui.custom`은 원래 포커스를 할당하므로 영상만으로 Ghostty나 특정 Extension의 포커스 탈취를 증명하지는 못합니다. 공개 `TUI` 인터페이스에는 포커스 조회 API가 없어, 검토 다이얼로그가 열린 동안만 등록·해제되는 `onTerminalInput`에서 **알려진 검토 단축키를 먼저 정확히 한 번 처리하고 소비**합니다. 다른 입력은 통과시키며 UI 하단에는 `키보드 입력 연결됨`을 표시합니다. 임의 텍스트/비밀/원문은 수집하지 않습니다.
4. **회귀 테스트 코드:** `test/context-review-ui.test.ts`에서 원시 방향키·Space·Enter·Esc, 선택 0건 피드백, 포커스 누락 복구, 네이티브 입력의 중복 처리 방지, 입력 리스너 정리 및 진행 위젯 상태 변화를 검사합니다.

**검증 경계:** 소스 및 단위 테스트 코드를 추가했지만 최신 GitHub Actions 검사와 macOS/Ghostty 실사용 검증은 별개입니다. 특히 다른 Extension의 터미널 입력 리스너가 키를 먼저 소비하는 경우에는 실제 환경 재현과 등록 순서 조사가 필요합니다. 자동 전송이나 Main 컨텍스트 자동 승격은 도입하지 않았습니다.


## Handoff Brief · 2026-11-11 요구사항 변경 및 Draft 구현

**실사용 문제:** 기존 Context Review는 2열에 후보·원문·WHY를 길게 나열해 실제 전달 맥락을 이해하기 어려웠습니다. Work에서 승인한 `finalMessage`와 Main의 `renderMainImport()`는 같은 내용이 아닙니다. Main에서는 다시 검토·선택·수락해야 했고, Work가 작성한 `reviewerNote`가 새 Main 본문에서 빠질 수 있었습니다.

**사용자가 선택한 방향:** Work `<`에서 컨텍스트를 의미 단위로 이해한 뒤 **한 번 승인**합니다. 같은 Main 활성 Fork 분기의 최신 결정과 출처가 충돌하지 않는다면, Main에 **같은 승인 본문 그대로** 참고 보고로 추가합니다. Work 보고·제안은 사용자 정책 자동 승인과 구분합니다. 불확실·충돌·세션 계보 불일치·비교 실패에는 Main `<` 예외 검토만 요구합니다.

- `src/handoff/brief.ts`: HandoffPackage에서 동일한 승인 Brief를 결정적으로 구성하며 핵심 주장, 원문 발췌, 필수 WHY, 검증 상태, 사용자 메모를 보존합니다.
- `src/handoff/package.ts`: 이전 패키지와 호환되는 선택적 `approvedMainBrief`·해시 필드를 추가하고 승인 본문의 재계산 일치를 검증합니다.
- `src/handoff/context-review.ts`: 사용자가 선택한 주장·필수 연결 맥락만 Brief로 구성합니다.
- `extensions/context-review.ts`: 근거 우선 2열 Context Review를 단일 흐름 Handoff Brief로 변경하고, 정확한 Main 추가 본문과 감사 원문을 분리해 확인하도록 했습니다.
- `src/handoff/automatic-adoption.ts`: Main 세션·활성 Fork 계보·불완전 WHY·비교 상태·승인 Brief의 안전 조건을 결정적으로 검사합니다.
- `extensions/context-receive.ts`: Main 도착/재개/작업 종료 후 사용자 승인 Brief의 자동 참고 보고를 시도합니다. 현재 Main과 비교 모델 호출은 하되 Main 에이전트 턴을 시작하지 않습니다. 실제 Pi 기록 receipt 이후에만 반영 완료를 인정합니다. 예외는 Main 외부에 보관합니다.
- `extensions/handoff-inbox.ts`, `extensions/compose.ts`: 수신 이벤트에서 안전 검사를 호출하고, 보류 건만 안내하는 기본 경로로 연결합니다.
- `test/handoff-automatic-adoption.test.ts`, `test/context-review.test.ts`: 충돌·불확실·다른 활성 분기·중복·Brief 해시/동일성의 회귀 테스트 코드를 추가했습니다.

**안전 검증 필요:** 새로운 모델 비교가 최신 Main의 금지 조건을 빠짐없이 찾아낸다는 보장은 없습니다. 오래된 Fork WHY, Compaction/ContextEdit, 오프라인 수신, 별도 Branch 재진입, 인터컴 중복 알림 및 강제 종료 이후 receipt 복구는 실제 Pi/ Ghostty 통합과 원본 실험으로 검증해야 합니다. `npm run check`와 실제 macOS E2E를 이번 코드의 통과로 기재하지 않습니다.

**현재 한계:** 공유 후보·근거 수와 보관용 `finalMessage`의 상한은 여전히 v1 데이터 계약을 따릅니다. 단일 Brief 화면으로 가독성을 개선했으나 **대규모 작업의 중요한 정보가 추출 단계에서 누락되지 않음을 입증한 것은 아닙니다**. 추출 범위와 상위 주제 묶음/드릴다운을 별도 품질 실험으로 검증한 뒤 데이터 계층을 확장해야 합니다.

## Reference-first Handoff UI 적용 (2026-11-11, Draft)

**UI 조사 선행 근거 (정확한 버전·코드)**
- [pi-ask-user v0.17.2](https://github.com/edlsh/pi-ask-user/tree/v0.17.2):
  - `index.ts`의 `AskComponent`, `MultiSelectList`, `WrappedSingleSelectList`, `buildCustomUIOptions`: 선택, 검색, 접힌 컨텍스트, 높이 제한, 중앙 오버레이(92%, minWidth 40, maxHeight 85%, margin 1), Alt+O 숨김/복귀
  - 해당 컴포넌트는 `ask_user`의 내부 구현이며 다른 확장을 위한 공개 UI 호출 API가 아닙니다. 모델에게 `ask_user`를 호출시키면 불필요한 추가 모델 턴이 생깁니다
- [pi-intercom v0.18.1](https://github.com/nicobailon/pi-intercom/tree/v0.18.1):
  - `ui/inline-message.ts`: 발신자 표시, 접힌 미리보기와 Ctrl+O 확장; 화면의 본문이 실제 전달문과 같아야 함
  - `ui/session-list.ts`, `ui/handover-picker.ts`, `index.ts`: 간결한 항목 목록, 88열 오버레이, 발신 전 검토
- [Pi v1.4.0 Extension UI API](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/extensions/types.ts): `ctx.ui.custom`의 `overlay`, `overlayOptions`, `onHandle`, `onTerminalInput` 공개 API 확인. 공개 TUI 포커스 조회 함수는 없음

**코드 반영 (UI 범위만)**
- `extensions/handoff-review-ui.ts`: ask-user의 상호작용 관례 사용. 제한 높이 목록, 방향키·Space, 선택 항목 검색, Ctrl+E 근거 접기/펼치기, E 원문, N 의견, Enter 정확한 Main 본문 확인, Alt+O 오버레이 숨김·복귀, Esc 복귀·취소
- `extensions/handoff-received-ui.ts`: intercom 수신 메시지 관례. 발신자·간결한 요약, Ctrl+O 본문 펼치기, Tab 근거·실제 반영문, 88열 오버레이. 정상 전송 시 Main 두 번째 승인 없음
- `extensions/context-review.ts`, `extensions/context-receive.ts`: 기존에 확정된 데이터 계약 및 실제 발신·수신 처리와 새 화면 연결
- `test/context-review-ui.test.ts`, `test/handoff-received-ui.test.ts`: 키 입력, 검색, 접기·펼치기, 원문, 취소, 리스너 정리, 오버레이 숨김·복귀 회귀 테스트 코드

**그대로 사용한 것과 차이가 있는 부분**
- ask-user가 단독으로 제공하는 검색 가능 단일 선택 및 다중 선택 상호작용을 결합했습니다. 해당 조합은 외부에서 호출 가능한 공개 ask-user 컴포넌트가 아닙니다
- Main의 예외 상세는 Pi 커스텀 오버레이로 열며, intercom의 대화 내 인라인 메시지 표시를 그대로 끼워 넣는 것은 아닙니다. 내용은 보류 상태에서 Main 모델 컨텍스트 외부에 유지됩니다
- 후보 추출, 출처·WHY, 해시, 중복·충돌 비교, Main 자동 참고 보고/정책 비승인 계약은 이번 UI 변경 범위에 포함하지 않았습니다

**검증 경계**
- 최신 `npm run check`, macOS/Ghostty의 IME·화면 크기 변경·단축키 충돌·오버레이 표시 검증은 미확인
- pi-ask-user 문서에는 터미널 인라인 이미지 위에 오버레이를 제대로 합성하지 못하는 Pi-TUI 한계가 있습니다. 이미지가 겹치는 상황에서는 인라인 폴백 검토 필요
- 이전 작업 파일이 잘못 섞여 나오는 정보 품질 문제는 별도로 추적할 기존 이슈이며 UI 레퍼런스 적용만으로 해결된 것은 아닙니다


## 2026-11-11 Focused Handoff Review — Ghostty, Work 및 Main UI 구현

**실사용 판단:** Work에서 `<`를 누르면 채팅을 지속하는 상태가 아니라 Main 전달할 맥락을 평가하는 검토 작업입니다. 대화창을 함께 보여주기 위한 하단 패널을 기본으로 채택하지 않습니다. 기존 대화는 원문 출처에서만 필요에 따라 열어 봅니다.

**외부 검증된 기능:** [Ghostty 공식 split zoom 액션](https://ghostty.org/docs/config/keybind/reference) `toggle_split_zoom`은 해당 Split을 현재 탭 전체로 확대/축소합니다. [AppleScript 공식 문서](https://ghostty.org/docs/features/applescript)의 `perform action`은 정확한 Terminal에 명령을 전달할 수 있습니다. 그러나 AppleScript 터미널 모델에 확대 상태를 읽는 속성은 공개돼 있지 않아 **아무 확인 없이 자동 토글하지 않습니다**.

**UI/코드 변경:**
- `src/ghostty-native.ts`: 정확한 UUID로 바인딩된 현재 포커스 Terminal만 확인하고 `perform action "toggle_split_zoom"` 실행. Ghostty가 활성 상태가 아니거나 다른 Terminal에 포커스가 있으면 다른 화면은 변경하지 않음
- `extensions/handoff-zoom.ts`: 사용자 `Alt+Z` 입력으로만 토글하며, Compose가 직접 성공시킨 토글을 검토 종료 시 원위치로 복구하려고 시도. 도중 포커스가 달라지면 다른 Split을 제어하지 않고 사용자에게 수동 복원을 안내. 확대 실패 시 기존 UI 계속 사용
- `extensions/context-review.ts` 및 `extensions/context-receive.ts`: Work `<`의 전체 검토 흐름, Main `<`의 예외 검토 흐름에 각각 상태 수명을 연결. 저장·전송·취소·오류에도 finally에서 복원
- `extensions/handoff-review-ui.ts`: [pi-ask-user](https://github.com/edlsh/pi-ask-user/tree/v0.17.2)의 가용 너비에 따른 목록/상세 화면 전환 패턴 사용. 너비 108 이상에서는 왼쪽은 맥락 선택, 오른쪽은 현재 항목의 의미·검증 상태·연결 WHY를 **간결히** 표시. `E`에서 관련 정확한 인용/Entry ID를 열고, `PgUp/PgDn`은 상세 스크롤. 작은 화면에서는 기존 단일 열. 오버레이 내부 높이 상한을 25줄에서 사용 가능한 터미널 크기에 맞도록 조정
- `extensions/handoff-received-ui.ts`: Main의 보류·충돌 항목은 Work 제목 목록보다 **비교 실패/충돌 사유, Work 주장, 현재 Main의 인용 기록, 미해결 질문**을 먼저 보여줌. Main 대화 출처를 정책 승인이라고 추론하지 않음
- `extensions/context-receive.ts`: `buildSessionProjection()`에서 비교가 인용한 정확한 Main Entry만 표시하고 읽기 전용 비교 중 상태 위젯을 표시. Pi 모델 컨텍스트에 자동 삽입하지 않음
- 회귀 테스트: `test/handoff-zoom.test.ts`, `test/context-review-ui.test.ts`, `test/handoff-received-ui.test.ts`의 수명·선택·확대·Main 충돌 표시 사례

**결정 및 한계:** 새 UX는 대화 창을 계속 노출하지 않으며 전체 Tab 공간 확보는 명시적 `Alt+Z`로 시도합니다. **Ghostty의 현재 확대 여부를 공개 API로 확인할 수 없어 진입 즉시 자동 토글은 안전하지 않습니다.** 이미 Split이 확대된 상태라면 Alt+Z를 누르지 않아야 합니다. 사용자가 검토 중 Ghostty에서 수동으로 확대 상태를 바꾸면 자동 복원이 정확하다고 보장할 수 없습니다. AppleScript가 사용할 수 없는 Linux/권한 제한 환경에서 Pi의 검토 자체는 계속 동작합니다.

**완료 여부:** Draft 코드 및 단위 테스트 코드 추가. 최신 `npm run check` 실행·Ghostty 1.3.1/macOS Split zoom·장문 화면/IME/키 바인딩 검증은 미확인. 기존 후보 추출 정확도와 오래된 작업 인용 문제는 이번 UI 개선의 범위를 벗어납니다.

## 2026-11-11 사용자 보고 3가지 Handoff 문제 직접 수정 (Draft)

문제 1 — 첫 Work `<`에 WHY가 누락되고 재시도하면 나타남:
- `extensions/handoff-candidates.ts`: 최신 Work 보고에서 후보와 역사적 WHY·제약을 같은 결과로 준비하고 검증된 결과만 동일 활성 leaf에 캐시. 연결 인용이 유효하지 않거나 모델이 실패하면 구형 WHY 검색으로 자동 복구
- `src/handoff/package.ts`: 기존 구형 WHY 검색은 결과·JSON·출처 검증 실패 시 같은 첫 `<` 안에서 최대 한 번 다시 호출. 부분적으로 채택한 컨텍스트는 실패 시 전부 제거. 마지막에도 실패하면 `unavailable`을 유지하므로 정확성을 가장하지 않음

문제 2 — 사용자가 Work에서 무엇이 전송되는지 볼 수 없음:
- `extensions/context-review.ts`: 처음부터 Work 후보를 선택된 상태로 표시하되 사용자가 항목을 제외하고 한 번 명시 승인해야 전송
- `extensions/handoff-review-ui.ts`: 좁은 화면에서 실제 승인 Brief의 일부를 첫 화면에서 보여주고, 넓은 화면에서 전체 승인 Brief를 선택에 따라 실시간 갱신. 정확한 본문은 `selectContextPackage()` 단일 생성기로 제공하며 `Enter`로 전체를 확인. 별도의 추정/재작성 미리보기 없음

문제 3 — Main에서 두 번째 `<` 수신 필요:
- `src/handoff/store.ts`: 안전한 Main의 영속 보관함에 새 패키지가 생성되면 `fs.watch`로 즉시 감지. Optional intercom이 연결되지 않아도 보관함을 새로 읽고 활성 Main 기준 비교 실행
- `extensions/context-receive.ts`: Main 시작/분기 전환에 맞춰 감시를 생성·해제하고, 신규 보관함 변경으로 자동 처리. 일시적 모델 비교 오류는 `requires-review`로 승격해 Main `<`를 강요하지 않고 원본을 보존한 채 한 번 자동 재시도
- `extensions/handoff-inbox.ts`: 단순 `pending`은 자동 검사 중임을 표시하고, `<` 안내는 진짜 예외 `requires-review`일 때만 제공
- 여전히 충돌·WHY 원문 검증 불가·다른 Fork 분기라면 Main 모델 컨텍스트에 자동 반영하지 않음. 자동 수신은 신규 정책 승인이 아님

범위에서 제외: 사용자가 요청하지 않은 `src/handoff/metrics.ts`와 영구 비용 로그·관련 연결·테스트 제거. Work 후보·WHY 통합, 캐시는 Handoff의 지연·재시도 문제에 직접 필요해 유지.

검증 상태: 코드를 PR Draft 브랜치에 반영했지만 최신 `npm run check`, 실제 Ghostty/Pi 1.4.0 E2E, intercom 비연결 오프라인/재시작 테스트는 아직 통과가 확인되지 않았음.
