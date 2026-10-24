import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planLaunch, executeLaunch, quoteShell, validateRequest } from '../src/launch.ts';

async function setup(t: import('node:test').TestContext, { sourceCwd }: { sourceCwd?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-compose-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); await mkdir(cwd);
  const file = join(root, 'main.jsonl');
  await writeFile(file, JSON.stringify({ type: 'session', id: 'main-123', cwd: sourceCwd || cwd }) + '\n');
  return { root, cwd, file };
}

function mockGit({ cwd, dirty = '', existingBranch = false }: { cwd: string; dirty?: string; existingBranch?: boolean }) {
  const calls: Array<{ bin: string; args: string[]; options: { cwd: string } }> = [];
  const run = async (bin: string, args: string[], options: { cwd: string }) => {
    calls.push({ bin, args, options });
    assert.equal(bin, 'git');
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, stdout: cwd, stderr: '' };
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'a'.repeat(40), stderr: '' };
    if (args[0] === 'check-ref-format') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'show-ref') return { code: existingBranch ? 0 : 1, stdout: '', stderr: '' };
    if (args[0] === 'status') return { code: 0, stdout: dirty, stderr: '' };
    throw Error(`Unexpected ${bin} ${args.join(' ')}`);
  };
  return { run, calls };
}

test('rejects incomplete and mismatched options before mutation', () => {
  assert.throws(() => validateRequest({ task: 'x', context: 'fork', workspace: 'shared' }), /source-session-file/);
  assert.throws(() => validateRequest({ task: 'x', context: 'independent', workspace: 'worktree' }), /branch/);
  assert.throws(() => validateRequest({ task: 'x', context: 'independent', workspace: 'shared', branch: 'feat/x' }), /only apply/);
  assert.throws(() => validateRequest({ task: '', context: 'independent', workspace: 'shared' }), /task/);
});

test('shell quoting prevents injected task commands', () => {
  assert.equal(quoteShell("it's; $(touch /tmp/unsafe)"), "'it'\\''s; $(touch /tmp/unsafe)'");
});

test('fork + shared launches Pi via tmux with exact session file', async t => {
  const { cwd, file } = await setup(t);
  const plan = await planLaunch({ task: "Member API; echo 'unsafe'", context: 'fork', workspace: 'shared', cwd, sourceSessionFile: file }, { id: () => 'fixed' });
  assert.equal(plan.program, 'tmux');
  assert.equal(plan.source.id, 'main-123');
  assert.equal(plan.tmuxTarget, 'pc-member-api-echo-unsa-fixed');
  assert.equal(plan.args[0], 'new-session');
  assert.equal(plan.args.at(-1).includes("'--fork'"), true);
  assert.equal(plan.args.at(-1).includes("'Member API; echo '\\''unsafe'\\'''"), true);
});

test('independent + shared does not fork', async t => {
  const { cwd } = await setup(t);
  const plan = await planLaunch({ task: 'Explore tests', context: 'independent', workspace: 'shared', cwd }, { id: () => 'fixed' });
  assert.equal(plan.program, 'tmux');
  assert.ok(!plan.args.at(-1).includes('--fork'));
});

test('fork + worktree maps to workmux with explicit source ID and base commit', async t => {
  const { cwd, file } = await setup(t);
  const { run, calls } = mockGit({ cwd, dirty: ' M README.md' });
  const plan = await planLaunch({ task: 'Implement API', context: 'fork', workspace: 'worktree', cwd, branch: 'feat/api', sourceSessionFile: file }, { run });
  assert.equal(plan.program, 'workmux');
  assert.deepEqual(plan.args, ['add', 'feat/api', '--agent', 'pi', '--base', 'a'.repeat(40), '--fork=main-123', '--prompt', 'Implement API']);
  assert.equal(plan.warnings.length, 1);
  assert.ok(calls.some(c => c.args[0] === 'status'));
});

test('independent + worktree omits fork', async t => {
  const { cwd } = await setup(t);
  const { run } = mockGit({ cwd });
  const plan = await planLaunch({ task: 'Write UI', context: 'independent', workspace: 'worktree', cwd, branch: 'feat/ui' }, { run });
  assert.equal(plan.program, 'workmux');
  assert.ok(!plan.args.some(x => x.startsWith('--fork')));
});

test('fork + worktree refuses a session from another source cwd', async t => {
  const { root, cwd, file } = await setup(t, { sourceCwd: '/unrelated' });
  const { run } = mockGit({ cwd });
  await assert.rejects(() => planLaunch({ task: 'x', context: 'fork', workspace: 'worktree', cwd, sourceSessionFile: file, branch: 'feat/x' }, { run }), /source repository root/);
});

test('existing branch fails before launch', async t => {
  const { cwd } = await setup(t);
  const { run } = mockGit({ cwd, existingBranch: true });
  await assert.rejects(() => planLaunch({ task: 'x', context: 'independent', workspace: 'worktree', cwd, branch: 'feat/x' }, { run }), /already exists/);
});

