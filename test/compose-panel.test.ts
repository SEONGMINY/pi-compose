import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import {
  approveLaunch, pickTask, wrapSegments, launchReviewLines, hubDetailLines, hubListLines,
  type HubPreviewItem,
} from '../extensions/compose-panel.ts';
import type { LaunchPlan } from '../src/launch.ts';
import type { TaskRecord } from '../src/task-index.ts';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const render = (x: ReturnType<typeof launchReviewLines>, width: number) =>
  wrapSegments(x, width, (_name, value) => value);

const plan = {
  task: '프로필 표시명을 구현하고 기존 name 호환성은 절대 제거하지 마세요.\n이유: 기존 클라이언트의 기존 요청을 지원해야 합니다.',
  context: 'fork', workspace: 'worktree', branch: 'feat/프로필-표시명',
  cwd: '/tmp/프로필-프로젝트', warnings: [],
  source: { id: 'main-session', path: '/tmp/main.jsonl' },
} as unknown as LaunchPlan;

const agent: TaskRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '프로필 표시명 추가',
  instruction: plan.task,
  projectRoot: '/tmp/proj',
  context: 'fork', workspace: 'worktree', branch: 'feat/profile',
  sourceSessionId: 'main-session',
  worktreePath: '/tmp/worktree', createdAt: '2026-10-26T10:00:00Z',
};

test('Korean/ANSI-wrapped dialog text never exceeds the supplied terminal columns', () => {
  const lines = render(launchReviewLines(plan, { current: true }, true, 24), 24);
  assert.ok(lines.length > 10);
  assert.ok(lines.every(line => visibleWidth(line) <= 24));
  assert.ok(lines.join('\n').includes('name'));
  assert.ok(lines.join('\n').includes('main-session'));
  assert.ok(lines.join('\n').includes('기존'));
});

test('launch default does not discard multiline strict prohibitions', () => {
  const full = render(launchReviewLines(plan, { current: true }, false, 32), 32).join('\n');
  assert.match(full, /절대/);
  assert.match(full, /기존 클라이언트/);
  assert.match(full, /Git Worktree/);
});

test('the Hub highlights selection separately from the actual current location', () => {
  const rows: HubPreviewItem[] = [
    { kind: 'current', label: '현재 화면 · Main' },
    { kind: 'task', label: agent.title + ' · 실행 대상 열림', record: agent, available: true },
  ];
  const lines = hubListLines(rows, 1, 50);
  assert.ok(lines.some(x => x.text.startsWith('❯ ' + agent.title)));
  assert.ok(lines.some(x => x.text.startsWith('  현재 화면 · Main')));
});

test('Hub detail exposes exact instruction and claims, never fabricated completion', () => {
  const withEvidence: TaskRecord = { ...agent,
    handoff: { kind: 'developer_claim', recordedAt: '2026-10-26T10:00:00Z',
      gitHead: 'a'.repeat(40), summary: '구현 완료라고 보고', why: '호환성 유지',
      checks: '실행 안 함', outstanding: '확인 필요', changedFileCount: 2 },
    review: { kind: 'independent_review_executed', recordedAt: '2026-10-26T10:10:00Z',
      gitHead: 'a'.repeat(40), reportExcerpt: '계약 근거가 부족함', incomplete: true },
  };
  const text = hubDetailLines({kind:'task',label:agent.title,record:withEvidence,available:true},32)
    .map(x=>x.text).join('\n');
  assert.match(text,/기존 name 호환성은 절대 제거/);
  assert.match(text,/독립 검증 전/);
  assert.match(text,/자동 승인 아님/);
  assert.match(text,/일부 확인 불가/);
});

test('custom TUI dialogs are in-flow, not overlays', async () => {
  let options: unknown = 'not-called';
  const ctx = {
    mode: 'tui', ui: {
      custom: async (_factory: unknown, passed?: unknown) => { options = passed; return false; },
    },
  } as unknown as ExtensionContext;
  await approveLaunch(ctx, plan, {current:true});
  assert.equal(options, undefined);
  options = 'not-called';
  await pickTask(ctx, '프로필', [{kind:'current',label:'현재 Main'}]);
  assert.equal(options, undefined);
});
