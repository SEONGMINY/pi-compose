import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export class LaunchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'LaunchError';
    this.detail = detail;
  }
}

const CONTEXTS = new Set(['fork', 'independent']);
const WORKSPACES = new Set(['shared', 'worktree']);

// tmux runs a shell command. Quote *each* token so task strings cannot become shell syntax.
export function quoteShell(arg) {
  return `'${String(arg).replaceAll("'", "'\\''")}'`;
}

export function validateRequest(input) {
  if (!CONTEXTS.has(input.context)) throw new LaunchError('Choose --context fork|independent');
  if (!WORKSPACES.has(input.workspace)) throw new LaunchError('Choose --workspace shared|worktree');
  if (typeof input.task !== 'string' || !input.task.trim()) throw new LaunchError('--task must not be empty');
  if (input.context === 'fork' && !input.sourceSessionFile) throw new LaunchError('Fork requires --source-session-file (never guess the Main session)');
  if (input.context === 'independent' && input.sourceSessionFile) throw new LaunchError('--source-session-file is only valid with --context fork');
  if (input.workspace === 'worktree' && !input.branch) throw new LaunchError('Worktree requires an explicit --branch');
  if (input.workspace === 'shared' && (input.branch || input.base)) throw new LaunchError('--branch/--base only apply to worktree');
  if (input.task.includes('\0')) throw new LaunchError('Invalid NUL in --task');
}

export async function runProcess(bin, args, { cwd } = {}) {
  return await new Promise((done, fail) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-32768); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32768); });
    child.once('error', fail);
    child.once('close', code => done({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function checkedRun(run, bin, args, cwd) {
  let result;
  try { result = await run(bin, args, { cwd }); }
  catch (error) { throw new LaunchError(`${bin} could not start: ${error.message}`); }
  if (result.code !== 0) throw new LaunchError(`${bin} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  return result.stdout;
}

async function loadSourceSession(file) {
  const path = await realpath(resolve(file)).catch(() => { throw new LaunchError(`Cannot read source Pi session: ${file}`); });
  if (!(await stat(path)).isFile()) throw new LaunchError('Source Pi session must be a regular file');
  // A Main session may be huge: read only its header, never its full conversation.
  const stream = createReadStream(path, { encoding: 'utf8', start: 0, end: 16383 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let firstLine;
  try { for await (const line of lines) { firstLine = line; break; } }
  finally { lines.close(); stream.destroy(); }
  let header;
  try { header = JSON.parse(firstLine); }
  catch { throw new LaunchError('Source Pi session does not have a JSONL header'); }
  if (header.type !== 'session' || !header.id || !header.cwd) throw new LaunchError('Source Pi session header requires type=session, id and cwd');
  return { path, id: String(header.id), cwd: await realpath(resolve(header.cwd)).catch(() => resolve(header.cwd)) };
}

export async function planLaunch(input, { run = runProcess, id = () => randomUUID().slice(0, 8) } = {}) {
  validateRequest(input);
  const cwd = await realpath(resolve(input.cwd || process.cwd())).catch(() => { throw new LaunchError(`Directory not found: ${input.cwd}`); });
  if (!(await stat(cwd)).isDirectory()) throw new LaunchError('Target cwd must be a directory');
  const source = input.context === 'fork' ? await loadSourceSession(input.sourceSessionFile) : undefined;
  const warnings = [];
  const sessionName = `pc-${input.task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '') || 'agent'}-${id()}`;
  const task = input.task.trim();

  if (input.workspace === 'shared') {
    if (source && source.cwd !== cwd) warnings.push('Fork source was created in a different cwd; check recorded absolute paths and project contracts.');
    const piArgs = [...(source ? ['--fork', source.path] : []), task];
    const command = ['pi', ...piArgs].map(quoteShell).join(' ');
    return {
      context: input.context, workspace: input.workspace, cwd, task,
      source: source ? { id: source.id, path: source.path, cwd: source.cwd } : null,
      baseSha: null, branch: null, tmuxTarget: sessionName,
      program: 'tmux', args: ['new-session', '-d', '-s', sessionName, '-c', cwd, command],
      warnings,
    };
  }

  const repo = await checkedRun(run, 'git', ['rev-parse', '--show-toplevel'], cwd);
  const repoRoot = await realpath(repo);
  if (source && source.cwd !== repoRoot) {
    throw new LaunchError(`workmux Pi Fork discovers sessions by source repository root. Source cwd (${source.cwd}) != repo root (${repoRoot}). Choose a source session based at the root, or use --workspace shared.`);
  }
  if (!/^[^\s-][^\s]*$/.test(input.branch) || input.branch.startsWith('-')) throw new LaunchError('Invalid branch name');
  await checkedRun(run, 'git', ['check-ref-format', '--branch', input.branch], repoRoot);
  const branchExists = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${input.branch}`], { cwd: repoRoot });
  if (branchExists.code === 0) throw new LaunchError(`Branch already exists: ${input.branch}. Phase 1 only creates new worktree branches; reopen/resume is handled separately.`);
  if (branchExists.code !== 1) throw new LaunchError(`Cannot check branch availability: ${branchExists.stderr || branchExists.code}`);
  const base = input.base || 'HEAD';
  if (base.startsWith('-')) throw new LaunchError('Invalid --base');
  const baseSha = await checkedRun(run, 'git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], repoRoot);
  const dirty = await checkedRun(run, 'git', ['status', '--porcelain', '--untracked-files=normal'], repoRoot);
  if (dirty) warnings.push('Source checkout has uncommitted changes; new Worktree is based on a commit and does not copy them.');
  const args = ['add', input.branch, '--agent', 'pi', '--base', baseSha,
    ...(source ? [`--fork=${source.id}`] : []), '--prompt', task];
  return {
    context: input.context, workspace: input.workspace, cwd: repoRoot, task,
    source: source ? { id: source.id, path: source.path, cwd: source.cwd } : null,
    branch: input.branch, baseSha, tmuxTarget: null,
    program: 'workmux', args,
    warnings,
  };
}

export async function executeLaunch(plan, { run = runProcess } = {}) {
  // All mutation paths begin *only* after a user invokes launch without --dry-run.
  // The selected external program owns resource creation; we do not perform cleanup on failure.
  const output = await checkedRun(run, plan.program, plan.args, plan.cwd).catch(error => {
    throw new LaunchError(`Launch failed; worktree or tmux resources may exist. Inspect before retrying. ${error.message}`);
  });
  return {
    status: 'launch_command_succeeded_agent_unverified',
    context: plan.context, workspace: plan.workspace,
    cwd: plan.cwd, branch: plan.branch, baseSha: plan.baseSha,
    sourceSessionId: plan.source?.id ?? null, tmuxTarget: plan.tmuxTarget,
    warnings: plan.warnings,
    note: 'Pi session ID, agent activity and dashboard visibility have not been verified.',
    output: output.slice(0, 1200),
  };
}
