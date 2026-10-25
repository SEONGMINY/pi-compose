import test from 'node:test';
import assert from 'node:assert/strict';
import navigationOnly from '../packages/navigation/extensions/navigator.ts';
import { parseWorkmuxStatus, worktreeStatus } from '../src/agent-status.ts';
import { returnToTmux } from '../extensions/work-return.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

test('child Pi registers a single common work Hub and shortcut without the full compose tools', () => {
  const commands: string[] = [];
  const shortcuts: string[] = [];
  const tools: string[] = [];
  const original = process.env.PIC_COMPOSE_CORE;
  delete process.env.PIC_COMPOSE_CORE;
  try {
    navigationOnly({
      registerCommand: (name: string) => { commands.push(name); },
      registerShortcut: (name: string) => { shortcuts.push(name); },
      registerTool: (entry: {name: string}) => { tools.push(entry.name); },
      on: () => () => {},
    } as unknown as ExtensionAPI);
  } finally {
    if (original === undefined) delete process.env.PIC_COMPOSE_CORE;
    else process.env.PIC_COMPOSE_CORE = original;
  }
  assert.deepEqual(commands, ['compose']);
  assert.deepEqual(shortcuts, ['alt+w']);
  assert.deepEqual(tools, []);
});

test('navigation package does not conflict with the full Compose Extension in pic', () => {
  const original = process.env.PIC_COMPOSE_CORE;
  process.env.PIC_COMPOSE_CORE = '1';
  try {
    let registrations = 0;
    navigationOnly({
      registerCommand: () => { registrations++; },
      registerShortcut: () => { registrations++; },
    } as unknown as ExtensionAPI);
    assert.equal(registrations, 0);
  } finally {
    if (original === undefined) delete process.env.PIC_COMPOSE_CORE;
    else process.env.PIC_COMPOSE_CORE = original;
  }
});

const baseReport = {
  context: { backend: 'tmux', instance: '/tmp/tmux-instance' },
  scope: { repository: '/tmp/project', all: false, targets: [] },
  state_files_invalid_matching_context: 0,
  state_files_invalid_unattributed: 0,
  target_errors: [],
  agents: [{ status: 'working', workdir: '/tmp/worktree', project_path: '/tmp/project', agent_kind: 'pi' }],
};

test('workmux observation shows actual working state but not a fabricated waiting state for Pi', () => {
  const rows = parseWorkmuxStatus(JSON.stringify(baseReport), '/tmp/project');
  assert.equal(worktreeStatus(rows, '/tmp/worktree'), 'working');
  assert.equal(worktreeStatus(rows, '/tmp/other'), undefined);
  const waiting = parseWorkmuxStatus(JSON.stringify({
    ...baseReport, agents: [{ ...baseReport.agents[0], status: 'waiting' }],
  }), '/tmp/project');
  assert.equal(worktreeStatus(waiting, '/tmp/worktree'), undefined);
  const done = parseWorkmuxStatus(JSON.stringify({
    ...baseReport, agents: [{ ...baseReport.agents[0], status: 'done' }],
  }), '/tmp/project');
  assert.equal(worktreeStatus(done, '/tmp/worktree'), 'settled');
});

test('ambiguous agent snapshots and errors must never display a confident state', () => {
  const duplicated = parseWorkmuxStatus(JSON.stringify({
    ...baseReport, agents: [...baseReport.agents, ...baseReport.agents],
  }), '/tmp/project');
  assert.equal(worktreeStatus(duplicated, '/tmp/worktree'), undefined);
  const damaged = parseWorkmuxStatus(JSON.stringify({
    ...baseReport, state_files_invalid_matching_context: 1,
  }), '/tmp/project');
  assert.deepEqual(damaged, []);
  const otherProject = parseWorkmuxStatus(JSON.stringify(baseReport), '/tmp/unrelated');
  assert.deepEqual(otherProject, []);
});

test('return to Main verifies exact window membership and does not spawn Pi', async t => {
  const previous = process.env.TMUX;
  process.env.TMUX = '/tmp/tmux-test';
  t.after(() => { if (previous === undefined) delete process.env.TMUX; else process.env.TMUX = previous; });
  const calls: string[] = [];
  const messages: string[] = [];
  const pi = { exec: async (bin: string, args: string[]) => {
    calls.push(bin + ' ' + args.join(' '));
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-windows') return { code: 0, stdout: 'pic-project\t@1', stderr: '' };
    if (args[0] === 'switch-client' || args[0] === 'select-window') return { code: 0, stdout: '', stderr: '' };
    throw new Error('unexpected command');
  }} as unknown as ExtensionAPI;
  const ctx = { cwd: '/tmp/project', ui: { notify: (s: string) => messages.push(s) } } as unknown as ExtensionContext;
  await returnToTmux(pi, ctx, { name: 'pic-project', cwd: '/tmp/project', windowId: '@1' });
  assert.ok(calls.includes('tmux switch-client -t =pic-project'));
  assert.ok(calls.includes('tmux select-window -t @1'));
  assert.ok(!calls.some(x => x.includes('new-session')));
  calls.length = 0;
  await returnToTmux(pi, ctx, { name: 'pic-project', cwd: '/tmp/project', windowId: '@99' });
  assert.ok(!calls.some(x => x.includes('switch-client')));
  assert.ok(messages.some(x => x.includes('no longer belongs')));
});
