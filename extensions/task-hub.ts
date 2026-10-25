import { basename, resolve } from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { LaunchPlan } from '../src/launch.ts';
import { listTasks, recordTask, type TaskRecord, type TaskLink, type TmuxLocation } from '../src/task-index.ts';
import { focusSharedTaskTab, ghosttyEnabled } from '../src/ghostty.ts';
import { workmuxRows, returnToTmux, showWorkPicker, type OpenWorktree } from './work-return.ts';

type HubRow = {
  kind: 'current' | 'main' | 'task' | 'history' | 'new';
  label: string;
  record?: TaskRecord;
  target?: TmuxLocation;
  available?: boolean;
};
const same = (a: string, b: string) => resolve(a) === resolve(b);
const equalLocation = (a: TmuxLocation | undefined, b: TmuxLocation | undefined) =>
  Boolean(a && b && a.session === b.session && a.windowId === b.windowId);

type Snapshot = {
  rows: TmuxLocation[];
  current?: TmuxLocation;
};

async function tmuxSnapshot(pi: ExtensionAPI, cwd: string): Promise<Snapshot> {
  try {
    const [all, active] = await Promise.all([
      pi.exec('tmux', ['list-windows', '-a', '-F', '#{session_name}\t#{window_id}\t#{window_name}'], { cwd }),
      process.env.TMUX
        ? pi.exec('tmux', ['display-message', '-p',
          ...(process.env.TMUX_PANE ? ['-t', process.env.TMUX_PANE] : []),
          '#{session_name}\t#{window_id}\t#{window_name}'], { cwd })
        : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
    ]);
    const parse = (line: string): TmuxLocation | undefined => {
      const [session, windowId, ...rest] = line.split('\t');
      return session && /^@[0-9]+$/.test(windowId || '') && rest.length
        ? { session, windowId: windowId!, windowName: rest.join('\t') } : undefined;
    };
    return {
      rows: all.code === 0 ? all.stdout.split('\n').flatMap(s => { const row = parse(s); return row ? [row] : []; }) : [],
      current: active.code === 0 ? parse(active.stdout.trim()) : undefined,
    };
  } catch {
    return { rows: [] };
  }
}

/** Stable main checkout detection also works from a worktree when workmux is unavailable. */
export async function projectRoot(pi: ExtensionAPI, cwd: string, worktrees: OpenWorktree[]): Promise<string> {
  const matches = worktrees.filter(w => same(w.path, cwd) && w.project_path);
  if (matches.length === 1) return resolve(matches[0]!.project_path!);
  try {
    const git = await pi.exec('git', ['worktree', 'list', '--porcelain'], { cwd });
    if (git.code === 0) {
      const first = git.stdout.split('\n').find(line => line.startsWith('worktree '));
      if (first) return resolve(first.slice('worktree '.length));
    }
  } catch { /* Not all shared tasks are Git repositories. */ }
  return resolve(cwd);
}

function exactWorktree(record: TaskRecord, worktrees: OpenWorktree[]): OpenWorktree | undefined {
  if (!record.worktreePath || !record.workmuxHandle) return undefined;
  const matched = worktrees.filter(w => w.handle === record.workmuxHandle
    && w.branch === record.branch && same(w.path, record.worktreePath!)
    && w.project_path && same(w.project_path, record.projectRoot));
  return matched.length === 1 ? matched[0] : undefined;
}

export function taskHubRows(
  records: TaskRecord[], worktrees: OpenWorktree[], live: TmuxLocation[], current?: TmuxLocation,
): HubRow[] {
  const isLive = (location: TmuxLocation | undefined) =>
    Boolean(location && live.some(x => equalLocation(x, location)));
  const currentTask = records.find(record => equalLocation(record.targetLocation, current));
  const rows: HubRow[] = [];
  if (currentTask) {
    const main = currentTask.mainLocation;
    if (main && isLive(main) && !equalLocation(current, main)) {
      rows.push({ kind: 'main', label: '← Main으로 돌아가기', target: main });
    }
  }

  // The current location is always recognizable, even when the current process
  // doesn't carry a task record (for example on the original Main).
  rows.push({
    kind: 'current',
    label: '현재 화면 · ' + (currentTask ? currentTask.title : 'Pi 대화')
      + (current ? ' · 연결됨' : ' · 위치 확인 불가'),
  });

  // Live work first; closed and unverified entries after it. Bounded to avoid
  // turning the Hub into a second raw session management console.
  const entries = records.map(record => {
    const worktree = record.workspace === 'worktree' ? exactWorktree(record, worktrees) : undefined;
    const available = isLive(record.targetLocation) && (record.workspace === 'shared' || Boolean(worktree?.is_open));
    const location = equalLocation(record.targetLocation, current) ? ' · 현재 작업' : '';
    const status = available ? '대상 열림 · AI 상태 미확인'
      : record.targetLocation ? '대상 종료 또는 확인 불가' : '연결 정보 없음 · 이전 작업 탐색';
    return { kind: 'task' as const, record, available, label: record.title
      + location + ' · ' + (record.workspace === 'shared' ? '같은 폴더' : '별도 작업 공간') + ' · ' + status };
  }).sort((a, b) => Number(b.available) - Number(a.available));
  rows.push(...entries.slice(0, 15));
  rows.push({ kind: 'history', label: '다른 대화·이전 작업 찾기 (고급)' });
  return rows;
}

/**
 * Record a link only after workmux/tmux reports the precise target created by
 * this launch. We never treat an agent name or matching branch as identity.
 */
