# Handoff P1–P5 — 2026-11-10 구현 감사 기록

> **과거 구현 감사 (정적 기록):** 미병합 [PR #25](https://github.com/SEONGMINY/pi-compose/pull/25)의 초기 자동 후보·`ask_user`·`/compose inbox` 경로에서 발견한 사실과 미검증 위험을 보존합니다. 이 경로는 현재 [PRD](PRD.md)의 목표 UX나 `main`의 기능 명세가 아닙니다. PR #25의 이후 Context Review·Main `<` 등 새 코드는 이 감사 범위 밖이며, 최신 구현 상태는 PR의 실제 Diff를 확인해야 합니다.

**검증 기준점:** [GitHub Actions 성공 기록](https://github.com/SEONGMINY/pi-compose/actions/runs/42771786319)은 커밋 [`00715c6`](https://github.com/SEONGMINY/pi-compose/commit/00715c6020e97fd9d2c6f59c49a619325f2b0a34)의 Node 22/Ubuntu `npm run check` 실행 결과입니다. 아래의 누적 코드 감사와 검증 기록 전체가 단일 커밋에서 수행됐다는 의미는 아닙니다. 특히 이후 PR #25 Head의 검사 완료나 macOS Ghostty/Pi E2E 성공은 증명하지 않습니다.

## 당시 구현이 따랐던 계약 (현행 정책 아님)

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

## 당시 남아 있던 검증 위험과 기능 경계

1. **macOS 실사용 미검증**: GitHub Actions Node 22/Ubuntu에서 `npm run check`가 성공했다. 그러나 Ghostty Native Split, 실제 Pi/ask_user/intercom 확장 조합의 수신·키 입력·재접속은 사용자 Mac에서 아직 실행하지 못했다.
2. **독립 의미 검증의 한계**: 별도 모델 평가도 근거·조건 누락을 놓칠 수 있다. 구조·원문 존재·해시 검사와 결합하되 확정 사실 판정기로 취급하지 않는다.
3. **원본 탐색 범위**: Work에서 제한된 Fork/작업 기록만 선택하므로 극단적으로 긴 Compaction/ContextEdit 사례는 아직 검증되지 않았다.
4. **전송 복구 검증 필요**: 발신 Work가 파일 저장 후 수락 기록을 쓰기 전에 종료되는 상황을 위해 리뷰·수신자·선택·수정 요청 기준의 안정적인 패키지 ID 및 기존 파일 복구 코드를 추가했다. 그러나 실제 프로세스 강제 종료·재개·반복 발송 E2E는 아직 미실행이다.
5. **알림은 확인증이 아님**: Extension Channel 알림 실패가 패키지 본문 유실을 뜻하지 않는다. 수신·모델 처리·정책 승인 상태를 분리해야 한다.
6. **보안 경계**: 로컬 동일 사용자 계정의 접근만 우선 지원한다. 사용자 계정 자체가 탈취된 경우나 악성 확장은 보호 범위 밖이다.
7. **UI 접근성**: 키보드 키 충돌, 화면 높이, 실제 질문/미리보기 자동 포커스, 장문 근거 렌더링 확인 필요.
8. **Main 정책 보호**: 일반 pi-intercom의 외부 수동 메시지는 별도 플러그인의 기능이다. Compose의 보호형 Handoff 경로만 강제하며 pi-intercom 자체를 모든 메시지에서 차단했다고 주장하지 않는다.

## 당시 단계의 완료 판정

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

