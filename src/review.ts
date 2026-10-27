import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runProcess, type ProcessRunner } from './launch.ts';

export type WorktreeReview = {
  branch: string;
  base: string;
  changes: string;
  stat: string;
  patch: string;
  truncated: boolean;
  warning?: string;
};

async function git(run: ProcessRunner, args: string[], cwd: string): Promise<string> {
  const result = await run('git', args, { cwd });
  if (result.code !== 0) throw new Error('Git review unavailable (' + args[0] + '): ' + (result.stderr || 'exit ' + result.code));
  return result.stdout;
}

/**
 * Git owns all diff facts. Only inspect the exact verified Worktree/branch.
 * If the launch base was not recorded (legacy task), show HEAD-only changes
 * and explain that committed changes since fork cannot be reconstructed.
 * Never write, stage, merge, reset, delete or run shell commands.
 */
export async function inspectReview(
  worktreePath: string, branch: string, baseSha?: string,
  { run = runProcess }: { run?: ProcessRunner } = {},
): Promise<WorktreeReview> {
  const cwd = await realpath(resolve(worktreePath));
  const reportedRoot = await git(run, ['rev-parse', '--show-toplevel'], cwd);
  const root = await realpath(resolve(reportedRoot.trim()));
  if (cwd !== root) throw new Error('Worktree path is not the exact Git checkout root; review refused');
  const currentBranch = (await git(run, ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)).trim();
  if (currentBranch !== branch) throw new Error('Worktree branch has changed; review refused');
  if (baseSha && !/^[a-fA-F0-9]{40,64}$/.test(baseSha)) throw new Error('Invalid stored Git base SHA');
  const base = baseSha || 'HEAD';
  await git(run, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'], cwd);
  const changes = await git(run, ['status', '--short', '--untracked-files=normal'], cwd);
  const stat = await git(run, ['diff', '--no-ext-diff', '--stat', base, '--'], cwd);
  const patch = await git(run, ['diff', '--no-ext-diff', base, '--'], cwd);
  const maxPreview = 12000;
  return {
    branch, base, changes: changes || '(working tree clean)',
    stat: stat || '(tracked changes not found)',
    patch: patch.slice(0, maxPreview) || '(tracked diff not found)',
    truncated: patch.length > maxPreview,
    ...(!baseSha ? { warning: 'This legacy task has no recorded fork base. Diff against HEAD may omit earlier commits.' } : {}),
  };
}
