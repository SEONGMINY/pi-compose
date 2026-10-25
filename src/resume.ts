import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { LaunchError, loadSourceSession, quoteShell, runProcess, type ProcessRunner } from './launch.ts';

const inspectInputSchema = z.object({
  cwd: z.string().optional(),
  branch: z.string().min(1),
});

const resumeInputSchema = z.object({
  workspace: z.enum(['shared', 'worktree']),
  cwd: z.string().optional(),
  sessionFile: z.string().min(1),
  branch: z.string().optional(),
  tmuxTarget: z.string().optional(),
  composeExtensionFile: z.string().optional(),
}).superRefine((input, ctx) => {
  if (input.workspace === 'worktree' && !input.branch) {
    ctx.addIssue({ code: 'custom', path: ['branch'], message: 'Worktree resume requires --branch' });
  }
  if (input.workspace === 'shared' && input.branch) {
    ctx.addIssue({ code: 'custom', path: ['branch'], message: '--branch only applies to worktree resume' });
  }
});

export type InspectInput = z.infer<typeof inspectInputSchema>;
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type WorktreeInfo = {
  branch: string;
  status: 'worktree-existing' | 'branch-only' | 'not-found';
  path: string | null;
  dirty: boolean | null;
  head: string | null;
  repositoryRoot: string;
};
export type ResumePlan = {
  workspace: ResumeInput['workspace'];
  cwd: string;
  sessionFile: string;
  sessionId: string;
  branch: string | null;
  tmuxTarget: string;
  status: 'target-absent' | 'target-occupied';
  program: 'tmux';
  args: string[];
  warnings: string[];
};

function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new LaunchError(result.error.issues.map(issue => issue.message).join('; '), result.error.issues);
  }
  return result.data;
}