test('execute returns honest status and never calls a shell', async t => {
  const { cwd } = await setup(t);
  const plan = await planLaunch({ task: 'x', context: 'independent', workspace: 'shared', cwd });
  const received: Array<{ cmd: string; args: string[]; options: { cwd: string } }> = [];
  const result = await executeLaunch(plan, { run: async (cmd, args, options) => { received.push({ cmd, args, options }); return { code: 0, stdout: 'ok', stderr: '' }; } });
  assert.equal(received[0].cmd, 'tmux');
  assert.equal(received[0].options.cwd, cwd);
  assert.equal(result.status, 'launch_command_succeeded_agent_unverified');
  assert.match(result.note, /not been verified/);
});

test('failed launch warns to inspect resources and does not delete anything', async t => {
  const { cwd } = await setup(t);
  const plan = await planLaunch({ task: 'x', context: 'independent', workspace: 'shared', cwd });
  await assert.rejects(() => executeLaunch(plan, { run: async () => ({ code: 1, stdout: '', stderr: 'tmux failed' }) }), /Inspect before retrying/);
});

test('Pi extension registers explicit command and preview does not execute agent', async t => {
  const { cwd } = await setup(t);
  const { default: composeExtension } = await import('../extensions/compose.mjs');
  let command: { handler: (args: string, ctx: import('@earendil-works/pi-coding-agent').ExtensionContext) => Promise<void> };
  composeExtension({ registerCommand: (name: string, options: typeof command) => { assert.equal(name, 'compose'); command = options; } } as unknown as import('@earendil-works/pi-coding-agent').ExtensionAPI);
  const messages: string[] = [];
  const choices = ['Independent new session', 'Shared directory'];
  await command.handler('preview Explore', {
    hasUI: true,
    cwd,
    ui: {
      select: async () => choices.shift(),
      input: async () => { throw Error('Task already provided; should not ask'); },
      notify: (message: string) => messages.push(message),
    },
  } as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext);
  assert.ok(messages[0].startsWith('Preview only: tmux'));
});

test('Zod rejects invalid enum values and whitespace-only task', () => {
  assert.throws(() => validateRequest({ task: 'x', context: 'wrong', workspace: 'shared' }), /fork\|independent/);
  assert.throws(() => validateRequest({ task: 'x', context: 'independent', workspace: 'bad' }), /shared\|worktree/);
  assert.throws(() => validateRequest({ task: '   ', context: 'independent', workspace: 'shared' }), /task/);
  assert.throws(() => validateRequest({ task: 'good\\0bad', context: 'independent', workspace: 'shared' }), /NUL/);
});

test('Zod normalizes task and branch at external-input boundary', () => {
  const parsed = validateRequest({ task: '  Explore  ', context: 'independent', workspace: 'worktree', branch: ' feat/ui ' });
  assert.equal(parsed.task, 'Explore');
  assert.equal(parsed.branch, 'feat/ui');
});

test('Pi session JSONL header must have expected field types', async t => {
  const { cwd, file } = await setup(t);
  await writeFile(file, JSON.stringify({ type: 'session', id: 123, cwd }) + '\\n');
  await assert.rejects(() => planLaunch({ task: 'x', context: 'fork', workspace: 'shared', cwd, sourceSessionFile: file }), /session header requires/);
  await writeFile(file, JSON.stringify({ type: 'session', id: 'main', cwd: 42 }) + '\\n');
  await assert.rejects(() => planLaunch({ task: 'x', context: 'fork', workspace: 'shared', cwd, sourceSessionFile: file }), /session header requires/);
  await writeFile(file, 'not-json\\n');
  await assert.rejects(() => planLaunch({ task: 'x', context: 'fork', workspace: 'shared', cwd, sourceSessionFile: file }), /JSONL header/);
});

test('Git commit SHA uses Zod validation without reimplementing Git branch syntax', async t => {
  const { cwd } = await setup(t);
  const { run } = mockGit({ cwd });
  const badRun = async (bin: string, args: string[], opts: { cwd: string }) => {
    if (args[0] === 'rev-parse' && args[1] === '--verify') return { code: 0, stdout: 'invalid-commit', stderr: '' };
    return run(bin, args, opts);
  };
  await assert.rejects(() => planLaunch({ task: 'x', context: 'independent', workspace: 'worktree', cwd, branch: 'feat/x' }, { run: badRun }), /invalid commit SHA/);
});

test('Git failures still reject the launch before running workmux', async t => {
  const { cwd } = await setup(t);
  const { run } = mockGit({ cwd });
  const failedRun = async (bin: string, args: string[], opts: { cwd: string }) => {
    if (args[0] === 'check-ref-format') return { code: 128, stdout: '', stderr: 'fatal: invalid ref' };
    return run(bin, args, opts);
  };
  await assert.rejects(() => planLaunch({ task: 'x', context: 'independent', workspace: 'worktree', cwd, branch: 'feat/x' }, { run: failedRun }), /git failed: fatal/);
});
