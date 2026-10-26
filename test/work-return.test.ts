import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { registerWorkReturn, showWorkPicker, showSavedSessions } from '../extensions/work-return.ts';

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
  let returnTool: { execute: (...args: any[]) => Promise<any> } | undefined;
  let editor = '';
  const pi = {
    registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => {
      if (tool.name === 'compose_find_work') registered = tool;
      else if (tool.name === 'compose_return_work') returnTool = tool;
      else throw new Error('Unexpected Tool: ' + tool.name);
    },
    exec: async (cmd: string, args: string[]) => {
      calls.push(cmd + ' ' + args.join(' '));
      if (cmd === 'tmux') {
        if (args[0] === 'list-panes') return {
          code: 0,
          stdout: [
            'pc-member-api-0123abcd\t/tmp/project',
            'pic-0123456789ab\t/tmp/project',
            'pc-other-agent-deadbeef\t/tmp/unrelated',
          ].join('\n'),
          stderr: '',
        };
        if (args[0] === 'has-session' || args[0] === 'switch-client') return { code: 0, stdout: '', stderr: '' };
        throw new Error('unexpected tmux command');
      }
      if (cmd !== 'workmux') throw new Error('unexpected executable');
      if (args.join(' ') === 'list --json') return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
      if (args.join(' ') === 'open feature-api') return { code: 0, stdout: '', stderr: '' };
      throw new Error('unexpected workmux command');
    },
  } as unknown as ExtensionAPI;
  const selections: string[] = [];
  let confirm = false;
  let target: 'saved' | 'workmux' | 'tmux' = 'saved';
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
        return choices.find(choice => target === 'workmux' ? choice.includes('Worktree')
          : target === 'tmux' ? choice.includes('Running target') : choice.includes('Saved'));
      },
      notify: (message: string) => messages.push(message),
      confirm: async () => confirm,
      getEditorText: () => editor,
      setEditorText: (next: string) => { editor = next; },
    },
    switchSession: async (path: string) => { switched = path; return { cancelled: false }; },
  } as unknown as ExtensionCommandContext;
  registerWorkReturn(pi);
  if (!registered || !returnTool) throw new Error('Pi work-return tools not registered');
  return { pi, ctx, calls, messages, selections, tool: registered, returnTool,
    getEditor: () => editor, setEditor: (value: string) => { editor = value; },
    setTarget: (v: 'saved' | 'workmux' | 'tmux') => { target = v; },
    setApproval: (v: boolean) => { confirm = v; },
    getSwitch: () => switched };
}


test('saved-session command finds a different conversation and switches using its exact file', async t => {
  const fx=fixture(t);
  const ctx={...fx.ctx,ui:{...fx.ctx.ui,select:async (_title:string, choices:string[])=>choices[0]}};
  await showSavedSessions(ctx as ExtensionCommandContext,'Member API');
  assert.equal(fx.getSwitch(),'/tmp/member-api.jsonl');
  assert.ok(!fx.calls.some(s=>s.includes('new-session')||s.includes('workmux add')));
});

test('saved-session command explains cwd scope instead of silently claiming all sessions are missing', async t => {
  const fx=fixture(t);
  await showSavedSessions(fx.ctx,'unmatched-session-name');
  assert.equal(fx.getSwitch(),undefined);
  assert.ok(fx.messages.some(message=>message.includes('현재 폴더(cwd)')&&message.includes('/resume')));
});

test('saved-session switch failure is reported instead of escaping without feedback', async t => {
  const fx=fixture(t);
  const ctx={...fx.ctx,
    ui:{...fx.ctx.ui,select:async (_title:string, choices:string[])=>choices[0]},
    switchSession:async()=>{throw new Error('simulated switch failure');}};
  await showSavedSessions(ctx as ExtensionCommandContext,'Member');
  assert.ok(fx.messages.some(message=>message.includes('전환 실패')&&message.includes('/resume')));
});

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

test('natural language return prepares an exact Pi command for user submission instead of switching in the model tool', async t => {
  const fx = fixture(t);
  const result = await fx.returnTool.execute('return', { query: 'Member' }, undefined, undefined,
    fx.ctx as unknown as ExtensionToolContext);
  assert.equal(result.details.status, 'exact_command_prepared_not_executed');
  assert.equal(fx.getSwitch(), undefined);
  assert.equal(fx.getEditor(), '/compose back id:member-api-123456');
  assert.ok(!fx.calls.some(command => command.startsWith('workmux open')));
  await showWorkPicker(fx.pi, fx.ctx, 'id:member-api-123456');
  assert.equal(fx.getSwitch(), '/tmp/member-api.jsonl');
});

test('natural language return preserves an unfinished user draft and never switches a session automatically', async t => {
  const fx = fixture(t);
  fx.setEditor('I am drafting requirements');
  const result = await fx.returnTool.execute('return', { query: 'Member' }, undefined, undefined,
    fx.ctx as unknown as ExtensionToolContext);
  assert.equal(result.details.status, 'exact_command_required_draft_preserved');
  assert.equal(fx.getEditor(), 'I am drafting requirements');
  assert.equal(fx.getSwitch(), undefined);
});

test('natural language return cannot change anything without an interactive UI', async t => {
  const fx = fixture(t);
  const result = await fx.returnTool.execute('return', {}, undefined, undefined,
    { ...fx.ctx, hasUI: false } as unknown as ExtensionToolContext);
  assert.equal(result.details.status, 'not_executed_no_ui');
  assert.equal(fx.calls.length, 0);
});

test('workmux return requested through natural language still requires user confirmation', async t => {
  const fx = fixture(t);
  fx.setTarget('workmux');
  const result = await fx.returnTool.execute('return', { query: 'member-api' }, undefined, undefined,
    fx.ctx as unknown as ExtensionToolContext);
  assert.equal(result.details.status, 'workmux_return_attempted_unverified');
  assert.ok(!fx.calls.some(command => command.startsWith('workmux open')));
});


test('work picker shows only same-project Pi Compose tmux targets and labels agent status unknown', async t => {
  const fx = fixture(t);
  await showWorkPicker(fx.pi, fx.ctx);
  assert.ok(fx.selections.some(s => s.includes('Running target') && s.includes('member-api')));
  assert.ok(fx.selections.some(s => s.includes('agent status unknown')));
  assert.ok(!fx.selections.some(s => s.includes('other-agent')));
});

test('selecting a live target switches the tmux client without starting a new agent', async t => {
  const original = process.env.TMUX;
  process.env.TMUX = '/tmp/pi-compose-test-tmux';
  t.after(() => { if (original === undefined) delete process.env.TMUX; else process.env.TMUX = original; });
  const fx = fixture(t);
  fx.setTarget('tmux');
  await showWorkPicker(fx.pi, fx.ctx);
  assert.ok(fx.calls.some(s => s === 'tmux has-session -t =pc-member-api-0123abcd'));
  assert.ok(fx.calls.some(s => s === 'tmux switch-client -t =pc-member-api-0123abcd'));
  assert.ok(!fx.calls.some(s => s.includes('new-session')));
});

test('from outside tmux navigation advises attach without creating a session', async t => {
  const original = process.env.TMUX;
  delete process.env.TMUX;
  t.after(() => { if (original !== undefined) process.env.TMUX = original; });
  const fx = fixture(t);
  fx.setTarget('tmux');
  await showWorkPicker(fx.pi, fx.ctx);
  assert.ok(fx.messages.some(m => m.includes('tmux attach -t')));
  assert.ok(!fx.calls.some(s => s.startsWith('tmux switch-client')));
});
