import { basename, resolve } from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { LaunchPlan } from '../src/launch.ts';
import { listTasks, recordTask, type TaskRecord } from '../src/task-index.ts';
import { focusSharedTaskTab, ghosttyEnabled } from '../src/ghostty.ts';
import { workmuxRows, returnToWorktree, returnToTmux, showWorkPicker, type OpenWorktree } from './work-return.ts';

type HubRow = { label: string; kind: 'main' | 'task' | 'history'; target?: string; record?: TaskRecord; worktree?: OpenWorktree };
const same = (a: string, b: string) => resolve(a) === resolve(b);

/** Resolve a worktree to its parent project. Never associate by branch name alone. */
function projectRoot(cwd: string, worktrees: OpenWorktree[]): string {
  const matches = worktrees.filter(w => same(w.path, cwd) && w.project_path);
  return matches.length === 1 ? resolve(matches[0]!.project_path!) : resolve(cwd);
}

function connectedWorktree(record: TaskRecord, worktrees: OpenWorktree[]): OpenWorktree | undefined {
  const matches = worktrees.filter(w => w.branch === record.branch
    && w.project_path && same(w.project_path, record.projectRoot));
  // Ambiguous branch association is not safe: do not choose the first match.
  return matches.length === 1 ? matches[0] : undefined;
}

export function taskHubRows(
  records: TaskRecord[], worktrees: OpenWorktree[], liveSessions: string[], currentTmux = '',
): HubRow[] {
  const live = new Set(liveSessions);
  const rows: HubRow[] = [];
  const seenMains = new Set<string>();
  for (const record of records) {
    if (record.mainTmux && live.has(record.mainTmux) && !seenMains.has(record.mainTmux)
      && currentTmux !== record.mainTmux) {
      seenMains.add(record.mainTmux);
      rows.push({ kind: 'main', target: record.mainTmux, label: '← Main으로 돌아가기' });
    }
  }
  for (const record of records) {
    const w = record.workspace === 'worktree' ? connectedWorktree(record, worktrees) : undefined;
    const available = record.workspace === 'shared' ? Boolean(record.tmuxTarget && live.has(record.tmuxTarget)) : Boolean(w?.is_open);
    const reason = record.workspace === 'shared'
      ? '같은 폴더' : '별도 작업 공간';
    const status = available ? '연결 대상 열림 · 실제 진행 상태 미확인' : '연결 대상 닫힘';
    const label = record.title + ' · ' + reason + ' · ' + status;
    rows.push({ kind: 'task', label, record, ...(w ? { worktree: w } : {}) });
  }
  rows.push({ kind: 'history', label: '다른 저장 대화 / 이전 작업 찾기 (고급)' });
  return rows;
}

async function sessions(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  try {
    const result = await pi.exec('tmux', ['list-sessions', '-F', '#{session_name}'], { cwd });
    return result.code === 0 ? result.stdout.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

async function currentSession(pi: ExtensionAPI, cwd: string): Promise<string> {
  if (!process.env.TMUX) return '';
  try {
    const result = await pi.exec('tmux', ['display-message', '-p', '#{session_name}'], { cwd });
    return result.code === 0 ? result.stdout.trim() : '';
  } catch { return ''; }
}

export async function trackLaunchedTask(pi: ExtensionAPI, plan: LaunchPlan): Promise<string | undefined> {
  const main = await currentSession(pi, plan.cwd);
  try {
    await recordTask(plan, main);
    return undefined;
  } catch (error) {
    return 'Agent launched, but its task label could not be saved: ' + String(error)
      + '. It remains accessible through the existing sessions list.';
  }
}

export async function refreshTaskIndicator(ctx: ExtensionContext, root = ctx.cwd): Promise<void> {
  if (!ctx.hasUI) return;
  const tasks = await listTasks(root).catch(() => []);
  ctx.ui.setStatus?.('compose-tasks', '작업 ' + tasks.length + ' · Alt+W');
  ctx.ui.setWidget?.('compose-hint', [
    'Pi Compose · Alt+W 작업 보기 · /compose launch 새 에이전트',
  ], { placement: 'belowEditor' });
}

/** Main UX: human-named work, not a flat list of Pi sessions, tmux sessions and Git worktrees. */
export async function showTaskHub(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  const mux = await workmuxRows(pi, ctx.cwd);
  const root = projectRoot(ctx.cwd, mux.rows);
  const [records, live, current] = await Promise.all([
    listTasks(root), sessions(pi, ctx.cwd), currentSession(pi, ctx.cwd),
  ]);
  const rows = taskHubRows(records, mux.rows, live, current);
  const choices = rows.map((r, index) => (index + 1) + '. ' + r.label);
  const selected = await ctx.ui.select('작업 · ' + basename(root) + ' (상태는 실행 대상 기준)', choices);
  if (!selected) return;
  const item = rows[choices.indexOf(selected)];
  if (!item) return;
  if (item.kind === 'history') {
    if ('switchSession' in ctx && typeof ctx.switchSession === 'function') {
      await showWorkPicker(pi, ctx as ExtensionCommandContext);
    } else {
      ctx.ui.notify('이전 Pi 대화 전환은 /compose work 명령으로 열어주세요.', 'info');
    }
    return;
  }
  if (item.kind === 'main') {
    if (item.target) await returnToTmux(pi, ctx, { name: item.target, cwd: root });
    return;
  }
  const record = item.record;
  if (!record) return;
  if (record.workspace === 'worktree') {
    if (!item.worktree) {
      ctx.ui.notify('해당 작업에 연결된 Worktree를 확인할 수 없습니다. 다른 저장 대화에서 찾아보세요.', 'warning');
      return;
    }
    await returnToWorktree(pi, ctx, item.worktree);
    return;
  }
  if (!record.tmuxTarget || !live.includes(record.tmuxTarget)) {
    ctx.ui.notify('이 작업의 실행 세션은 닫혔습니다. 다른 저장 대화에서 다시 선택할 수 있습니다.', 'warning');
    return;
  }
  if (ghosttyEnabled()) {
    const opened = await focusSharedTaskTab(pi, record.title, record.id, record.tmuxTarget, root);
    if (opened.ok) return;
    ctx.ui.notify('Ghostty 탭을 열지 못했습니다: ' + opened.message + '. 기본 tmux 전환으로 시도합니다.', 'warning');
  }
  await returnToTmux(pi, ctx, { name: record.tmuxTarget, cwd: root });
}

export function registerTaskHub(pi: ExtensionAPI): void {
  pi.registerShortcut?.('alt+w', {
    description: 'Pi Compose: 작업 보기 / Main 복귀',
    handler: async ctx => { await showTaskHub(pi, ctx); },
  });
  pi.on?.('session_start', async (_event, ctx) => {
    await refreshTaskIndicator(ctx);
  });
}
