import { Type } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { planResume, executeResume } from '../src/resume.ts';
import { fileURLToPath } from 'node:url';

const baseExtension = fileURLToPath(new URL('./compose.ts', import.meta.url));

export type OpenWorktree = {
  handle: string;
  branch: string;
  path: string;
  is_open: boolean;
  project_path?: string;
  mode?: string;
};
export type LiveTmuxTarget = { name: string; cwd: string; windowId?: string };
type Discovered = {
  sessions: Awaited<ReturnType<typeof SessionManager.list>>;
  worktrees: OpenWorktree[];
  tmuxTargets: LiveTmuxTarget[];
  workmuxWarning?: string;
  tmuxWarning?: string;
};

export async function workmuxRows(pi: ExtensionAPI, cwd: string): Promise<{ rows: OpenWorktree[]; warning?: string }> {
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
      && typeof row.is_open === 'boolean'
      && (row.project_path === undefined || typeof row.project_path === 'string');
  });
  if (rows.length !== parsed.length) return { rows: [], warning: 'Some workmux results were not recognized; refusing to choose a target.' };
  return { rows };
}

// Only discover sessions created by Pi Compose (pc-* or pic-*). A tmux target
// being present never proves that an agent is running, waiting or finished.
async function tmuxRows(
  pi: ExtensionAPI, cwd: string, worktrees: OpenWorktree[],
): Promise<{ rows: LiveTmuxTarget[]; warning?: string }> {
  let result: Awaited<ReturnType<ExtensionAPI['exec']>>;
  try {
    result = await pi.exec('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}'], { cwd });
  } catch (error) {
    return { rows: [], warning: 'tmux targets unavailable: ' + String(error) };
  }
  if (result.code !== 0) {
    return { rows: [], warning: 'tmux targets unavailable: ' + (result.stderr || 'no tmux server') };
  }

  const paths = new Set(
    [cwd, ...worktrees.flatMap(w => [w.path, ...(w.project_path ? [w.project_path] : [])])].map(p => resolve(p)),
  );
  const targets = new Map<string, LiveTmuxTarget>();
  for (const line of result.stdout.split('\n')) {
    const [name, paneCwd] = line.split('\t');
    if (!name || !paneCwd) continue;
    if (!/^pc-[a-z0-9-]+-[0-9a-f]{8}$/.test(name) && !/^pic-[0-9a-f]{12}$/.test(name)) continue;
    if (!paths.has(resolve(paneCwd))) continue;
    targets.set(name, { name, cwd: paneCwd });
  }
  return { rows: Array.from(targets.values()).slice(0, 40) };
}

/** Small, bounded read-only lookup. Pi, workmux and tmux own their state. */
async function discover(pi: ExtensionAPI, ctx: ExtensionContext): Promise<Discovered> {
  const [sessions, workmux] = await Promise.all([
    SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir()),
    workmuxRows(pi, ctx.cwd),
  ]);
  const tmux = await tmuxRows(pi, ctx.cwd, workmux.rows);
  return {
    sessions: sessions.filter(s => s.path !== ctx.sessionManager.getSessionFile()).slice(0, 40),
    worktrees: workmux.rows.slice(0, 40),
    tmuxTargets: tmux.rows,
    workmuxWarning: workmux.warning,
    tmuxWarning: tmux.warning,
  };
}

