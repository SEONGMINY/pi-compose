import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectWorktree, planResume, executeResume, type ResumePlan,
} from '../src/resume.ts';
import type { ProcessRunner } from '../src/launch.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-compose-resume-test-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const repo = join(root, 'repo');
  const worktree = join(root, 'worktree');
  await mkdir(repo);
  await mkdir(worktree);
  const sessionFile = join(root, 'agent.jsonl');
  const writeSession = async (cwd: string, id = 'exact-pi-agent') => {
    await writeFile(sessionFile, JSON.stringify({ type: 'session', id, cwd }) + '\n');
  };
  await writeSession(repo);
  return { root, repo, worktree, sessionFile, writeSession };
}

function gitMock(repo: string, worktree: string, { checkedOut = true, dirty = false, branchOnly = false } = {}) {
  const calls: Array<{ bin: string; args: string[]; cwd: string }> = [];
  const worktrees =
    'worktree ' + repo + '\0HEAD ' + 'a'.repeat(40) + '\0branch refs/heads/main\0\0' +
    (checkedOut ? 'worktree ' + worktree + '\0HEAD ' + 'b'.repeat(40) + '\0branch refs/heads/feat/api\0\0' : '');
  const run: ProcessRunner = async (bin, args, { cwd }) => {
    calls.push({ bin, args, cwd });
    if (bin === 'git') {
      if (args[0] === 'check-ref-format') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: repo, stderr: '' };
      if (args[0] === 'worktree') return { code: 0, stdout: worktrees, stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: dirty ? '?? new.ts' : '', stderr: '' };
      if (args[0] === 'show-ref') return { code: branchOnly ? 0 : 1, stdout: '', stderr: '' };
    }
    if (bin === 'tmux' && args[0] === 'has-session') return { code: 1, stdout: '', stderr: '' };
    throw new Error('Unexpected command: ' + bin + ' ' + args.join(' '));
  };
  return { run, calls };
}

test('inspect existing worktree by exact branch without mutating Git', async t => {
  const { repo, worktree } = await fixture(t);
  const { run, calls } = gitMock(repo, worktree, { dirty: true });
  const result = await inspectWorktree({ cwd: repo, branch: 'feat/api' }, { run });
  assert.deepEqual(result, {
    branch: 'feat/api', status: 'worktree-existing', path: worktree,
    dirty: true, head: 'b'.repeat(40), repositoryRoot: repo,
  });
  assert.ok(calls.some(x => x.args[0] === 'status' && x.cwd === worktree));
  assert.ok(!calls.some(x => ['add', 'remove', 'reset', 'clean', 'prune'].includes(x.args[0])));
});

test('inspect distinguishes a leftover branch from an actual checked-out Worktree', async t => {
  const { repo, worktree } = await fixture(t);
  const { run } = gitMock(repo, worktree, { checkedOut: false, branchOnly: true });
  const state = await inspectWorktree({ cwd: repo, branch: 'feat/api' }, { run });
  assert.equal(state.status, 'branch-only');
  assert.equal(state.path, null);
});

test('inspect identifies a not-found branch without creating it', async t => {
  const { repo, worktree } = await fixture(t);
  const { run } = gitMock(repo, worktree, { checkedOut: false });
  const result = await inspectWorktree({ cwd: repo, branch: 'feat/api' }, { run });
  assert.equal(result.status, 'not-found');
});

test('resuming shared session uses exact Pi --session and a deterministic tmux target', async t => {
  const { repo, sessionFile } = await fixture(t);
  const calls: Array<{ bin: string; args: string[] }> = [];
  const run: ProcessRunner = async (bin, args) => {
    calls.push({ bin, args });
    return { code: 1, stdout: '', stderr: 'no tmux session' };
  };
  const input = { workspace: 'shared', cwd: repo, sessionFile };
  const first = await planResume(input, { run });
  const second = await planResume(input, { run });
  assert.equal(first.sessionId, 'exact-pi-agent');
  assert.equal(first.tmuxTarget, second.tmuxTarget);
  assert.equal(first.status, 'target-absent');
  assert.deepEqual(first.args.slice(0, 6), ['new-session', '-d', '-s', first.tmuxTarget, '-c', repo]);
  assert.match(first.args.at(-1) ?? '', /^'pi' '--session' '/);
  assert.ok(first.args.at(-1)?.includes(sessionFile));
  assert.deepEqual(calls[0]?.args, ['has-session', '-t', '=' + first.tmuxTarget]);
});

test('resuming an exact worktree session preserves dirty changes', async t => {
  const { repo, worktree, sessionFile, writeSession } = await fixture(t);
  await writeSession(worktree);
  const { run } = gitMock(repo, worktree, { dirty: true });
  const plan = await planResume({ workspace: 'worktree', cwd: repo, branch: 'feat/api', sessionFile }, { run });
  assert.equal(plan.cwd, worktree);
  assert.equal(plan.branch, 'feat/api');
  assert.ok(plan.warnings.some(s => /existing changes/.test(s)));
});

test('no actual worktree prevents resume even when the Git branch still exists', async t => {
  const { repo, worktree, sessionFile } = await fixture(t);
  const { run } = gitMock(repo, worktree, { checkedOut: false, branchOnly: true });
  await assert.rejects(
    () => planResume({ workspace: 'worktree', cwd: repo, branch: 'feat/api', sessionFile }, { run }),
    /No checked-out Worktree/,
  );
});

test('resume refuses mismatched Pi session cwd instead of switching conversations', async t => {
  const { repo, worktree, sessionFile } = await fixture(t);
  const run: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: '' });
  await assert.rejects(
    () => planResume({ workspace: 'shared', cwd: worktree, sessionFile }, { run }),
    /Selected Pi session belongs to/,
  );
});

