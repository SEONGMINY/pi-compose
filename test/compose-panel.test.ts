import test from 'node:test';
import assert from 'node:assert/strict';
import { approveLaunch, taskName } from '../extensions/compose-panel.ts';
import type { LaunchPlan } from '../src/launch.ts';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const plan = {
  task: '프로필 표시명 구현. 이전 name 필드 호환성을 절대 제거하지 마세요.\n기존 클라이언트가 이 필드를 사용합니다.',
  context: 'fork', workspace: 'worktree', branch: 'feat/display-name',
  source: { id: 'source-pi-session', path: '/tmp/session.jsonl' },
  cwd: '/tmp/project', warnings: [],
} as unknown as LaunchPlan;

test('approval uses native Pi confirmation and preserves the exact prohibition and Fork source', async () => {
  let calls = 0, text = '';
  const ctx = { hasUI: true, ui: { confirm: async (_title: string, body: string) => {
    calls++; text = body; return true;
  } } } as unknown as ExtensionContext;
  assert.equal(await approveLaunch(ctx, plan, { current: true }), true);
  assert.equal(calls, 1);
  assert.match(text, /절대 제거하지 마세요/);
  assert.match(text, /source-pi-session/);
  assert.match(text, /Git Worktree/);
});

test('declined launch never returns authorization', async () => {
  const ctx = { hasUI: true, ui: { confirm: async () => false } } as unknown as ExtensionContext;
  assert.equal(await approveLaunch(ctx, plan, {current: true}), false);
});

test('task titles do not replace the actual task payload', () => {
  assert.equal(taskName(plan.task, 'displayName 추가'), 'displayName 추가');
  assert.ok(plan.task.includes('절대 제거하지 마세요'));
});
