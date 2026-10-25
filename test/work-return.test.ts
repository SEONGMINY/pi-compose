import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { registerWorkReturn, showWorkPicker } from '../extensions/work-return.ts';

function fixture(t: import('node:test').TestContext, open = true) {
  const worktree = mkdtempSync(join(tmpdir(), 'pi-compose-return-'));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const records = [
    { path: '/tmp/member-api.jsonl', id: 'member-api-123456', cwd: '/tmp/project',
      name: 'Member API', firstMessage: 'Implement member endpoint', created: new Date(), modified: new Date(),
      messageCount: 5, allMessagesText: 'Implement member endpoint' },
  ];
  t.mock.method(SessionManager, 'list', async (cwd: string) => cwd === worktree ? [] : records);
  const rows = [{
    project: 'project', project_path: '/tmp/project', handle: 'feature-api',
    branch: 'feat/member-api', path: worktree, is_main: false,
    is_open: open, mode: 'window', has_uncommitted_changes: false, agent_statuses: [], created_at: null,
  }];
  const calls: string[] = [];
  const messages: string[] = [];
  let registered: { execute: (...args: any[]) => Promise<any> } | undefined;
  const pi = {
    registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => {
      assert.equal(tool.name, 'compose_find_work');
      registered = tool;
    },
    exec: async (cmd: string, args: string[]) => {
      calls.push(cmd + ' ' + args.join(' '));
      if (cmd !== 'workmux') throw new Error('unexpected executable');
      if (args.join(' ') === 'list --json') return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
      if (args.join(' ') === 'open feature-api') return { code: 0, stdout: '', stderr: '' };
      throw new Error('unexpected workmux command');
    },
  } as unknown as ExtensionAPI;
  const selections: string[] = [];
  let confirm = false;
  let target: 'saved' | 'workmux' = 'saved';
  let switched: string | undefined;
  const ctx = {
    hasUI: true, cwd: '/tmp/project',
    sessionManager: {
      getSessionDir: () => '/tmp/project-session-dir',
      getSessionFile: () => '/tmp/current.jsonl',
    },
    ui: {
      select: async (_title: string, choices: string[]) => {
        selections.push(...choices);
        return choices.find(choice => target === 'workmux' ? choice.includes('Worktree') : choice.includes('Saved'));
      },
      notify: (message: string) => messages.push(message),
      confirm: async () => confirm,
    },
    switchSession: async (path: string) => { switched = path; return { cancelled: false }; },
  } as unknown as ExtensionCommandContext;
  registerWorkReturn(pi);
  if (!registered) throw new Error('compose_find_work not registered');
  return { pi, ctx, calls, messages, selections, tool: registered,
    setTarget: (v: 'saved' | 'workmux') => { target = v; },
    setApproval: (v: boolean) => { confirm = v; },
    getSwitch: () => switched };
}

test('saved Pi work uses the native session switch and never creates another Pi/tmux process', async t => {
  const fx = fixture(t);
  await showWorkPicker(fx.pi, fx.ctx);
  assert.equal(fx.getSwitch(), '/tmp/member-api.jsonl');
  assert.ok(!fx.calls.some(s => s.includes('open')));
});

test('workmux navigation is denied on cancellation or closed target', async t => {
  const fx = fixture(t);
  fx.setTarget('workmux');
  await showWorkPicker(fx.pi, fx.ctx);
  assert.ok(!fx.calls.some(s => s.startsWith('workmux open')));
  assert.equal(fx.getSwitch(), undefined);
});

test('workmux open requires approval and re-checks that the exact target is still open', async t => {
  const fx = fixture(t);
  fx.setTarget('workmux');
  fx.setApproval(true);
  await showWorkPicker(fx.pi, fx.ctx);
  assert.equal(fx.calls.filter(s => s === 'workmux list --json').length, 2);
  assert.equal(fx.calls.filter(s => s === 'workmux open feature-api').length, 1);
});

test('model discovery is read-only and returns bounded work names, not process-creation results', async t => {
  const fx = fixture(t);
  const result = await fx.tool.execute('find', { query: 'member' }, undefined, undefined,
    fx.ctx as unknown as ExtensionToolContext);
  assert.equal(result.details.status, 'read_only');
  assert.match(result.content[0].text, /Member API/);
  assert.match(result.content[0].text, /feat\/member-api/);
  assert.equal(fx.calls.filter(s => s.startsWith('workmux open')).length, 0);
});

test('closed workmux target is never automatically restarted', async t => {
  const fx = fixture(t, false);
  fx.setTarget('workmux');
  fx.setApproval(true);
  await showWorkPicker(fx.pi, fx.ctx);
  assert.ok(fx.messages.some(m => m.includes('No saved Pi conversation')));
  assert.equal(fx.calls.filter(s => s.startsWith('workmux open')).length, 0);
});