test('resume rejects incorrect mode options and invalid tmux target', async t => {
  const { repo, sessionFile } = await fixture(t);
  const run: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: '' });
  await assert.rejects(
    () => planResume({ workspace: 'worktree', cwd: repo, sessionFile }, { run }),
    /requires --branch/,
  );
  await assert.rejects(
    () => planResume({ workspace: 'shared', cwd: repo, sessionFile, branch: 'feat/api' }, { run }),
    /only applies to worktree/,
  );
  await assert.rejects(
    () => planResume({ workspace: 'shared', cwd: repo, sessionFile, tmuxTarget: 'other:session' }, { run }),
    /simple tmux session name/,
  );
});

test('resume does not create another Pi process when the exact tmux target is occupied', async t => {
  const { repo, sessionFile } = await fixture(t);
  const calls: string[] = [];
  const run: ProcessRunner = async (_bin, args) => {
    calls.push(args[0] ?? '');
    return { code: 0, stdout: '', stderr: '' };
  };
  const plan = await planResume({ workspace: 'shared', cwd: repo, sessionFile }, { run });
  assert.equal(plan.status, 'target-occupied');
  const result = await executeResume(plan, { run });
  assert.equal(result.status, 'target_occupied_no_launch');
  assert.deepEqual(calls, ['has-session', 'has-session']);
});

test('resume rechecks the tmux target immediately before creating a process', async t => {
  const { repo, sessionFile } = await fixture(t);
  let checkCount = 0;
  const commands: string[] = [];
  const run: ProcessRunner = async (bin, args) => {
    commands.push(bin + ' ' + args[0]);
    if (args[0] === 'has-session') {
      checkCount++;
      return { code: checkCount === 1 ? 1 : 0, stdout: '', stderr: '' };
    }
    throw new Error('Race should block new-session');
  };
  const plan = await planResume({ workspace: 'shared', cwd: repo, sessionFile }, { run });
  assert.equal((await executeResume(plan, { run })).status, 'target_occupied_no_launch');
  assert.deepEqual(commands, ['tmux has-session', 'tmux has-session']);
});

test('resume executes new-session once when target remains absent', async t => {
  const { repo, sessionFile } = await fixture(t);
  const calls: string[] = [];
  const run: ProcessRunner = async (bin, args) => {
    calls.push(bin + ' ' + args[0]);
    return { code: args[0] === 'has-session' ? 1 : 0, stdout: '', stderr: '' };
  };
  const plan = await planResume({ workspace: 'shared', cwd: repo, sessionFile }, { run });
  const result = await executeResume(plan, { run });
  assert.equal(result.status, 'resume_command_succeeded_agent_unverified');
  assert.deepEqual(calls, ['tmux has-session', 'tmux has-session', 'tmux new-session']);
});

test('resume never guesses running state if tmux inspection fails', async t => {
  const { repo, sessionFile } = await fixture(t);
  const run: ProcessRunner = async () => {
    throw Object.assign(new Error('tmux not installed'), { code: 'ENOENT' });
  };
  await assert.rejects(
    () => planResume({ workspace: 'shared', cwd: repo, sessionFile }, { run }),
    /Cannot inspect tmux target/,
  );
});

test('resume failure does not call deletion or cleanup commands', async t => {
  const { repo, sessionFile } = await fixture(t);
  const calls: string[] = [];
  const run: ProcessRunner = async (bin, args) => {
    calls.push(bin + ' ' + args[0]);
    return { code: args[0] === 'has-session' ? 1 : 2, stdout: '', stderr: 'unable to start' };
  };
  const plan = await planResume({ workspace: 'shared', cwd: repo, sessionFile }, { run });
  await assert.rejects(() => executeResume(plan, { run }), /no existing resources were removed/);
  assert.deepEqual(calls, ['tmux has-session', 'tmux has-session', 'tmux new-session']);
});
