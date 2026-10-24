import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import composeExtension from '../extensions/compose.ts';
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from '@earendil-works/pi-coding-agent';

type LaunchParams = {
  task: string;
  context: 'fork' | 'independent';
  workspace: 'shared' | 'worktree';
  branch?: string;
  cwd?: string;
  source?: { kind: 'current' } | { kind: 'file'; path: string };
};
type RegisteredTool = {
  name: string;
  execute: (
    callId: string, params: LaunchParams, signal: AbortSignal | undefined,
    onUpdate: undefined, ctx: ExtensionToolContext,
  ) => Promise<{ details: unknown; content: Array<{ type: string; text: string }> }>;
};
type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

function register(exec?: (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>) {
  let command: RegisteredCommand | undefined;
  let tool: RegisteredTool | undefined;
  composeExtension({
    registerCommand: (name: string, candidate: RegisteredCommand) => {
      assert.equal(name, 'compose'); command = candidate;
    },
    registerTool: (candidate: RegisteredTool) => {
      assert.equal(candidate.name, 'compose_launch'); tool = candidate;
    },
    exec,
  } as unknown as ExtensionAPI);
  if (!command || !tool) throw new Error('Expected both Pi entry points');
  return { command, tool };
}

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-compose-extension-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const file = join(root, 'main.jsonl');
  await writeFile(file, JSON.stringify({ type: 'session', id: 'chosen-main', cwd }) + '\n');
  return { cwd, file };
}

test('slash preview uses the exact current Pi session without asking for its JSONL path', async t => {
  const { cwd, file } = await fixture(t);
  const { command } = register();
  const selections = ['Fork existing Pi session', 'Shared directory', 'Current Pi session'];
  const messages: string[] = [];
  await command.handler('preview Member API', {
    cwd, hasUI: true,
    sessionManager: { getSessionFile: () => file },
    ui: {
      select: async () => selections.shift(),
      input: async () => { throw new Error('Did not expect manual source path input'); },
      notify: (message: string) => messages.push(message),
    },
  } as unknown as ExtensionContext);
  assert.ok(messages[0]?.includes('Preview only: tmux'));
  assert.ok(messages[0]?.includes(file));
});

test('slash preview preserves explicit alternate source file selection', async t => {
  const { cwd, file } = await fixture(t);
  const { command } = register();
  const selections = ['Fork existing Pi session', 'Shared directory', 'Enter a session file path'];
  const messages: string[] = [];
  await command.handler('preview Member UI', {
    cwd, hasUI: true,
    sessionManager: { getSessionFile: () => undefined },
    ui: {
      select: async () => selections.shift(),
      input: async () => file,
      notify: (message: string) => messages.push(message),
    },
  } as unknown as ExtensionContext);
  assert.ok(messages[0]?.includes('Preview only: tmux'));
  assert.ok(messages[0]?.includes(file));
});

test('model tool cannot execute a development agent when confirmation UI is unavailable', async t => {
  const { cwd } = await fixture(t);
  const { tool } = register();
  const result = await tool.execute('call1',
    { task: 'Implement API', context: 'independent', workspace: 'shared' },
    undefined, undefined, { cwd, hasUI: false } as ExtensionToolContext);
  assert.deepEqual(result.details, { status: 'not_executed_confirmation_unavailable' });
  assert.match(result.content[0]?.text ?? '', /NOT executed/);
});

test('model tool asks for explicit approval and cancel never launches', async t => {
  const { cwd } = await fixture(t);
  const { tool } = register();
  let confirmations = 0;
  let shown = '';
  const result = await tool.execute('call2',
    { task: 'Implement members', context: 'independent', workspace: 'shared' },
    undefined, undefined, {
      cwd, hasUI: true,
      ui: { confirm: async (_title: string, text: string) => { confirmations++; shown = text; return false; } },
    } as unknown as ExtensionToolContext);
  assert.equal(confirmations, 1);
  assert.match(shown, /Task: Implement members/);
  assert.deepEqual(result.details, { status: 'cancelled' });
});

test('model tool requires an explicitly identified Fork source', async t => {
  const { cwd } = await fixture(t);
  const { tool } = register();
  await assert.rejects(() => tool.execute('call3',
    { task: 'Implement members', context: 'fork', workspace: 'shared' },
    undefined, undefined, { cwd, hasUI: true } as ExtensionToolContext), /explicit source/);
});

