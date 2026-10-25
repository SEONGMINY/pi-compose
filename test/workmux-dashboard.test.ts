import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import workmuxDashboardExtension from '../extensions/optional/workmux-dashboard.ts';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

type DashboardCommand = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
type TmuxResult = { code: number; stderr: string };
type TmuxRunner = (bin: string, args: string[]) => Promise<TmuxResult>;

function register(exec: TmuxRunner = async () => ({ code: 0, stderr: '' })) {
  let command: DashboardCommand | undefined;
  const names: string[] = [];
  workmuxDashboardExtension({
    exec,
    registerCommand: (name: string, candidate: DashboardCommand) => {
      names.push(name);
      command = candidate;
    },
  } as unknown as ExtensionAPI);
  if (!command) throw new Error('The optional view did not register its command');
  return { command, names };
}

test('default Pi package loads Launch only, and never loads the workmux View', async () => {
  const manifest: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual((manifest as { pi: { extensions: string[] } }).pi.extensions, ['extensions/compose.ts']);
});

test('workmux View registers its own slash command without registering Launch', () => {
  assert.deepEqual(register().names, ['compose-workmux']);
});

test('optional view validates selected tab before calling tmux', async () => {
  const calls: string[] = [];
  const { command } = register(async (bin) => {
    calls.push(bin);
    return { code: 0, stderr: '' };
  });
  const notices: string[] = [];
  await command.handler('invalid-tab', {
    hasUI: true,
    ui: { notify: (message: string) => notices.push(message) },
  } as unknown as ExtensionCommandContext);
  assert.deepEqual(calls, []);
  assert.match(notices[0] ?? '', /Usage: \/compose-workmux/);
});

test('optional view requires an interactive Pi session inside tmux', async t => {
  const previous = process.env.TMUX;
  delete process.env.TMUX;
  t.after(() => { if (previous === undefined) delete process.env.TMUX; else process.env.TMUX = previous; });
  const calls: string[] = [];
  const { command } = register(async bin => {
    calls.push(bin);
    return { code: 0, stderr: '' };
  });
  const notices: string[] = [];
  await command.handler('', {
    hasUI: true,
    ui: { notify: (message: string) => notices.push(message) },
  } as unknown as ExtensionCommandContext);
  assert.deepEqual(calls, []);
  assert.match(notices[0] ?? '', /requires Pi running in tmux/);
});

test('optional workmux View opens the native dashboard in a tmux popup', async t => {
  const previous = process.env.TMUX;
  process.env.TMUX = '/tmp/mock-tmux-socket';
  t.after(() => { if (previous === undefined) delete process.env.TMUX; else process.env.TMUX = previous; });
  const calls: Array<{ bin: string; args: string[] }> = [];
  const { command } = register(async (bin, args) => {
    calls.push({ bin, args });
    return { code: 0, stderr: '' };
  });
  await command.handler('worktrees', {
    hasUI: true,
    ui: { notify: () => { throw new Error('Unexpected notification'); } },
  } as unknown as ExtensionCommandContext);
  assert.deepEqual(calls, [{
    bin: 'tmux',
    args: ['display-popup', '-E', '-w', '90%', '-h', '90%', "'workmux' 'dashboard' '--tab' 'worktrees'"],
  }]);
});

test('optional View surfaces popup errors but does not stop running sessions', async t => {
  const previous = process.env.TMUX;
  process.env.TMUX = '/tmp/mock-tmux-socket';
  t.after(() => { if (previous === undefined) delete process.env.TMUX; else process.env.TMUX = previous; });
  const { command } = register(async () => ({ code: 1, stderr: 'tmux popup failed' }));
  const notices: string[] = [];
  await command.handler('agents', {
    hasUI: true,
    ui: { notify: (message: string) => notices.push(message) },
  } as unknown as ExtensionCommandContext);
  assert.match(notices[0] ?? '', /Could not open workmux dashboard: tmux popup failed/);
});
