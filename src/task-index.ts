import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSourceSession, type LaunchPlan } from './launch.ts';

/** Only user-approved launch identity. Pi, tmux and workmux remain the source of truth for runtime state. */
export type TmuxLocation = {
  session: string;
  windowId: string;
  windowName: string;
};

export type TaskLink = {
  projectRoot?: string;
  mainLocation?: TmuxLocation;
  targetLocation?: TmuxLocation;
  worktreePath?: string;
  workmuxHandle?: string;
  title?: string;
};

/** Work result snapshots are claims, not approvals, agent completion, or live state. */
export type HandoffEvidence = {
  kind: 'developer_claim';
  recordedAt: string;
  gitHead: string;
  summary: string;
  why: string;
  checks: string;
  outstanding: string;
  changedFileCount: number;
};
export type ReviewEvidence = {
  kind: 'independent_review_executed';
  recordedAt: string;
  gitHead: string;
  reportExcerpt: string;
  incomplete: boolean;
};
export type TaskEvidence = { handoff: HandoffEvidence } | { review: ReviewEvidence };

export type TaskRecord = {
  id: string;
  title: string;
  /** Exact original instruction, not a summary of the Forked session. */
  instruction?: string;
  projectRoot: string;
  /** Shared launch cwd (Worktree launch runs from the main checkout). */
  launchCwd?: string;
  /** Actual spawned Pi session, linked only after an exact live tmux match. */
  agentSessionId?: string;
  agentSessionFile?: string;
  workspace: 'shared' | 'worktree';
  context: 'fork' | 'independent';
  branch?: string;
  tmuxTarget?: string;
  /** PR #3 legacy field. Never use it to infer an originating Main. */
  mainTmux?: string;
  mainLocation?: TmuxLocation;
  targetLocation?: TmuxLocation;
  worktreePath?: string;
  workmuxHandle?: string;
  workmuxTargetName?: string;
  sourceSessionId?: string;
  /** Explicitly captured user-requested result snapshots (no autonomous status tracking). */
  handoff?: HandoffEvidence;
  review?: ReviewEvidence;
  createdAt: string;
};

function directory(root: string): string {
  const hash = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 24);
  return join(homedir(), '.pi', 'compose', 'tasks', hash);
}

export async function recordTask(plan: LaunchPlan, link: TaskLink = {}): Promise<TaskRecord> {
  const task: TaskRecord = {
    id: randomUUID(),
    title: (link.title?.trim() || plan.task.split('\n').find(line => line.trim()) || plan.task)
      .replace(/\s+/g, ' ').trim().slice(0, 96),
    instruction: plan.task,
    projectRoot: resolve(link.projectRoot || plan.cwd),
    launchCwd: resolve(plan.cwd),
    workspace: plan.workspace,
    context: plan.context,
    ...(plan.branch ? { branch: plan.branch } : {}),
    ...(plan.tmuxTarget ? { tmuxTarget: plan.tmuxTarget } : {}),
    ...(link.mainLocation ? { mainLocation: link.mainLocation } : {}),
    ...(link.targetLocation ? { targetLocation: link.targetLocation } : {}),
    ...(link.worktreePath ? { worktreePath: resolve(link.worktreePath) } : {}),
    ...(link.workmuxHandle ? { workmuxHandle: link.workmuxHandle } : {}),
    ...(plan.workmuxTargetName ? { workmuxTargetName: plan.workmuxTargetName } : {}),
    ...(plan.source?.id ? { sourceSessionId: plan.source.id } : {}),
    createdAt: new Date().toISOString(),
  };
  const dir = directory(task.projectRoot);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const dest = join(dir, task.id + '.json');
  const tmp = join(dir, task.id + '.tmp');
  try {
    await writeFile(tmp, JSON.stringify(task), { mode: 0o600, flag: 'wx' });
    await rename(tmp, dest);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return task;
}

function validLocation(value: unknown): value is TmuxLocation {
  if (!value || typeof value !== 'object') return false;
  const loc = value as Partial<TmuxLocation>;
  return typeof loc.session === 'string' && loc.session.length > 0
    && typeof loc.windowId === 'string' && /^@[0-9]+$/.test(loc.windowId)
    && typeof loc.windowName === 'string' && loc.windowName.length > 0;
}

function isRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== 'object') return false;
  const x = value as Partial<TaskRecord>;
  return typeof x.id === 'string' && /^[0-9a-f-]{36}$/.test(x.id)
    && typeof x.title === 'string' && x.title.length > 0 && x.title.length <= 100
    && typeof x.projectRoot === 'string' && x.projectRoot.startsWith('/')
    && (x.workspace === 'shared' || x.workspace === 'worktree')
    && (x.context === 'fork' || x.context === 'independent')
    && (typeof x.branch === 'string' || typeof x.tmuxTarget === 'string')
    && (x.instruction === undefined || (typeof x.instruction === 'string' && x.instruction.length <= 20000))
    && (x.handoff === undefined || (x.handoff.kind === 'developer_claim'
      && typeof x.handoff.summary === 'string' && typeof x.handoff.gitHead === 'string'))
    && (x.review === undefined || (x.review.kind === 'independent_review_executed'
      && typeof x.review.reportExcerpt === 'string' && typeof x.review.gitHead === 'string'))
    && (x.launchCwd === undefined || (typeof x.launchCwd === 'string' && x.launchCwd.startsWith('/')))
    && (x.agentSessionId === undefined || typeof x.agentSessionId === 'string')
    && (x.agentSessionFile === undefined || (typeof x.agentSessionFile === 'string' && x.agentSessionFile.startsWith('/')))
    && typeof x.createdAt === 'string'
    && (x.mainLocation === undefined || validLocation(x.mainLocation))
    && (x.targetLocation === undefined || validLocation(x.targetLocation))
    && (x.worktreePath === undefined || typeof x.worktreePath === 'string')
    && (x.workmuxHandle === undefined || typeof x.workmuxHandle === 'string')
    && (x.workmuxTargetName === undefined || typeof x.workmuxTargetName === 'string');
}