test('model tool never interprets a saved Pi session as Main by default', async t => {
  const { cwd } = await fixture(t);
  const { tool } = register();
  await assert.rejects(() => tool.execute('call4',
    { task: 'Implement members', context: 'fork', workspace: 'shared', source: { kind: 'current' } },
    undefined, undefined, {
      cwd, hasUI: true, sessionManager: { getSessionFile: () => undefined },
    } as unknown as ExtensionToolContext), /no saved session file/);
});

test('model tool refuses Fork source for independent mode', async t => {
  const { cwd, file } = await fixture(t);
  const { tool } = register();
  await assert.rejects(() => tool.execute('call5',
    { task: 'Implement members', context: 'independent', workspace: 'shared', source: { kind: 'file', path: file } },
    undefined, undefined, { cwd, hasUI: true } as ExtensionToolContext), /must not specify a Fork source/);
});

test('model tool shows exact source ID in its confirmation', async t => {
  const { cwd, file } = await fixture(t);
  const { tool } = register();
  let shown = '';
  const result = await tool.execute('call6',
    { task: 'Implement members', context: 'fork', workspace: 'shared', source: { kind: 'file', path: file } },
    undefined, undefined, {
      cwd, hasUI: true,
      ui: { confirm: async (_title: string, text: string) => { shown = text; return false; } },
    } as unknown as ExtensionToolContext);
  assert.match(shown, /chosen-main/);
  assert.deepEqual(result.details, { status: 'cancelled' });
});

test('dashboard command validates view before invoking tmux', async () => {
  const calls: Array<{ bin: string; args: string[] }> = [];
  const { command } = register(async (bin, args) => {
    calls.push({ bin, args }); return { code: 0, stderr: '' };
  });
  const messages: string[] = [];
  await command.handler('dashboard invalid-tab', {
    hasUI: true, ui: { notify: (message: string) => messages.push(message) },
  } as unknown as ExtensionContext);
  assert.deepEqual(calls, []);
  assert.match(messages[0] ?? '', /Usage: \/compose dashboard/);
});

test('dashboard command declines to spawn without a tmux terminal', async t => {
  const old = process.env.TMUX;
  delete process.env.TMUX;
  t.after(() => { if (old === undefined) delete process.env.TMUX; else process.env.TMUX = old; });
  const calls: string[] = [];
  const { command } = register(async (bin) => {
    calls.push(bin); return { code: 0, stderr: '' };
  });
  const messages: string[] = [];
  await command.handler('dashboard', {
    hasUI: true, ui: { notify: (message: string) => messages.push(message) },
  } as unknown as ExtensionContext);
  assert.deepEqual(calls, []);
  assert.match(messages[0] ?? '', /tmux terminal/);
});

test('dashboard command opens native workmux UI as a tmux popup', async t => {
  const old = process.env.TMUX;
  process.env.TMUX = '/tmp/tmux-placeholder';
  t.after(() => { if (old === undefined) delete process.env.TMUX; else process.env.TMUX = old; });
  const calls: Array<{ bin: string; args: string[] }> = [];
  const { command } = register(async (bin, args) => {
    calls.push({ bin, args }); return { code: 0, stderr: '' };
  });
  await command.handler('dashboard worktrees', {
    hasUI: true, ui: { notify: () => { throw new Error('Unexpected notification'); } },
  } as unknown as ExtensionContext);
  assert.deepEqual(calls, [{
    bin: 'tmux',
    args: ['display-popup', '-E', '-w', '90%', '-h', '90%', "'workmux' 'dashboard' '--tab' 'worktrees'"],
  }]);
});

test('dashboard command reports workmux/tmux errors without killing Pi sessions', async t => {
  const old = process.env.TMUX;
  process.env.TMUX = '/tmp/tmux-placeholder';
  t.after(() => { if (old === undefined) delete process.env.TMUX; else process.env.TMUX = old; });
  const { command } = register(async () => ({ code: 1, stderr: 'tmux popup failed' }));
  const messages: string[] = [];
  await command.handler('dashboard agents', {
    hasUI: true, ui: { notify: (message: string) => messages.push(message) },
  } as unknown as ExtensionContext);
  assert.match(messages[0] ?? '', /Could not open workmux dashboard: tmux popup failed/);
});
