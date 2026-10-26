import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LaunchPlan } from './launch.ts';

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

export type TaskRecord = {
  id: string;
  title: string;
  /** Exact original instruction, not a summary of the Forked session. */
  instruction?: string;
  projectRoot: string;
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