/** Bounded listing, no transcript scanning and no mutations during discovery. */
export async function listTasks(projectRoot: string): Promise<TaskRecord[]> {
  const dir = directory(projectRoot);
  const names = await readdir(dir).catch(() => []);
  const tasks: TaskRecord[] = [];
  for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).slice(0, 200)) {
    try {
      const value: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (isRecord(value) && value.projectRoot === resolve(projectRoot) && name === value.id + '.json') tasks.push(value);
    } catch { /* Unreadable or stale record: ignore rather than infer an association. */ }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


/**
 * Link manually requested Handoff/Verify to the ONE exact Worktree launch.
 * Shared workspaces and ambiguous/reused paths are not attached speculatively.
 * This is an explicit result snapshot, not a separate task-state machine.
 */
export async function attachTaskEvidence(
  projectRoot: string,
  worktreePath: string,
  branch: string,
  evidence: TaskEvidence,
): Promise<'saved' | 'unmatched'> {
  const root = resolve(projectRoot);
  const path = resolve(worktreePath);
  const matches = (await listTasks(root)).filter(task =>
    task.workspace === 'worktree' && task.branch === branch
    && task.worktreePath && resolve(task.worktreePath) === path);
  if (matches.length !== 1) return 'unmatched';

  const target = matches[0]!;
  const file = join(directory(root), target.id + '.json');
  // Recheck identity immediately before the atomic replacement.
  const prior: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isRecord(prior) || prior.id !== target.id || prior.branch !== branch
    || !prior.worktreePath || resolve(prior.worktreePath) !== path) return 'unmatched';
  const next = { ...prior, ...evidence };
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return 'saved';
}


/**
 * Observe only this Pi process, whose Pi session file and tmux window match.
 * No polling or inferred links from the title, branch or last-used session.
 */
export async function bindAgentSession(
  projectRoot: string, location: TmuxLocation, cwd: string, piSessionId: string,
  piSessionFile: string,
): Promise<'saved' | 'already' | 'unmatched'> {
  if (!piSessionId || !piSessionFile || !piSessionFile.startsWith('/')) return 'unmatched';
  const root = resolve(projectRoot);
  const candidates = (await listTasks(root)).filter(record =>
    record.targetLocation?.session === location.session
    && record.targetLocation.windowId === location.windowId);
  if (candidates.length !== 1) return 'unmatched';
  const task = candidates[0]!;
  const expected = task.workspace === 'worktree' ? task.worktreePath
    : task.launchCwd || task.projectRoot;
  if (!expected || resolve(expected) !== resolve(cwd)) return 'unmatched';
  if (task.agentSessionId || task.agentSessionFile) {
    return task.agentSessionId === piSessionId
      && task.agentSessionFile === resolve(piSessionFile) ? 'already' : 'unmatched';
  }

  // Check the actual Pi JSONL header, not a model statement about identity.
  const source = await loadSourceSession(piSessionFile).catch(() => null);
  if (!source || source.id !== piSessionId || resolve(source.cwd) !== resolve(cwd)) return 'unmatched';

  const file = join(directory(root), task.id + '.json');
  const prior: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isRecord(prior) || prior.id !== task.id
    || prior.targetLocation?.session !== location.session
    || prior.targetLocation.windowId !== location.windowId
    || prior.agentSessionId || prior.agentSessionFile) return 'unmatched';

  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify({
      ...prior, agentSessionId: piSessionId, agentSessionFile: resolve(piSessionFile),
    }), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return 'saved';
}

/** Shared checkout: link the developer's report to a verified Pi session ID,
 * never claim that shared Git changes belong exclusively to that agent.
 */
export async function attachSessionEvidence(
  projectRoot: string, piSessionId: string, evidence: TaskEvidence,
): Promise<'saved' | 'unmatched'> {
  const root = resolve(projectRoot);
  const candidates = (await listTasks(root)).filter(task => task.agentSessionId === piSessionId);
  if (candidates.length !== 1 || !candidates[0]!.agentSessionFile) return 'unmatched';
  const task = candidates[0]!;
  const file = join(directory(root), task.id + '.json');
  const prior: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isRecord(prior) || prior.id !== task.id
    || prior.agentSessionId !== piSessionId || !prior.agentSessionFile) return 'unmatched';
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify({ ...prior, ...evidence }), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return 'saved';
}
