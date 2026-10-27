import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHubRows } from '../extensions/task-hub.ts';
import type { TaskRecord, TmuxLocation } from '../src/task-index.ts';
import type { OpenWorktree } from '../extensions/work-return.ts';

const main: TmuxLocation = { session: 'pic-project', windowId: '@1', windowName: 'Main' };
const agent: TmuxLocation = { session: 'pic-project', windowId: '@2', windowName: 'wm-agent-unique' };
const record: TaskRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '프로필 표시명 추가',
  projectRoot: '/tmp/project',
  context: 'fork',
  workspace: 'worktree',
  branch: 'feat/profile-displayname',
  worktreePath: '/tmp/worktrees/profile',
  workmuxHandle: 'profile',
  workmuxTargetName: 'agent-unique',
  mainLocation: main,
  targetLocation: agent,
  createdAt: '2026-10-26T07:00:00.000Z',
};
const worktree: OpenWorktree = {
  branch: 'feat/profile-displayname', handle: 'profile',
  path: '/tmp/worktrees/profile', project_path: '/tmp/project', is_open: true,
};

test('one approved task appears once even when Pi, tmux and Worktree each have entries', () => {
  const rows = taskHubRows([record], [worktree], [main, agent], main);
  assert.equal(rows.filter(r => r.kind === 'task').length, 1);
  assert.equal(rows.filter(r => r.kind === 'main').length, 0);
  assert.match(rows.find(r => r.kind === 'task')!.label, /프로필 표시명 추가/);
  assert.doesNotMatch(rows.find(r => r.kind === 'task')!.label, /feat\/profile-displayname/);
});

test('Agent window in same tmux session offers exactly the originating Main window', () => {
  const rows = taskHubRows([record], [worktree], [main, agent], agent);
  assert.equal(rows[0]!.kind, 'main');
  assert.deepEqual(rows[0]!.target, main);
  assert.match(rows.find(r => r.kind === 'task')!.label, /현재 작업/);
});

test('an unrelated window does not guess which Main to return to', () => {
  const rows = taskHubRows([record], [worktree], [main, agent],
    { session: 'pic-project', windowId: '@99', windowName: 'unknown' });
  assert.ok(!rows.some(r => r.kind === 'main'));
});

test('two tasks with identical display names retain independent exact target IDs', () => {
  const other = { ...record, id: '00000000-0000-4000-8000-000000000002',
    worktreePath: '/tmp/worktrees/other', workmuxHandle: 'other', branch: 'feat/other',
    targetLocation: { session: 'pic-project', windowId: '@3', windowName: 'wm-other' } };
  const rows = taskHubRows([record, other], [worktree, {
    ...worktree, path: '/tmp/worktrees/other', handle: 'other', branch: 'feat/other',
  }], [main, agent, other.targetLocation], main);
  assert.equal(rows.filter(r => r.kind === 'task').length, 2);
  const targets = rows.filter(r => r.kind === 'task').map(r => r.record!.targetLocation!.windowId);
  assert.deepEqual(new Set(targets).size, 2);
});

test('matching branch from a different project is not a trusted link', () => {
  const rows = taskHubRows([record], [{ ...worktree, project_path: '/tmp/other' }],
    [main, agent], main);
  assert.match(rows.find(r => r.kind === 'task')!.label, /대상 종료 또는 확인 불가/);
});

test('legacy record without exact launch identity is never treated as live', () => {
  const legacy: TaskRecord = { ...record, targetLocation: undefined, workmuxHandle: undefined,
    worktreePath: undefined, mainTmux: 'pic-project' };
  const rows = taskHubRows([legacy], [worktree], [main, agent], agent);
  assert.ok(!rows.some(r => r.kind === 'main'));
  assert.match(rows.find(r => r.kind === 'task')!.label, /연결 정보 없음/);
});

test('shared task uses exact tmux window rather than mere session existence', () => {
  const shared: TaskRecord = { ...record, workspace: 'shared', branch: undefined };
  assert.match(taskHubRows([shared], [], [main, agent], main).find(r => r.kind === 'task')!.label, /실행 창만 확인됨/);
  assert.match(taskHubRows([shared], [], [main], main).find(r => r.kind === 'task')!.label, /대상 종료/);
});


test('task ordering remains stable as worktree activity changes', () => {
  const older: TaskRecord = { ...record, id: '00000000-0000-4000-8000-000000000005',
    title: '기능 A', branch: 'feat/older', worktreePath: '/tmp/w-old', workmuxHandle: 'old',
    targetLocation: {session:'pic-project',windowId:'@3',windowName:'old'} };
  const newer: TaskRecord = { ...record, id: '00000000-0000-4000-8000-000000000006',
    title: '기능 B', branch: 'feat/newer', worktreePath: '/tmp/w-new', workmuxHandle: 'new',
    targetLocation: {session:'pic-project',windowId:'@4',windowName:'new'} };
  const rows1 = taskHubRows([newer, older], [], [main], main)
    .filter(row => row.kind === 'task').map(row => row.record?.id);
  const rows2 = taskHubRows([newer, older], [], [main, newer.targetLocation!, older.targetLocation!], main)
    .filter(row => row.kind === 'task').map(row => row.record?.id);
  assert.deepEqual(rows1, [newer.id, older.id]);
  assert.deepEqual(rows2, [newer.id, older.id]);
});

test('native Pi Fork fallback can be found without workmux registry', () => {
  const native: TaskRecord = { ...record, branch:'feat/nested',
    worktreePath:'/tmp/worktrees/nested',workmuxHandle:undefined,workmuxTargetName:undefined,
    tmuxTarget:'pc-nested-id',targetLocation:{session:'pc-nested-id',windowId:'@7',windowName:'pi'} };
  const rows=taskHubRows([native],[],[main,native.targetLocation!],main);
  assert.match(rows.find(r=>r.kind==='task')!.label,/실행 창만 확인됨/);
  const absent=taskHubRows([native],[],[main],main);
  assert.match(absent.find(r=>r.kind==='task')!.label,/대상 종료/);
});

test('task picker shows a confirmed Fork separately from an unconfirmed Pi session', () => {
  const confirmed={...record,agentSessionId:'child-id',forkParentVerified:true};
  const uncertain={...record,agentSessionId:'child-id',forkParentVerified:false};
  const a=taskHubRows([confirmed],[worktree],[main,agent],main).find(x=>x.kind==='task')?.label;
  const b=taskHubRows([uncertain],[worktree],[main,agent],main).find(x=>x.kind==='task')?.label;
  assert.match(a||'',/원본 Main Fork 확인/);
  assert.match(b||'',/원본 Fork 확인 불가/);
});
