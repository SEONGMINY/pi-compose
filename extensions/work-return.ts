import { Type } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { planResume, executeResume } from '../src/resume.ts';

type OpenWorktree = {
  handle: string;
  branch: string;
  path: string;
  is_open: boolean;
};
type Discovered = {
  sessions: Awaited<ReturnType<typeof SessionManager.list>>;
  worktrees: OpenWorktree[];
  workmuxWarning?: string;
};

async function workmuxRows(pi: ExtensionAPI, cwd: string): Promise<{ rows: OpenWorktree[]; warning?: string }> {
  let output: string;
  try {
    const result = await pi.exec('workmux', ['list', '--json'], { cwd });
    if (result.code !== 0) return { rows: [], warning: 'workmux list unavailable: ' + (result.stderr || 'exit ' + result.code) };
    output = result.stdout;
  } catch (error) {
    return { rows: [], warning: 'workmux could not be inspected: ' + String(error) };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch {
    return { rows: [], warning: 'workmux list returned unrecognized JSON. No workmux actions are available.' };
  }
  if (!Array.isArray(parsed)) return { rows: [], warning: 'workmux list returned an unexpected format.' };
  const rows = parsed.filter((row): row is OpenWorktree => {
    return row !== null && typeof row === 'object'
      && typeof row.handle === 'string' && row.handle.length > 0
      && typeof row.branch === 'string' && typeof row.path === 'string'
      && typeof row.is_open === 'boolean';
  });
  if (rows.length !== parsed.length) return { rows: [], warning: 'Some workmux results were not recognized; refusing to choose a target.' };
  return { rows };
}

/** Small, bounded read-only lookup. Pi and workmux retain ownership of all saved state. */
async function discover(pi: ExtensionAPI, ctx: ExtensionContext): Promise<Discovered> {
  const [sessions, workmux] = await Promise.all([
    SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir()),
    workmuxRows(pi, ctx.cwd),
  ]);
  return {
    sessions: sessions.filter(s => s.path !== ctx.sessionManager.getSessionFile()).slice(0, 40),
    worktrees: workmux.rows.slice(0, 40),
    workmuxWarning: workmux.warning,
  };
}

function label(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 65);
}
function matches(text: string, query: string): boolean {
  return !query || text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/** Entry points to the SAME read-only discovery: slash UI and model tool. */
export function registerWorkReturn(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'compose_find_work',
    label: 'Find existing development work',
    description: 'Read-only: discover saved Pi conversations and workmux worktrees for THIS project. Use only when the user asks to find/return to/check previous work. Does NOT switch sessions or start a process. Keep results concise; use /compose back for direct selection.',
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Keywords for work name, saved Pi session, branch or worktree handle' })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const found = await discover(pi, ctx);
      const query = params.query?.trim() || '';
      const sessions = found.sessions.filter(s => matches([s.name, s.firstMessage].join(' '), query)).slice(0, 8);
      const worktrees = found.worktrees.filter(w => matches(w.branch + ' ' + w.handle, query)).slice(0, 8);
      return {
        content: [{ type: 'text' as const, text: [
          'Existing work in this project (read-only; not proof a Pi process is running):',
          ...sessions.map(s => '- Saved Pi session: ' + label(s.name || s.firstMessage || '(unnamed)') + ' [id=' + s.id.slice(0, 8) + ']'),
          ...worktrees.map(w => '- workmux: ' + label(w.branch) + ' [handle=' + w.handle + ', target ' + (w.is_open ? 'open' : 'closed') + ']'),
          ...(!sessions.length && !worktrees.length ? ['No matching entries in the available sources.'] : []),
          ...(found.workmuxWarning ? ['LIMIT: ' + found.workmuxWarning] : []),
          'This is a limited lookup for the current project. It does not inspect other project histories or prove a specific Pi session is live.',
          'For no-model direct selection use /compose back. Never start or resume anything solely from these results.',
        ].join('\n') }],
        details: { status: 'read_only', sessionMatches: sessions.length, worktreeMatches: worktrees.length },
      };
    },
  });
}

/**
 * Worktree sessions are indexed by Pi under each worktree's own cwd.
 * Read only after the user selected a closed worktree. Never choose "most recent"
 * automatically or scan every project transcript into the Main agent.
 */
