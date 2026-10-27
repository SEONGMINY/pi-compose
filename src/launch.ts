import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';

const launchInputSchema = z.object({
  task: z.string().trim().min(1, '--task must not be empty').refine(value => !value.includes('\0'), 'Invalid NUL in --task'),
  context: z.enum(['fork', 'independent'], { error: 'Choose --context fork|independent' }),
  workspace: z.enum(['shared', 'worktree'], { error: 'Choose --workspace shared|worktree' }),
  cwd: z.string().optional(),
  sourceSessionFile: z.string().optional(),
  composeExtensionFile: z.string().optional(),
  branch: z.string().optional(),
  base: z.string().optional(),
}).superRefine((input, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (input.context === 'fork' && !input.sourceSessionFile) issue('sourceSessionFile', 'Fork requires --source-session-file (never guess the Main session)');
  if (input.context === 'independent' && input.sourceSessionFile) issue('sourceSessionFile', '--source-session-file is only valid with --context fork');
  if (input.workspace === 'worktree' && !input.branch) issue('branch', 'Worktree requires an explicit --branch');
  if (input.workspace === 'shared' && (input.branch || input.base)) issue('branch', '--branch/--base only apply to worktree');
});

const piSessionHeaderSchema = z.object({
  type: z.literal('session'),
  id: z.string().min(1),
  cwd: z.string().min(1),
  parentSession: z.string().optional(),
});
const gitCommitShaSchema = z.string().regex(/^[0-9a-fA-F]{40,64}$/, 'Git returned an invalid commit SHA');
const gitRootSchema = z.string().min(1, 'Git returned an empty repository root');

export type LaunchInput = z.infer<typeof launchInputSchema>;
export type PiSessionHeader = z.infer<typeof piSessionHeaderSchema>;
export type ProcessResult = { code: number | null; stdout: string; stderr: string };
export type ProcessRunner = (bin: string, args: string[], options: { cwd: string }) => Promise<ProcessResult>;
export type SessionSource = { path: string; id: string; cwd: string; parentSession?: string };
export type LaunchPlan = {
  context: LaunchInput['context'];
  workspace: LaunchInput['workspace'];
  cwd: string;
  task: string;
  source: SessionSource | null;
  branch: string | null;
  baseSha: string | null;
  tmuxTarget: string | null;
  workmuxTargetName?: string;
  /** Fallback for a valid Pi session saved in a nested repo directory. */
  worktreePath?: string;
  preparation?: { program: 'git'; args: string[]; cwd: string };
  program: 'tmux' | 'workmux';
  args: string[];
  warnings: string[];
};

export class LaunchError extends Error {
  readonly detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'LaunchError';
    this.detail = detail;
  }
}

function validationError(error: z.ZodError): LaunchError {
  return new LaunchError(error.issues.map(issue => issue.message).join('; '), error.issues);
}

