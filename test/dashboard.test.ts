import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardArgs, openDashboard } from '../src/dashboard.ts';

test('default dashboard delegates to the native workmux UI', () => {
  assert.deepEqual(dashboardArgs(), ['dashboard']);
});

test('dashboard supports native session filtering and tab selection', () => {
  assert.deepEqual(
    dashboardArgs({ sessionOnly: true, tab: 'agents' }),
    ['dashboard', '--session', '--tab', 'agents'],
  );
  assert.deepEqual(dashboardArgs({ tab: 'worktrees' }), ['dashboard', '--tab', 'worktrees']);
});

test('dashboard passes the selected view to workmux without invoking a shell', async () => {
  const calls: Array<{ bin: string; args: string[] }> = [];
  await openDashboard(
    { sessionOnly: true, tab: 'worktrees' },
    async (bin, args) => {
      calls.push({ bin, args });
      return 0;
    },
  );
  assert.deepEqual(calls, [{
    bin: 'workmux',
    args: ['dashboard', '--session', '--tab', 'worktrees'],
  }]);
});

test('dashboard propagates nonzero exits instead of claiming success', async () => {
  await assert.rejects(
    () => openDashboard({}, async () => 2),
    /workmux dashboard exited with code 2/,
  );
});

test('dashboard reports a missing workmux executable without installing it', async () => {
  const missing = Object.assign(new Error('spawn workmux ENOENT'), { code: 'ENOENT' });
  await assert.rejects(
    () => openDashboard({}, async () => { throw missing; }),
    /Could not open workmux dashboard.*Install\/configure workmux and tmux first/,
  );
});

test('dashboard only delegates and never attempts cleanup or session termination', async () => {
  const called: string[] = [];
  await openDashboard({}, async (bin, args) => {
    called.push(bin, ...args);
    return 0;
  });
  assert.deepEqual(called, ['workmux', 'dashboard']);
});
