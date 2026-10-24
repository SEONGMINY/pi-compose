import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planLaunch, executeLaunch, quoteShell, validateRequest } from '../src/launch.mjs';

async function setup(t, { sourceCwd } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-compose-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); await mkdir(cwd);
  const file = join(root, 'main.jsonl');
  await writeFile(file, JSON.stringify({ type: 'session', id: 'main-123', cwd: sourceCwd || cwd }) + '\n');
  return { root, cwd, file };
}

function mockGit({ cwd, dirty = '', existingBranch = false } = {}) {
  const calls = [];
  const run = async (bin, args, options) => {
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
  const received = [];
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