export function validateRequest(input: unknown): LaunchInput {
  const result = launchInputSchema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

// tmux runs a shell command; quote each token rather than interpreting the user task as shell syntax.
/** A short, explicit task remains the task identity; Fork owns the inherited discussion. */
export function delegationPrompt(task: string, context: LaunchInput['context']): string {
  const instruction = task.trim();
  if (context === 'independent') return instruction;
  return [
    instruction,
    '',
    'You were started as a fork of the selected Pi conversation.',
    'Review the inherited discussion for requirements, decisions, reasons, and explicit constraints before editing.',
    'Keep prohibitions and their reasons intact; do not weaken them into optional advice.',
    'If the inherited discussion or actionable requirements are not present, do not guess or change files. Explain what is missing and ask for clarification.',
    'Only implement the task requested above; never merge, delete worktrees, or discard changes unless explicitly asked.',
  ].join('\n');
}

export function quoteShell(arg: string): string {
  return "'" + arg.replaceAll("'", "'\\''") + "'";
}

export async function runProcess(bin: string, args: string[], { cwd }: { cwd: string }): Promise<ProcessResult> {
  return await new Promise((done, fail) => {
    // PIC_COMPOSE_CORE is a marker for the main Pi Extension. Never propagate it
    // to agents created by workmux, otherwise their navigation Extension is suppressed.
    const env = { ...process.env };
    if (bin === 'workmux') { delete env.PIC_COMPOSE_CORE; delete env.PIC_COMPOSE_MAIN; }
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-32768); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32768); });
    child.once('error', fail);
    child.once('close', code => done({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function checkedRun(run: ProcessRunner, bin: string, args: string[], cwd: string): Promise<string> {
  let result: ProcessResult;
  try { result = await run(bin, args, { cwd }); }
  catch (error) { throw new LaunchError(`${bin} could not start: ${error instanceof Error ? error.message : String(error)}`); }
  if (result.code !== 0) throw new LaunchError(`${bin} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  return result.stdout;
}

export async function loadSourceSession(file: string): Promise<SessionSource> {
  const path = await realpath(resolve(file)).catch(() => { throw new LaunchError(`Cannot read source Pi session: ${file}`); });
  if (!(await stat(path)).isFile()) throw new LaunchError('Source Pi session must be a regular file');
  // Main sessions can be huge; inspect the JSONL header only.
  const stream = createReadStream(path, { encoding: 'utf8', start: 0, end: 16383 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let firstLine: string | undefined;
  try { for await (const line of lines) { firstLine = line; break; } }
  finally { lines.close(); stream.destroy(); }
  let header: unknown;
  try { header = JSON.parse(firstLine ?? ''); }
  catch { throw new LaunchError('Source Pi session does not have a JSONL header'); }
  const result = piSessionHeaderSchema.safeParse(header);
  if (!result.success) throw new LaunchError(
    `Source Pi session header requires type=session, id and cwd: ${validationError(result.error).message}`,
    result.error.issues,
  );
  return { path, id: result.data.id,
    cwd: await realpath(resolve(result.data.cwd)).catch(() => resolve(result.data.cwd)),
    ...(result.data.parentSession ? {parentSession: await realpath(resolve(result.data.parentSession))
      .catch(() => resolve(result.data.parentSession!))} : {}),
  };
}

/** workmux added Pi native Fork on 2026-10-23 in v0.1.277. No optimistic
 * assumption about an older binary's capabilities.
 */
export function workmuxPiForkSupported(output:string):boolean {
  const m=output.match(/(?:workmux\\s+v?)(\\d+)\\.(\\d+)\\.(\\d+)/i);
  if(!m)return false;
  const [major,minor,patch]=m.slice(1).map(Number);
  return major>0||(major===0&&(minor>1||(minor===1&&patch>=277)));
}

export async function planLaunch(
  input: unknown,
  { run = runProcess, id = () => randomUUID().slice(0, 8) }: { run?: ProcessRunner; id?: () => string } = {},
): Promise<LaunchPlan> {
  const request = validateRequest(input);
  const cwd = await realpath(resolve(request.cwd || process.cwd())).catch(() => { throw new LaunchError(`Directory not found: ${request.cwd}`); });
  if (!(await stat(cwd)).isDirectory()) throw new LaunchError('Target cwd must be a directory');
  const source = request.context === 'fork' ? await loadSourceSession(request.sourceSessionFile ?? '') : undefined;
  const warnings: string[] = [];
  const sessionName = `pc-${request.task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '') || 'agent'}-${id()}`;
  const task = request.task;

  if (request.workspace === 'shared') {
    if (source && source.cwd !== cwd) warnings.push('Fork source was created in a different cwd; check recorded absolute paths and project contracts.');
    const composeExtensionFile = request.composeExtensionFile
      ? await realpath(request.composeExtensionFile).catch(() => {
        throw new LaunchError('Pi Compose base Extension file is unavailable; launch was not started.');
      })
      : null;
    const piArgs = [
      ...(composeExtensionFile ? ['--extension', composeExtensionFile] : []),
      ...(source ? ['--fork', source.path] : []), delegationPrompt(task, request.context),
    ];
    const command = 'PIC_COMPOSE_CORE=1 PIC_COMPOSE_MAIN=0 ' + ['pi', ...piArgs].map(quoteShell).join(' ');
    return {
      context: request.context, workspace: request.workspace, cwd, task,
      source: source ?? null, baseSha: null, branch: null, tmuxTarget: sessionName,
      program: 'tmux', args: ['new-session', '-d', '-s', sessionName, '-c', cwd, command], warnings,
    };
  }

  const repo = gitRootSchema.safeParse(await checkedRun(run, 'git', ['rev-parse', '--show-toplevel'], cwd));
  if (!repo.success) throw validationError(repo.error);
  const repoRoot = await realpath(repo.data);
  let nativeReason = source && source.cwd !== repoRoot
    ? 'Source Pi conversation was saved below the repository root' : '';
  if (source && !nativeReason) {
    // Workmux Pi Fork support is new. Prefer its integration only when the
    // installed runtime can demonstrably support Pi --fork.
    const version = await run('workmux',['--version'],{cwd:repoRoot}).catch(()=>null);
    if(!version||version.code!==0||!workmuxPiForkSupported(version.stdout+' '+version.stderr))
      nativeReason='workmux Pi Fork support (>= 0.1.277) could not be verified';
  }
  const requiresNativePiFork = Boolean(source && nativeReason);
  const branch = request.branch ?? '';
  if (!/^[^\s-][^\s]*$/.test(branch) || branch.startsWith('-')) throw new LaunchError('Invalid branch name');
  await checkedRun(run, 'git', ['check-ref-format', '--branch', branch], repoRoot);
  const branchExists = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot });
  if (branchExists.code === 0) throw new LaunchError(`Branch already exists: ${branch}. Phase 1 only creates new worktree branches; reopen/resume is handled separately.`);
  if (branchExists.code !== 1) throw new LaunchError(`Cannot check branch availability: ${branchExists.stderr || branchExists.code}`);
  const base = request.base || 'HEAD';
  if (base.startsWith('-')) throw new LaunchError('Invalid --base');
  const sha = gitCommitShaSchema.safeParse(await checkedRun(run, 'git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], repoRoot));
  if (!sha.success) throw validationError(sha.error);
  const dirty = await checkedRun(run, 'git', ['status', '--porcelain', '--untracked-files=normal'], repoRoot);
  if (dirty) warnings.push('Source checkout has uncommitted changes; new Worktree is based on a commit and does not copy them.');
  if (requiresNativePiFork && source) {
    // workmux --fork discovers source sessions relative to the repo root.
    // Pi --fork accepts an exact JSONL path, so use Git + tmux directly only
    // for this unsupported source location. Existing runtime APIs are reused.
    const worktreePath = join(dirname(repoRoot), basename(repoRoot) + '-' + sessionName);
    const extension = request.composeExtensionFile
      ? await realpath(request.composeExtensionFile).catch(() => {
        throw new LaunchError('Pi Compose Extension is missing; nothing has been created.');
      }) : null;
    const piArgs = [...(extension ? ['--extension', extension] : []),
      '--fork', source.path, delegationPrompt(task, request.context)];
    const command = 'PIC_COMPOSE_CORE=1 PIC_COMPOSE_MAIN=0 ' + ['pi', ...piArgs].map(quoteShell).join(' ');
    warnings.push(nativeReason + '. Git + tmux will prepare the Worktree and Pi will fork the exact original JSONL path; the installed workmux Pi Fork integration is not used.');
    return {
      context: request.context, workspace: 'worktree', cwd: repoRoot, task, source,
      branch, baseSha: sha.data, tmuxTarget: sessionName, worktreePath,
      preparation: { program: 'git', args: ['worktree','add','-b',branch,worktreePath,sha.data], cwd:repoRoot },
      program: 'tmux', args:['new-session','-d','-s',sessionName,'-c',worktreePath,command], warnings,
    };
  }
  // workmux owns the terminal layout. Ghostty-specific tab creation is not
  // part of the default Compose launch or navigation experience.
  // An exact per-launch target name lets the Hub validate the real tmux target.
  // It does not rely on branch names, worktree directory slugs, or a global registry.
  const workmuxTargetName = sessionName;
  const args = ['add', branch, '--background', '--target-name', workmuxTargetName,
    '--agent', 'pi', '--base', sha.data,
    ...(source ? [`--fork=${source.id}`] : []), '--prompt', delegationPrompt(task, request.context)];
  return {
    context: request.context, workspace: request.workspace, cwd: repoRoot, task,
    source: source ?? null, branch, baseSha: sha.data, tmuxTarget: null, workmuxTargetName,
    program: 'workmux', args, warnings,
  };
}

export async function executeLaunch(plan: LaunchPlan, { run = runProcess }: { run?: ProcessRunner } = {}) {
  // No mutation until explicitly executing; resource cleanup on failure requires inspection.
  // If Git succeeds but tmux fails, leave the Worktree intact for inspection.
  // Replaying the same branch must not start another agent or destroy anything.
  if (plan.preparation) {
    await checkedRun(run, plan.preparation.program, plan.preparation.args, plan.preparation.cwd)
      .catch(error => {
        throw new LaunchError('Worktree preparation failed; inspect Git before retrying. ' + String(error));
      });
  }
  const output = await checkedRun(run, plan.program, plan.args, plan.worktreePath || plan.cwd).catch(error => {
    throw new LaunchError(`Launch failed; worktree or tmux resources may exist. Inspect before retrying. ${error instanceof Error ? error.message : String(error)}`);
  });
  return {
    status: 'launch_command_succeeded_agent_unverified' as const,
    context: plan.context, workspace: plan.workspace,
    cwd: plan.cwd, branch: plan.branch, baseSha: plan.baseSha,
    sourceSessionId: plan.source?.id ?? null, tmuxTarget: plan.tmuxTarget,
    warnings: plan.warnings,
    note: 'Pi session ID, agent activity and dashboard visibility have not been verified.',
    output: output.slice(0, 1200),
  };
}
