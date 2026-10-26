# Pi Compose UX Diagnostics — 수집·집계·문제 분석

**목적:** 실제 작업 행동에서 확인되는 사실과 추정 가능한 UX 문제를 구분하기 위한 로컬 진단입니다. 사용자의 화면을 녹화하거나 대화를 저장하는 기능이 아닙니다. **진단 기록만으로 사용자가 무엇을 읽었는지, 원하는 기능을 알고 있었는지, 원하는 결과를 얻었는지 확정할 수 없습니다.**

## 1. 빠른 사용법

\`\`\`bash
pic diagnostics status        # 저장 위치·활성화·보존 기간
pic diagnostics export        # 기본 최근 7일의 분석용 JSON 파일 한 개
pic diagnostics summary       # 집계만 터미널에 JSON 출력
pic diagnostics export --days 14
pic diagnostics export --days 3 --output ~/Desktop/pi-compose-ux.json
pic diagnostics off           # 다음 이벤트부터 기록 중지
pic diagnostics on            # 로컬 기록 다시 활성화
pic diagnostics clear --yes   # 저장된 JSONL 및 기본 export 파일 삭제
\`\`\`

외부 서버/분석 서비스로 보내지 않습니다. 사용자가 **내보낸 JSON 파일을 ChatGPT에 첨부**해야 분석할 수 있습니다. ChatGPT가 사용자의 로컬 디스크를 자동으로 읽거나 백그라운드 수집하지 않습니다.

기본 상태는 **로컬 기록 켜짐**입니다. 기존 Pi Compose 사용자도 첫 대화형 `pic` 실행에서 수집 목적과 비활성화 방법을 한 번 안내받습니다. `pic diagnostics off`를 실행해도 안내 기록은 유지되어 같은 안내를 반복하지 않습니다. 최초 대화형 \`pic\` 실행 시 기록 사실과 비활성화 방법을 안내합니다. \`PIC_DIAGNOSTICS=0 pic\`은 해당 프로세스의 기록만 끕니다.

## 2. 저장과 보안

- 기본 경로: \`\${PI_CODING_AGENT_DIR:-~/.pi/agent}/compose/diagnostics/\`.
- 날짜별 \`events-YYYY-MM-DD.jsonl\`에 JSON Lines 저장. 기본 최대 보존 기간 **14일**, 파일 크기 **2MiB**를 넘으면 추가 파일로 회전. 보존 정리는 새 이벤트를 쓸 때 수행합니다.
- 디렉터리 \`0700\`, 로그 파일 \`0600\`, 내보낸 보고서 \`0600\`.
- 기본 보고서 위치: 위 저장 폴더의 \`exports/pi-compose-ux-<timestamp>.json\`. 코드 저장소에 내보내기 파일이 섞이지 않도록 별도 디렉터리로 분리했습니다.
- 개인정보 위험이 높은 필드는 **이벤트 저장 전에 화이트리스트에서 제외**합니다. 저장하지 않는 값: 프롬프트·대화 본문, 실제 파일 경로, 프로젝트명, 브랜치명, 코드·Git Diff, API 키/환경변수, 모델 응답 텍스트.
- 세션·프로젝트·작업 ID가 필요한 연결에는 개인 로컬 키 \`identity.key\` 기반 HMAC-SHA256의 앞 20글자를 저장합니다. 원본 ID는 기록하지 않습니다. 같은 설치 내 관계 분석은 가능하지만 외부에서 실제 프로젝트 이름으로 복원할 근거는 없습니다.
- 기록 시 허용하는 숫자: \`elapsedMs\`, \`stepCount\`, \`availableTargets\`, \`selectionCount\`, \`choiceCount\`, \`attempt\`; 허용하는 참거짓: \`linked\`, \`hasResult\`, \`configured\`; 허용하는 분류값: \`route\`, \`context\`, \`workspace\`, \`kind\`, \`reason\`, \`component\`, \`screen\`, \`from\`, \`to\`, \`status\`, \`action\`. 자유 텍스트는 저장하지 않습니다.
- \`pic diagnostics clear --yes\`는 기본 수집 로그와 기본 내보내기 결과를 제거합니다. 별도 \`--output\`으로 만든 사용자 지정 경로의 파일은 직접 삭제해야 합니다. 비활성화 설정과 익명화 키는 남으므로, 설정까지 완전히 지우려면 기록 비활성화 후 해당 디렉터리의 파일을 직접 확인해 삭제하세요.

**주의:** 로그는 민감정보를 수집하지 않도록 설계됐지만 내보낸 파일은 사용자가 전송할 수 있습니다. 첨부 전 내용과 저장 위치를 한 번 확인하세요.

## 3. 이벤트 계약 — schemaVersion 1

모든 이벤트는 다음 공통 필드를 가집니다.

| 필드 | 의미 |
| --- | --- |
| \`schemaVersion\` | 변경 시 명시적으로 올리는 구조 버전. 현재 \`1\` |
| \`timestamp\` | UTC ISO 8601 이벤트 발생 시각 |
| \`runId\` | 하나의 Pi Compose 런타임 프로세스에 대해 임의 생성한 UUID |
| \`flowId\` | 위임 또는 탐색 등 한 흐름의 시작·중간·종료를 연결하는 UUID |
| \`event\` | 아래 허용 목록의 이벤트명 |
| \`source\` | \`slash\`, \`natural-language\`, \`menu\`, \`automatic\`, \`cli\`, \`unknown\` |
| \`outcome\` | \`success\`, \`failure\`, \`cancelled\`, \`unavailable\`, \`unknown\` |
| \`data\` | 허용한 수치·불리언·짧은 분류값만 존재 |
| \`taskKey\`, \`sessionKey\`, \`projectKey\` | 필요한 경우에만 기록한 HMAC 불투명 식별자 |

### 이벤트 목록

| 사용자 흐름 | 시작 | 중간 행동 | 종료/관측 |
| --- | --- | --- | --- |
| 첫 실행·설정 | \`setup.started\` | \`setup.component\`, \`setup.hook_prompted\` | \`setup.finished\` |
| 명령 진입 | \`command.entered\` | \`command.invalid\` | \`command.finished\` *(예약 이벤트: 일부 명령은 종료 불가)* |
| 위임 | \`launch.started\` | \`launch.approval\` | \`launch.finished\`, \`launch.agent_linked\` |
| Agent 탐색 | \`navigation.opened\` | \`navigation.selected\`, \`navigation.detail\` | \`navigation.finished\` |
| 실행 대상 전환 | \`switch.started\` | — | \`switch.finished\` |
| 저장 대화 | \`sessions.opened\` | \`switch.started\`, \`switch.finished\` | \`sessions.finished\` |
| 결과 확인 | \`result.opened\` | — | \`result.unavailable\` |
| Handoff | \`handoff.started\` | — | \`handoff.finished\` |
| Verify | \`verify.started\` | 사용자 승인·실제 모델 실행 | \`verify.finished\` |

\`launch.finished=success\`는 **Agent 실행 명령을 전달했다는 관측**입니다. Pi 모델이 실제로 실행됐는지 확인되려면 \`launch.agent_linked\`가 필요합니다. 연결이 되지 않았다는 것만으로 실행 실패라고 단정할 수는 없습니다.

\`result.opened\`는 사용자가 읽기 전용 결과 화면을 **열었다는 사실**이고 내용을 읽거나 이해했다는 증거가 아닙니다.

\`switch.finished=success\`는 tmux/Pi 전환 명령이 성공으로 반환됐다는 뜻입니다. 사용자가 새로운 화면을 실제로 확인했는지까지 알 수 없습니다.

## 4. 집계 지표와 계산 방식

진단 파일의 \`summary.metrics\`에는 관측한 이벤트만 포함합니다. 분모가 0이면 비율은 \`null\`입니다. 개별 요청의 경과시간 분포는 **중앙값(P50) / P90**을 함께 제공합니다.

| 지표 | 계산 및 해석의 한계 |
| --- | --- |
| 위임 명령 실행 성공률 | \`launch.finished success / launch.started\`. 실제 Child Agent 모델 준비 완료율과 다름 |
| Child Pi 연결 횟수 | 실제 Pi Session ID와 창이 일치한 \`launch.agent_linked\` |
| 위임 취소율 | \`launch.finished cancelled / launch.started\`. 의도적인 취소일 수 있음 |
| 위임 시간 | 시작→종료 \`elapsedMs\`. 사용자의 선택·승인 시간이 포함됨 |
| 탐색 선택 없는 종료율 | \`navigation.finished cancelled & reason=no_selection / navigation.opened\`. 화면을 잠깐 확인하고 정상 종료했을 수도 있음 |
| 30초 내 같은 프로젝트 메뉴 재진입 | 동일 `runId`/`projectKey`의 연속 `navigation.opened` 간격이 30초 이하인 횟수. 반복 사용이 정상일 수도 있음 |
| A→B→A 전환 후보 | 60초 내 같은 익명 대상키로 돌아오는 성공 전환 시퀀스 수. 실수의 증거가 아님 |
| 탐색 선택 비중 | \`navigation.selected / navigation.opened\`. 다단계 선택일 수 있으므로 100%를 넘을 수도 있음 |
| tmux 전환 실패율 | \`switch.finished failure / switch.started\`. 타겟 부재(\`unavailable\`)는 따로 확인 |
| 이전 저장 대화 전환 성공률 | \`sessions.finished success / sessions.opened\` |
| 결과 회수 | 성공한 Handoff·Verify와 열어본 보고서 이벤트의 단순 카운트 |
| 초기 설정 문제 | \`setup.finished failure\`, \`setup.component unavailable\` |

\`summary.byEvent\`와 순서가 보존된 \`events\`를 함께 내보냅니다. 원본 이벤트를 통한 탐색 반복/전환 역행 분석은 추후 분석자가 같은 \`runId\`, \`flowId\` 내 순서를 기준으로 계산할 수 있습니다.

## 5. 문제 판단 방법

**확인된 사실**과 **가설**을 혼동하지 마세요.

| 데이터 패턴 | 확정할 수 있는 것 | 가능한 가설 | 다음 확인 |
| --- | --- | --- | --- |
| 여러 번 \`navigation.opened\`, 선택 없이 종료 | 탐색 열고 선택하지 않았음 | 항목의 의미가 불분명했을 수 있음 | 실제 화면·사용 목적 확인 |
| 위임 확인 화면에서 취소 반복 | 승인 단계에서 취소했음 | 경고, 정보량, 원래 의도 미일치 | 어떤 옵션 조합에서 반복되는지 비교 |
| \`switch.finished failure\` 증가 | tmux 명령이 실패했음 | 실행 대상 기록이 낡았을 수 있음 | 실제 실패 메시지와 대상 존재 확인 |
| \`result.unavailable\` 발생 | 보고서 없는 작업에서 보기 시도 | Handoff 발견이 어려웠을 수 있음 | 위임→인계 기록 관계 검증 |
| 대화 검색 후 전환 없음 | 저장 대화를 탐색했지만 이동 안 함 | 목록에서 원하는 대화를 못 찾았을 수 있음 | 검색 결과 유무와 선택 행동 비교 |

하나의 수치만으로 원인을 확정하지 말고 **흐름 단위**로 비교하세요.

## 6. 관측하지 못하는 행동

- Pi Compose에 등록되지 않은 잘못된 슬래시 명령, 사용자가 명령어를 기억했는지 여부.
- 사용자가 화면을 읽었는지, 실제 의도는 무엇이었는지.
- Ghostty에서 수동 탭 전환, 외부 터미널·프로젝트 간 이동, 외부 workmux Dashboard 내부 조작.
- Git 병합·수동 코드 변경·프로젝트 성공 여부.
- 모델이 Fork 맥락을 제대로 이해했는지, Handoff의 진실성, Verify의 실제 정확성.

이 한계가 있으므로 사용자 녹화·사용자 피드백·코드 분석과 진단 이벤트를 **상호 검증**해야 합니다.

## 7. ChatGPT / 코딩 Agent에 분석을 맡기는 방법

1. 평소처럼 Pi Compose를 사용합니다.
2. \`pic diagnostics export --days 7\`을 실행합니다.
3. 출력 경로의 JSON 파일 하나를 이 대화에 첨부합니다.
4. 다음처럼 요청합니다.

> 첨부한 Pi Compose UX 진단 데이터를 분석해 주세요. 전환 실패, 위임 취소, 탐색 반복, 인계 누락이 많은 실제 흐름을 찾아 주세요. **확인된 사실/지표/가설/측정 불가**를 구분하고, 근거가 되는 이벤트 이름과 flowId를 제시한 뒤 UX 개선 우선순위를 추천해 주세요. 데이터를 보지 않고 UI 변경을 추측하지 마세요.

이 방식은 로컬에서 수집·집계하고, **사용자가 명시적으로 내보내 업로드한 경우에만** 분석이 가능하도록 구성했습니다.

[설치](SETUP.md) · [실전 사용 시나리오](SCENARIOS.md) · [검증 매트릭스](validation/diagnostics.md)