function label(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 65);
}
function matches(text: string, query: string): boolean {
  return !query || text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

type WorkItem =
  | { kind: 'session'; name: string; session: Discovered['sessions'][number] }
  | { kind: 'worktree'; name: string; worktree: OpenWorktree }
  | { kind: 'tmux'; name: string; target: LiveTmuxTarget };

function workItems(found: Discovered, query: string): WorkItem[] {
  return [
    ...found.tmuxTargets.filter(t => matches(t.name, query))
      .map(t => ({ kind: 'tmux' as const,
        name: 'Running target · ' + (t.name.startsWith('pic-') ? 'Pi Compose entry' : t.name.slice(3).replace(/-[0-9a-f]{8}$/, ''))
          + ' [tmux ' + t.name + '; agent status unknown]', target: t })),
    ...found.sessions.filter(s => matches([s.name, s.firstMessage, s.id].join(' '), query))
      .map(s => ({ kind: 'session' as const, name: 'Saved · ' + label(s.name || s.firstMessage || '(unnamed)') + ' [' + s.id.slice(0, 8) + ']', session: s })),
    ...found.worktrees.filter(w => matches(w.branch + ' ' + w.handle, query))
      .map(w => ({ kind: 'worktree' as const, name: 'Worktree · ' + label(w.branch) + ' (' + (w.is_open ? 'target open' : 'target closed') + ') [' + w.handle + ']', worktree: w })),
  ].slice(0, 40);
}

/** A single Pi-native picker reused by direct commands and explicit natural-language requests. */
async function chooseWork(ctx: ExtensionContext, found: Discovered, query: string): Promise<WorkItem | undefined> {
  const items = workItems(found, query);
  const choices = items.map((item, index) => (index + 1) + '. ' + item.name);
  if (!choices.length) {
    ctx.ui.notify('No matching work in current-project Pi sessions or workmux.'
      + (found.workmuxWarning ? ' ' + found.workmuxWarning : '')
      + (found.tmuxWarning ? ' ' + found.tmuxWarning : ''), 'info');
    return undefined;
  }
  const selected = await ctx.ui.select('Return to previous work', choices);
  return selected ? items[choices.indexOf(selected)] : undefined;
}

/** Entry points to the SAME read-only discovery: slash UI and model tool. */
export function registerWorkReturn(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'compose_find_work',
    label: 'Find existing development work',
    description: 'Read-only: list saved Pi conversations and workmux worktrees for THIS project. Use when the user asks to SEARCH or CHECK existing work without moving. If the user explicitly asks to RETURN or GO BACK, use compose_return_work instead. Does NOT switch sessions or start a process. Keep results concise.',
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Keywords for work name, saved Pi session, branch or worktree handle' })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const found = await discover(pi, ctx);
      const query = params.query?.trim() || '';
      const sessions = found.sessions.filter(s => matches([s.name, s.firstMessage].join(' '), query)).slice(0, 8);
      const worktrees = found.worktrees.filter(w => matches(w.branch + ' ' + w.handle, query)).slice(0, 8);
      const live = found.tmuxTargets.filter(t => matches(t.name, query)).slice(0, 8);
      return {
        content: [{ type: 'text' as const, text: [
          'Existing work in this project (read-only; not proof a Pi process is running):',
          ...live.map(t => '- tmux target: ' + t.name + ' [target exists; Pi activity not verified]'),
          ...sessions.map(s => '- Saved Pi session: ' + label(s.name || s.firstMessage || '(unnamed)') + ' [id=' + s.id.slice(0, 8) + ']'),
          ...worktrees.map(w => '- workmux: ' + label(w.branch) + ' [handle=' + w.handle + ', target ' + (w.is_open ? 'open' : 'closed') + ']'),
          ...(!live.length && !sessions.length && !worktrees.length ? ['No matching entries in the available sources.'] : []),
          ...(found.workmuxWarning ? ['LIMIT: ' + found.workmuxWarning] : []),
          ...(found.tmuxWarning ? ['LIMIT: ' + found.tmuxWarning] : []),
          'This is a limited lookup for the current project. It does not inspect other project histories or prove a specific Pi session is live.',
          'For no-model direct selection use /compose back. Never start or resume anything solely from these results.',
        ].join('\n') }],
        details: { status: 'read_only', sessionMatches: sessions.length, worktreeMatches: worktrees.length, tmuxMatches: live.length },
      };
    },
  });
  pi.registerTool({
    name: 'compose_return_work',
    label: 'Choose previous work',
    description: 'Only when the USER explicitly asks to return to existing work. Present the native Pi selection UI. Saved Pi conversations require the user to submit a prepared exact Slash Command; this model Tool CANNOT switch Pi sessions. Workmux navigation and closed Worktree resume require the same explicit approval as /compose back. Never auto-create an agent, guess a recent session, or overwrite a user draft.',
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Optional work-name keywords, not a session path' })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return { content: [{ type: 'text' as const, text: 'Nothing changed: interactive selection is unavailable. Use /compose back.' }],
          details: { status: 'not_executed_no_ui' } };
      }
      const found = await discover(pi, ctx);
      const chosen = await chooseWork(ctx, found, params.query?.trim() || '');
      if (!chosen) {
        return { content: [{ type: 'text' as const, text: 'No previous work was selected; nothing changed.' }],
          details: { status: 'cancelled' } };
      }
      if (chosen.kind === 'tmux') {
      await returnToTmux(pi, ctx, chosen.target);
      return { content: [{ type: 'text' as const,
        text: 'Navigation to the selected tmux target was requested. Pi agent activity was not verified.' }],
        details: { status: 'tmux_switch_attempted_unverified' } };
    }
    if (chosen.kind === 'session') {
        const command = '/compose back id:' + chosen.session.id;
        // The model tool has no ctx.switchSession(): only a user-initiated Pi command
        // can switch the conversation. Never replace an unsent draft in the editor.
        if (ctx.ui.getEditorText().trim()) {
          return { content: [{ type: 'text' as const,
            text: 'Selected ' + label(chosen.session.name || chosen.session.firstMessage) +
              '. User editor is not empty; do not overwrite it. Ask user to enter: ' + command }],
            details: { status: 'exact_command_required_draft_preserved' } };
        }
        ctx.ui.setEditorText(command);
        return { content: [{ type: 'text' as const,
          text: 'Selected saved Pi conversation. Exact command is READY IN THE EDITOR: ' + command +
            '. Ask the user to press Enter to switch using the Pi native Slash Command. No session was switched.' }],
          details: { status: 'exact_command_prepared_not_executed' } };
      }
      await returnToWorktree(pi, ctx, chosen.worktree);
      return { content: [{ type: 'text' as const,
        text: 'Requested the same workmux return flow as /compose back. Its confirmation and status notifications are shown in Pi. Do not claim Pi session identity or agent readiness was verified.' }],
        details: { status: 'workmux_return_attempted_unverified' } };
    },
  });
}

