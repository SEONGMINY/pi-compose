import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type NativeWorktreeReceipt = {
  workspaceCwd: string;
  root: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  worktreePath: string;
  hadUncommittedChanges: boolean;
};

/**
 * Read Git's exact current HEAD and create a new branch/worktree, not a
 * stash, commit, copied directory, Git merge, or another workmux wrapper.
 */
export async function createNativeWorktree(
  callerCwd: string,
  role: 'work' | 'support',
): Promise<NativeWorktreeReceipt> {
  const canonical = await realpath(callerCwd);
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await exec('git', ['-C', canonical, ...args], {
      timeout: 15000, maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trimEnd();
  };
  const root = await realpath(await git('rev-parse', '--show-toplevel'));
  const inside = relative(root, canonical);
  if (inside.startsWith('..' + sep) || inside === '..' || isAbsolute(inside)) {
    throw new Error('The caller working directory is outside the Git worktree.');
  }
  // Detached HEAD has no current branch. Fail explicitly instead of inventing
  // an ambiguous branch base. A branch named by a user is never force-reset.
  let baseBranch: string;
  try {
    baseBranch = (await git('symbolic-ref', '--quiet', '--short', 'HEAD')).trim();
  } catch {
    throw new Error('The caller has a detached HEAD; no current branch is available.');
  }
  const baseCommit = (await git('rev-parse', '--verify', 'HEAD')).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) {
    throw new Error('Cannot identify the caller current HEAD commit.');
  }
  const dirty = (await git('status', '--porcelain=v1', '--untracked-files=normal')).length > 0;
  const id = randomUUID();
  const suffix = id.slice(0, 12);
  const branch = 'pic/' + role + '-' + id;
  const worktreePath = resolve(dirname(root), basename(root) + '-pic-' + role + '-' + suffix);
  try {
    await access(worktreePath);
    throw new Error('The proposed Git worktree path already exists: ' + worktreePath);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  // Do not switch the caller HEAD, copy uncommitted files or reuse a checked-
  // out branch. Git owns atomic ref locking and worktree registration.
  try {
    await git('worktree', 'add', '-b', branch, worktreePath, baseCommit);
  } catch (error) {
    // Git might have created a partial worktree. Never auto-delete possibly
    // user-visible files/branches or silently retry with a different name.
    throw new Error('Git worktree creation failed or is uncertain at ' + worktreePath +
      ' (branch ' + branch + '). Inspect with git worktree list; no automatic cleanup. ' +
      String(error));
  }
  const workspaceCwd = inside ? join(worktreePath, inside) : worktreePath;
  return {
    workspaceCwd, root, branch, baseBranch, baseCommit, worktreePath,
    hadUncommittedChanges: dirty,
  };
}
