import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHubRows } from '../extensions/task-hub.ts';
import type { TaskRecord } from '../src/task-index.ts';
import type { OpenWorktree } from '../extensions/work-return.ts';

const record: TaskRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '프로필 표시명 추가',
  projectRoot: '/tmp/project',
  context: 'fork',
  workspace: 'worktree',
  branch: 'feat/profile-displayname',
  mainTmux: 'pic-aabbccddee11',
  createdAt: '2026-10-26T07:00:00.000Z',
};
const worktree: OpenWorktree = {
  branch: 'feat/profile-displayname', handle: 'profile',
  path: '/tmp/worktrees/profile', project_path: '/tmp/project', is_open: true,
};

test('one approved development task is shown as one work item, rather than session and branch duplicates', () => {
  const rows = taskHubRows([record], [worktree], ['pic-aabbccddee11'], 'pic-aabbccddee11');
  assert.equal(rows.filter(r => r.kind === 'task').length, 1);
  assert.equal(rows.filter(r => r.kind === 'main').length, 0);
  assert.match(rows[0]!.label, /프로필 표시명 추가/);
  assert.match(rows[0]!.label, /연결 대상 열림/);
  assert.doesNotMatch(rows[0]!.label, /feat\/profile-displayname/);
});

test('from a child environment the exact originating Main target is offered first', () => {
  const rows = taskHubRows([record], [worktree], ['pic-aabbccddee11'], 'other-tmux');
  assert.equal(rows[0]!.kind, 'main');
  assert.equal(rows[0]!.target, 'pic-aabbccddee11');
});

test('a matching branch from a different project must not be treated as the approved agent', () => {
  const rows = taskHubRows([record], [{ ...worktree, project_path: '/tmp/other' }], [], 'other-tmux');
  const row = rows.find(r => r.kind === 'task');
  assert.equal(row?.worktree, undefined);
  assert.match(row!.label, /연결 대상 닫힘/);
});

test('shared tasks only show as open when their exact tmux session exists', () => {
  const shared = { ...record, workspace: 'shared' as const, tmuxTarget: 'pc-profile-0123abcd', branch: undefined };
  assert.match(taskHubRows([shared], [], ['pc-profile-0123abcd'])[0]!.label, /연결 대상 열림/);
  assert.match(taskHubRows([shared], [], [])[0]!.label, /연결 대상 닫힘/);
});