export async function trackLaunchedTask(pi: ExtensionAPI, plan: LaunchPlan): Promise<string | undefined> {
  try {
    const [snapshot, mux] = await Promise.all([tmuxSnapshot(pi, plan.cwd), workmuxRows(pi, plan.cwd)]);
    const root = await projectRoot(pi, plan.cwd, mux.rows);
    const known = await listTasks(root);
    const current = snapshot.current;
    const origin = current && known.find(t => equalLocation(t.targetLocation, current));
    const main = process.env.PIC_COMPOSE_MAIN === '1' ? current : origin?.mainLocation;
    const link: TaskLink = { projectRoot: root };
    if (main) link.mainLocation = main;

    if (plan.workspace === 'shared' && plan.tmuxTarget) {
      const targets = snapshot.rows.filter(row => row.session === plan.tmuxTarget);
      if (targets.length === 1) link.targetLocation = targets[0];
    } else if (plan.workspace === 'worktree' && plan.branch && plan.workmuxTargetName) {
      const worktrees = mux.rows.filter(w => w.branch === plan.branch && w.project_path
        && same(w.project_path, root) && w.is_open);
      const windows = snapshot.rows.filter(row => row.windowName.includes(plan.workmuxTargetName!));
      if (worktrees.length === 1 && windows.length === 1) {
        link.worktreePath = worktrees[0]!.path;
        link.workmuxHandle = worktrees[0]!.handle;
        link.targetLocation = windows[0];
      }
    }

    await recordTask(plan, link);
    if (!link.targetLocation) return 'Agent launch succeeded, but the exact running target was not verified. '
      + 'The work is listed as unverified; use the advanced work picker to inspect it.';
    return undefined;
  } catch (error) {
    return 'Agent launch succeeded but the work link could not be saved: ' + String(error)
      + '. Existing tmux and Git resources were not changed.';
  }
}

export async function refreshTaskIndicator(ctx: ExtensionContext, root = ctx.cwd): Promise<void> {
  if (!ctx.hasUI) return;
  // A count without refreshing other processes can be misleading. Keep the
  // stable navigation affordance and compute real availability only in the Hub.
  ctx.ui.setStatus('compose-tasks', '작업 보기 · Alt+W');
  ctx.ui.setWidget('compose-hint', [
    'Pi Compose · Alt+W 작업 보기 · 새 Agent는 자연어로도 요청할 수 있습니다',
  ], { placement: 'belowEditor' });
}

/** Same Hub in Main and child Pi (when the navigation-only package is enabled). */
export async function showTaskHub(
  pi: ExtensionAPI, ctx: ExtensionContext, onLaunch?: () => Promise<void>,
): Promise<void> {
  if (!ctx.hasUI) return;
  const [mux, snapshot] = await Promise.all([workmuxRows(pi, ctx.cwd), tmuxSnapshot(pi, ctx.cwd)]);
  const root = await projectRoot(pi, ctx.cwd, mux.rows);
  const records = await listTasks(root);
  const rows: HubRow[] = [
    ...(onLaunch ? [{ kind: 'new' as const, label: '+ 새 에이전트에게 맡기기' }] : []),
    ...taskHubRows(records, mux.rows, snapshot.rows, snapshot.current),
  ];
  const choices = rows.map((row, index) => (index + 1) + '. ' + row.label);
  const selected = await ctx.ui.select('작업 · ' + basename(root), choices);
  if (!selected) return;
  const selectedRow = rows[choices.indexOf(selected)];
  if (!selectedRow) return;
  if (selectedRow.kind === 'new') {
    if (onLaunch) await onLaunch();
    return;
  }
  if (selectedRow.kind === 'current') return;
  if (selectedRow.kind === 'history') {
    if ('switchSession' in ctx && typeof ctx.switchSession === 'function') {
      await showWorkPicker(pi, ctx as ExtensionCommandContext);
    } else {
      ctx.ui.notify('이전 대화 전환은 Main의 /compose back 또는 Pi의 /resume을 이용해 주세요.', 'info');
    }
    return;
  }
  const location = selectedRow.target || selectedRow.record?.targetLocation;
  if (!location || !snapshot.rows.some(row => equalLocation(row, location))) {
    ctx.ui.notify('정확한 실행 대상이 확인되지 않습니다. 새 Pi를 실행하지 않습니다.', 'warning');
    return;
  }
  if (selectedRow.record?.workspace === 'worktree'
    && !exactWorktree(selectedRow.record, mux.rows)?.is_open) {
    ctx.ui.notify('Worktree 실행 대상이 닫혔거나 연결 정보가 바뀌었습니다. 새로 시작하지 않습니다.', 'warning');
    return;
  }
  const record = selectedRow.record;
  if (record && selectedRow.available && ghosttyEnabled()
    && (record.workspace === 'shared' || exactWorktree(record, mux.rows)?.mode === 'session')) {
    const opened = await focusSharedTaskTab(pi, record.title, record.id, location.session, root);
    if (opened.ok) return;
    ctx.ui.notify('Ghostty 탐색 실패. 기존 tmux 이동으로 전환: ' + opened.message, 'warning');
  }
  await returnToTmux(pi, ctx, {
    name: location.session, cwd: root, windowId: location.windowId,
  });
}

export function registerTaskHub(pi: ExtensionAPI, openHub: (ctx: ExtensionContext) => Promise<void>): void {
  pi.registerShortcut?.('alt+w', {
    description: 'Pi Compose: 작업 보기 / Main 복귀',
    handler: openHub,
  });
  pi.on?.('session_start', async (_event, ctx) => {
    await refreshTaskIndicator(ctx);
  });
}
