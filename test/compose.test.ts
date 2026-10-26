import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import composeExtension from '../extensions/compose.ts';
import { delegationPrompt } from '../src/launch.ts';
import { taskName } from '../extensions/compose-panel.ts';
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
      if (candidate.name === 'compose_launch') tool = candidate;
      else assert.ok(['compose_find_work', 'compose_return_work'].includes(candidate.name));
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
  assert.match(shown, /작업: Implement members/);
  assert.match(shown, /맥락: 독립 실행 · Main 대화 미전달/);
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

test('base Pi Compose registers only Launch, never a bundled dashboard', () => {
  const commands: string[] = [];
  const tools: string[] = [];
  composeExtension({
    registerCommand: (name: string) => { commands.push(name); },
    registerTool: (candidate: { name: string }) => { tools.push(candidate.name); },
  } as unknown as ExtensionAPI);
  assert.deepEqual(commands, ['compose']);
  assert.deepEqual(tools, ['compose_find_work', 'compose_return_work', 'compose_launch']);
});

test('resume slash command rejects extra arguments without launching anything', async () => {
  const { command } = register();
  const messages: string[] = [];
  await command.handler('resume arbitrary', {
    hasUI: true,
    ui: { notify: (message: string) => { messages.push(message); } },
  } as unknown as ExtensionContext);
  assert.match(messages[0] ?? '', /Usage: \/compose resume/);
});

test('resume slash command will not reopen its currently running Pi session', async t => {
  const { cwd, file } = await fixture(t);
  const { command } = register();
  const choices = ['Shared directory', 'Enter a session file path'];
  const messages: string[] = [];
  await command.handler('resume', {
    cwd, hasUI: true,
    sessionManager: { getSessionFile: () => file },
    ui: {
      select: async () => choices.shift(),
      input: async () => file,
      notify: (message: string) => { messages.push(message); },
    },
  } as unknown as ExtensionContext);
  assert.match(messages[0] ?? '', /already open in this Pi process/);
});

test('fork delegation prompt preserves explicit prohibitions and never claims context was delivered', () => {
  const prompt = delegationPrompt('Add displayName, keep existing name field', 'fork');
  assert.match(prompt, /^Add displayName, keep existing name field/);
  assert.match(prompt, /requirements, decisions, reasons, and explicit constraints/);
  assert.match(prompt, /If the inherited discussion or actionable requirements are not present/);
  assert.doesNotMatch(delegationPrompt('Find code', 'independent'), /inherited discussion/);
  assert.equal(delegationPrompt('Find code', 'independent'), 'Find code');
});

test('Fork confirmation shows which current session and user decisions will be inherited', async t => {
  const { cwd, file } = await fixture(t);
  const { tool } = register();
  let shown = '';
  const result = await tool.execute('fork-preview', {
    task: 'Add displayName, preserve name compatibility', context: 'fork', workspace: 'shared',
    source: { kind: 'current' },
  }, undefined, undefined, {
    cwd, hasUI: true,
    sessionManager: {
      getSessionFile: () => file,
      getBranch: () => [
        { type: 'message', message: { role: 'user', content: 'Please keep the old name field for compatibility.' } },
        { type: 'message', message: { role: 'assistant', content: 'Okay.' } },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Also add displayName.' }] } },
      ],
    },
    ui: { confirm: async (_title: string, text: string) => { shown = text; return false; } },
  } as unknown as ExtensionToolContext);
  assert.deepEqual(result.details, { status: 'cancelled' });
  assert.match(shown, /Add displayName, preserve name compatibility/);
  assert.match(shown, /chosen-main/);
  assert.match(shown, /최근 사용자 발화 \(대화 전체 아님\)/);
  assert.match(shown, /keep the old name field/);
  assert.match(shown, /Also add displayName/);
  assert.match(shown, /대화 전체 아님/);
});

// Lightweight unit-level review assertions; not executed by this change.
test('a short display name never replaces the actionable handoff instruction', () => {
  const name = taskName('Add displayName to the API. Keep existing name consumers compatible.');
  assert.ok(name.startsWith('Add displayName to the API.'));
  assert.ok(name.length <= 64);
  assert.equal(taskName('Long task instruction', 'Profile API compatibility'), 'Profile API compatibility');
});