async function resumeClosedWorktree(pi: ExtensionAPI, ctx: ExtensionCommandContext, worktree: OpenWorktree): Promise<void> {
  let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
  try {
    const canonicalPath = await realpath(worktree.path);
    sessions = (await SessionManager.list(canonicalPath))
      .filter(session => session.cwd === canonicalPath && session.path !== ctx.sessionManager.getSessionFile())
      .slice(0, 30);
  } catch (error) {
    ctx.ui.notify('Could not inspect saved Pi conversations in this Worktree: ' + String(error), 'error');
    return;
  }
  if (!sessions.length) {
    ctx.ui.notify(
      'No saved Pi conversation found for this Worktree in the default Pi session directory. Nothing started. '
      + 'If the session uses a custom directory, select its exact JSONL file with /compose resume.',
      'warning',
    );
    return;
  }
  const labels = sessions.map((session, index) =>
    (index + 1) + '. ' + label(session.name || session.firstMessage || '(unnamed)')
      + ' [' + session.id.slice(0, 8) + ']');
  const chosen = await ctx.ui.select('Choose saved Pi conversation in ' + worktree.branch, labels);
  if (!chosen) return;
  const selected = sessions[labels.indexOf(chosen)];
  if (!selected) return;

  try {
    // The original Git branch and exact session cwd must still belong together.
    const plan = await planResume({
      workspace: 'worktree', cwd: ctx.cwd, branch: worktree.branch, sessionFile: selected.path,
    });
    if (plan.cwd !== await realpath(worktree.path)) {
      ctx.ui.notify('Worktree location no longer matches the selected target. No Pi process started.', 'warning');
      return;
    }
    if (plan.status === 'target-occupied') {
      ctx.ui.notify('The exact resume tmux target is already occupied (' + plan.tmuxTarget
        + '). Do not create a second process; inspect that target first.', 'warning');
      return;
    }
    const approved = await ctx.ui.confirm('Resume selected Pi conversation?', [
      'Session: ' + label(selected.name || selected.firstMessage || selected.id),
      'Worktree: ' + worktree.branch,
      'Directory: ' + plan.cwd,
      'This STARTS a new Pi process for the exact saved conversation in tmux.',
      'workmux reports its own window closed, but other tmux targets or Pi processes cannot be ruled out.',
      'Existing code and Git changes will not be deleted.',
    ].join('\n'));
    if (approved !== true) return;

    // A workmux target appearing during selection must stop the new launch.
    const before = await workmuxRows(pi, ctx.cwd);
    const same = before.rows.find(row => row.handle === worktree.handle
      && row.path === worktree.path && row.branch === worktree.branch);
    if (before.warning || !same || same.is_open) {
      ctx.ui.notify('Workmux target is no longer confirmed closed. Nothing started; refresh the work list.', 'warning');
      return;
    }
    const result = await executeResume(plan);
    ctx.ui.notify('Resume: ' + result.status + ' · tmux ' + result.tmuxTarget
      + '. The actual Pi model conversation is not verified.', 'info');
    for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
  } catch (error) {
    ctx.ui.notify('Could not resume selected Pi conversation: '
      + (error instanceof Error ? error.message : String(error)), 'error');
  }
}

/** User-driven session switch or workmux navigation, without calling a model. */
export async function showWorkPicker(pi: ExtensionAPI, ctx: ExtensionCommandContext, query = ''): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('Interactive selection is required. Pi also provides /resume for saved conversations.', 'warning');
    return;
  }
  let found: Discovered;
  try { found = await discover(pi, ctx); }
  catch (error) {
    ctx.ui.notify('Could not list saved Pi sessions: ' + String(error), 'error');
    return;
  }
  const items = [
    ...found.sessions.filter(s => matches([s.name, s.firstMessage].join(' '), query))
      .map(s => ({ kind: 'session' as const, name: 'Saved · ' + label(s.name || s.firstMessage || '(unnamed)') + ' [' + s.id.slice(0, 8) + ']', session: s })),
    ...found.worktrees.filter(w => matches(w.branch + ' ' + w.handle, query))
      .map(w => ({ kind: 'worktree' as const, name: 'Worktree · ' + label(w.branch) + ' (' + (w.is_open ? 'target open' : 'target closed') + ') [' + w.handle + ']', worktree: w })),
  ].slice(0, 40);
  const pickerLabels = items.map((item, index) => (index + 1) + '. ' + item.name);
  if (!items.length) {
    ctx.ui.notify('No matching work in current-project Pi sessions or workmux.' + (found.workmuxWarning ? ' ' + found.workmuxWarning : ''), 'info');
    return;
  }
  const selected = await ctx.ui.select('Return to previous work', pickerLabels);
  if (!selected) return;
  const item = items[pickerLabels.indexOf(selected)];
  if (!item) return;
  if (item.kind === 'session') {
    // Pi owns the session switch; never start a duplicate tmux/Pi process for this case.
    const switched = await ctx.switchSession(item.session.path);
    if (switched.cancelled) ctx.ui.notify('Pi session switch cancelled.', 'info');
    return;
  }
  const worktree = item.worktree;
  if (!worktree.is_open) {
    await resumeClosedWorktree(pi, ctx, worktree);
    return;
  }
  // workmux open is a navigation command, but may create a target if it disappears
  // between inspection and the call. Do not do it silently.
  const approved = await ctx.ui.confirm('Open workmux target?', [
    'Branch: ' + worktree.branch,
    'Handle: ' + worktree.handle,
    'workmux reports this target open, but this does NOT prove which Pi conversation is running.',
    'If it closes during this operation, workmux open may create a replacement window.',
  ].join('\n'));
  if (approved !== true) return;
  const current = await workmuxRows(pi, ctx.cwd);
  const stillOpen = current.rows.some(row =>
    row.handle === worktree.handle && row.path === worktree.path && row.is_open);
  if (!stillOpen) {
    ctx.ui.notify('Target is no longer confirmed open; nothing was opened. Re-check the work list.', 'warning');
    return;
  }
  try {
    const result = await pi.exec('workmux', ['open', worktree.handle], { cwd: ctx.cwd });
    if (result.code !== 0) throw new Error(result.stderr || 'exit ' + result.code);
    ctx.ui.notify('workmux open invoked for ' + worktree.handle + '. Actual Pi conversation identity is unverified.', 'info');
  } catch (error) {
    ctx.ui.notify('Could not open workmux target: ' + String(error), 'error');
  }
}