async function successful(run: ProcessRunner, bin: string, args: string[], cwd: string): Promise<string> {
  let result;
  try { result = await run(bin, args, { cwd }); }
  catch (error) {
    throw new LaunchError(bin + ' could not start: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (result.code !== 0) {
    throw new LaunchError(bin + ' failed: ' + (result.stderr || result.stdout || 'exit ' + result.code));
  }
  return result.stdout;
}

function parseWorktrees(output: string): Array<{ path: string; branch: string | null; head: string | null }> {
  return output.split('\0\0').filter(Boolean).map(block => {
    const entries = block.split('\0');
    const location = entries.find(entry => entry.startsWith('worktree '));
    if (!location) throw new LaunchError('Git returned a worktree without a path');
    const branch = entries.find(entry => entry.startsWith('branch refs/heads/'));
    const head = entries.find(entry => entry.startsWith('HEAD '));
    return {
      path: location.slice('worktree '.length),
      branch: branch ? branch.slice('branch refs/heads/'.length) : null,
      head: head ? head.slice('HEAD '.length) : null,
    };
  });
}

/** Read-only: inspect exact Git branch ownership, including partial launch failures. */
export async function inspectWorktree(
  input: unknown, { run = runProcess }: { run?: ProcessRunner } = {},
): Promise<WorktreeInfo> {
  const request = validate(inspectInputSchema, input);
  const cwd = await realpath(resolve(request.cwd || process.cwd())).catch(() => {
    throw new LaunchError('Directory not found: ' + request.cwd);
  });
  // Git, not Zod, is responsible for Git branch grammar.
  await successful(run, 'git', ['check-ref-format', '--branch', request.branch], cwd);
  const repositoryRoot = await realpath(await successful(run, 'git', ['rev-parse', '--show-toplevel'], cwd));
  const listing = parseWorktrees(await successful(run, 'git', ['worktree', 'list', '--porcelain', '-z'], repositoryRoot));
  const matching = listing.filter(entry => entry.branch === request.branch);
  if (matching.length > 1) throw new LaunchError('Git returned multiple worktrees for this branch');
  if (matching.length === 1) {
    const found = matching[0];
    if (!found) throw new LaunchError('Git worktree entry missing');
    if (found.path === listing[0]?.path) {
      throw new LaunchError('This branch is checked out in the main repository, not a separate Worktree');
    }
    const path = await realpath(found.path).catch(() => {
      throw new LaunchError('Worktree directory is inaccessible; inspect Git metadata before retrying');
    });
    const dirty = (await successful(run, 'git', ['status', '--porcelain', '--untracked-files=all'], path)).length > 0;
    return { branch: request.branch, status: 'worktree-existing', path, dirty, head: found.head, repositoryRoot };
  }
  let exists;
  try { exists = await run('git', ['show-ref', '--verify', '--quiet', 'refs/heads/' + request.branch], { cwd: repositoryRoot }); }
  catch (error) { throw new LaunchError('Cannot inspect existing branch: ' + String(error)); }
  if (exists.code !== 0 && exists.code !== 1) throw new LaunchError('Cannot determine whether the branch exists: ' + exists.stderr);
  return {
    branch: request.branch,
    status: exists.code === 0 ? 'branch-only' : 'not-found',
    path: null, dirty: null, head: null, repositoryRoot,
  };
}

function targetName(sessionPath: string, cwd: string): string {
  // Stable across retries of the SAME session and cwd, unlike a random launch ID.
  return 'pc-resume-' + createHash('sha256').update(cwd + '\0' + sessionPath).digest('hex').slice(0, 16);
}

async function checkTmuxTarget(
  target: string, cwd: string, run: ProcessRunner,
): Promise<'target-absent' | 'target-occupied'> {
  let result;
  try { result = await run('tmux', ['has-session', '-t', '=' + target], { cwd }); }
  catch (error) {
    throw new LaunchError('Cannot inspect tmux target; resume was not started: ' + String(error));
  }
  if (result.code === 0) return 'target-occupied';
  if (result.code === 1) return 'target-absent';
  throw new LaunchError('Cannot inspect tmux target; resume was not started: ' + (result.stderr || 'exit ' + result.code));
}

/** Exact Pi session resume; never selects Pi's most recent conversation implicitly. */
export async function planResume(
  input: unknown, { run = runProcess }: { run?: ProcessRunner } = {},
): Promise<ResumePlan> {
  const request = validate(resumeInputSchema, input);
  const source = await loadSourceSession(request.sessionFile);
  let cwd: string;
  let branch: string | null = null;
  const warnings: string[] = [];
  if (request.workspace === 'worktree') {
    const result = await inspectWorktree({ branch: request.branch, cwd: request.cwd }, { run });
    if (result.status !== 'worktree-existing' || !result.path) {
      throw new LaunchError('No checked-out Worktree for this branch (' + result.status + '). Use inspect to diagnose the existing Git state.');
    }
    cwd = result.path;
    branch = result.branch;
    if (result.dirty) warnings.push('Worktree has existing changes; resume will not clean, reset, or overwrite them.');
  } else {
    cwd = await realpath(resolve(request.cwd || process.cwd())).catch(() => {
      throw new LaunchError('Shared directory not found: ' + request.cwd);
    });
  }
  if (source.cwd !== cwd) {
    throw new LaunchError('Selected Pi session belongs to ' + source.cwd + ', not ' + cwd + '. Resume will not switch to an unrelated conversation.');
  }
  const name = request.tmuxTarget || targetName(source.path, cwd);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new LaunchError('--tmux-target must be a simple tmux session name (letters, digits, _ or -)');
  }
  const composeExtensionFile = request.composeExtensionFile
    ? await realpath(request.composeExtensionFile).catch(() => {
      throw new LaunchError('Pi Compose base Extension file is unavailable; resume was not started.');
    })
    : null;
  const status = await checkTmuxTarget(name, cwd, run);
  if (status === 'target-occupied') {
    warnings.push('Exact tmux target already exists. It may be an existing agent; no new Pi process will be started.');
  }
  warnings.push('Only this exact tmux target was checked. An existing Pi process under another target cannot be ruled out.');
  return {
    workspace: request.workspace, cwd, sessionFile: source.path, sessionId: source.id, branch,
    tmuxTarget: name, status, program: 'tmux',
    args: ['new-session', '-d', '-s', name, '-c', cwd,
      ['pi', ...(composeExtensionFile ? ['--extension', composeExtensionFile] : []), '--session', source.path].map(quoteShell).join(' ')],
    warnings,
  };
}

/** Re-check just before mutation; an occupied or uninspectable target is never replaced. */
export async function executeResume(
  plan: ResumePlan, { run = runProcess }: { run?: ProcessRunner } = {},
) {
  const status = await checkTmuxTarget(plan.tmuxTarget, plan.cwd, run);
  if (status === 'target-occupied') {
    return {
      status: 'target_occupied_no_launch' as const,
      sessionId: plan.sessionId, tmuxTarget: plan.tmuxTarget, cwd: plan.cwd, warnings: plan.warnings,
    };
  }
  try {
    await successful(run, plan.program, plan.args, plan.cwd);
  } catch (error) {
    throw new LaunchError('Resume failed; no existing resources were removed. Inspect tmux and Git before retrying. ' + String(error));
  }
  return {
    status: 'resume_command_succeeded_agent_unverified' as const,
    sessionId: plan.sessionId, tmuxTarget: plan.tmuxTarget, cwd: plan.cwd, warnings: plan.warnings,
  };
}
