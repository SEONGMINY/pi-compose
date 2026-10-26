# ADR 0009 — 기본 자동 구성과 로컬 UX 진단

- 상태: **채택, PR #3 Draft 구현** (2026-10-26)
- 선행: [ADR 0005](0005-pic-entry-and-pi-settings.md), [ADR 0006](0006-github-installer.md), [ADR 0008](0008-first-run-setup.md)
- 기존 ADR의 결정 이유는 유지하되, 최초 실행의 권장 Package 승인 정책을 본 ADR로 변경한다.

## 결정 1 — Compose 자체 기능은 기본 제공

Navigation·Launch·세션 탐색·결과 인계(Handoff)·독립 Verify는 제품의 핵심 기능이다. Recommended/Minimal/Custom은 더 이상 기본 설치 흐름에 넣지 않는다.

- 공식 main 스크립트와 PR #3 브랜치 설치 모두 동일한 \`pic\` 바이너리를 설치한다. npm \`postinstall\`은 사용하지 않는다(\`--ignore-scripts\` 호환).
- 최초 **대화형 \`pic\`** 실행에서 누락된 Pi Compose Navigation/Optional Package를 Pi CLI의 \`pi install\`로 자동 설치한다. 기존에 설치된 리소스·사용자 Pi 설정의 필터·프로젝트 단위 패키지는 덮어쓰지 않는다.
- 과거 온보딩 응답을 가진 사용자는 명시적 비활성화 선택을 복원하지 않기 위해 자동 재설정을 시도하지 않는다. 필요한 경우 \`pic setup\`으로 명시적 복구한다.
- 신규 사용자에게 외부 workmux Hook은 별도 승인 후 공식 \`workmux setup --hooks\`로 위임한다. 이는 Hooks 외 Skills 설치를 제한하지만 다른 Agent Hook 설치를 제안할 수 있다. Pi 전용 자동 설치 옵션은 확인하지 못했으므로 **다른 에이전트 설정 파일을 직접 조작하지 않는다**.
- Pi 인증·모델 선택은 Pi 자체 기능의 사용자 행동이다.
- 이미 실행 중인 Pi에는 \`/reload\`가 필요할 수 있다. 전역 Package 경로가 기존 Pi 설정을 덮어쓰는 방식이 아니므로 npm 업그레이드 후에도 사용자 선택을 유지한다.

## 결정 2 — 구조화된 로컬 진단 (schemaVersion 1)

\`src/diagnostics.mjs\`에 가벼운 단일 로컬 이벤트 기록 도구를 둔다. 자체 백엔드/분석 서버/원격 전송/상시 스케줄러를 만들지 않는다. 이벤트는 Pi Compose의 사용 흐름에서만 명시적으로 발행한다.

- 허용된 이벤트명과 데이터 키/값만 저장한다. 프롬프트, 모델 메시지, 소스 코드, Git Diff, 전체 경로, 토큰은 수집하지 않는다.
- 프로젝트·작업·세션 관계가 꼭 필요한 경우에 한해 로컬 HMAC 비밀키로 변환한 불투명 키를 사용한다. 원본 Pi Session ID를 로그에 저장하지 않는다.
- 이벤트는 \`schemaVersion\`, \`timestamp\`, \`runId\`, \`flowId\`, \`source\`, \`outcome\`, \`data\` 형태의 JSONL이다.
- 저장소: 현재 Pi agent 디렉터리의 \`compose/diagnostics\` (0700), 기록 파일 0600. 기본 보존 14일, 이벤트 파일당 최대 2MiB 회전. 최초 대화형 실행에서 로컬 수집 사실과 비활성화 방법을 안내한다.
- \`pic diagnostics status|on|off|summary|export|clear --yes\`로 사용자에게 직접 통제권을 준다. \`export\`는 사용자 전용 디렉터리에 구조화된 단일 JSON 보고서를 생성하고 원본 이벤트 순서·집계값·사실/가설·한계를 함께 넣는다.
- 외부로 자동 전송하지 않는다. ChatGPT에게 분석을 맡기려면 **사용자가 JSON 파일을 직접 전달**해야 한다.

## 관찰의 한계

- Compose에 등록되지 않은 Pi 명령/잘못된 이름의 존재는 관측하지 못한다.
- 선택하지 않았다는 기록으로 발견하지 못했다고 단정하지 않는다.
- 보고서 열기와 사용자의 읽기·이해는 다르다.
- tmux 명령 성공과 Child Pi 모델 준비 완료·개발 완료는 다르다. Pi Session 연결은 별도 이벤트로 구분한다.
- workmux Dashboard 내부 탐색, 사용자 터미널 전환, Git 병합 등 외부 행동은 자동 수집하지 않는다.
- 로그만으로 UX 원인을 확정하지 않는다. 실제 화면/실행 증거 및 가능한 반대 설명과 비교한다.

## 검증 범위

합성 이벤트 집계와 이벤트 필드 화이트리스트는 코드 기반 격리 평가를 수행했다. 실제 macOS Pi 및 Ghostty에서의 실행·파일 저장·런타임 Extension 동작, TypeScript 전체 컴파일, 설치 재시도와 기존 설정의 보존은 사용자 환경 수동 검증이 필요하다. 요청에 따라 GitHub Actions/E2E는 실행하지 않았다.

[UX 진단 및 지표](../UX_DIAGNOSTICS.md) · [설치](../SETUP.md) · [진단 검증표](../validation/diagnostics.md)