/**
 * Worktree sessions are indexed by Pi under each worktree's own cwd.
 * Read only after the user selected a closed worktree. Never choose "most recent"
 * automatically or scan every project transcript into the Main agent.
 */
async function resumeClosedWorktree(pi: ExtensionAPI, ctx: ExtensionContext, worktree: OpenWorktree): Promise<void> {
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
      composeExtensionFile: baseExtension,
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
  // Exact ID form is prepared by the model Tool; only a user-submitted Slash Command
  // may switch Pi sessions. Never infer an ID from a short prefix.
  if (query.startsWith('id:')) {
    const id = query.slice(3);
    const exact = found.sessions.filter(session => session.id === id);
    if (exact.length !== 1) {
      ctx.ui.notify('Exact saved Pi session ID not found in this project. Nothing switched.', 'warning');
      return;
    }
    const switched = await ctx.switchSession(exact[0]!.path);
    if (switched.cancelled) ctx.ui.notify('Pi session switch cancelled.', 'info');
    return;
  }
  const item = await chooseWork(ctx, found, query);
  if (!item) return;
  if (item.kind === 'session') {
    // Pi owns the session switch; never start a duplicate tmux/Pi process for this case.
    const switched = await ctx.switchSession(item.session.path);
    if (switched.cancelled) ctx.ui.notify('Pi session switch cancelled.', 'info');
    return;
  }
  if (item.kind === 'tmux') {
    await returnToTmux(pi, ctx, item.target);
    return;
  }
  await returnToWorktree(pi, ctx, item.worktree);
}

// Selection itself authorizes navigation, not a fresh Pi process or a Git change.
export async function returnToTmux(pi: ExtensionAPI, ctx: ExtensionContext, target: LiveTmuxTarget): Promise<void> {
  if (!process.env.TMUX) {
    ctx.ui.notify('Pi is outside tmux. To connect to this target, run: tmux attach -t '
      + target.name, 'warning');
    return;
  }
  try {
    const existing = await pi.exec('tmux', ['has-session', '-t', '=' + target.name], { cwd: ctx.cwd });
    if (existing.code !== 0) {
      ctx.ui.notify('The selected tmux target no longer exists. Refresh the work list.', 'warning');
      return;
    }
    if (target.windowId) {
      // Main and workmux windows can share a single tmux session.
      // Validate the exact window ID before moving either the session or window.
      if (!/^@[0-9]+$/.test(target.windowId)) {
        ctx.ui.notify('Invalid tmux window ID. Nothing switched.', 'warning');
        return;
      }
      const windows = await pi.exec('tmux', ['list-windows', '-a', '-F', '#{session_name}\t#{window_id}'], { cwd: ctx.cwd });
      const belongs = windows.code === 0 && windows.stdout.split('\n').some(row =>
        row === target.name + '\t' + target.windowId);
      if (!belongs) {
        ctx.ui.notify('Selected tmux window no longer belongs to its recorded session. Nothing switched.', 'warning');
        return;
      }
    }
    const moved = await pi.exec('tmux', ['switch-client', '-t', '=' + target.name], { cwd: ctx.cwd });
    if (moved.code !== 0) throw new Error(moved.stderr || 'switch-client failed');
    if (target.windowId) {
      const window = await pi.exec('tmux', ['select-window', '-t', target.windowId], { cwd: ctx.cwd });
      if (window.code !== 0) throw new Error(window.stderr || 'select-window failed');
    }
  } catch (error) {
    ctx.ui.notify('Could not switch tmux target: ' + String(error), 'error');
  }
}

/** Move to an explicitly selected workmux target; no guessing about Pi session identity. */
export async function returnToWorktree(pi: ExtensionAPI, ctx: ExtensionContext, worktree: OpenWorktree): Promise<void> {
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
