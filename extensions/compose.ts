import { Type } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { planLaunch, executeLaunch } from '../src/launch.ts';
import { planResume, executeResume } from '../src/resume.ts';
import { registerWorkReturn, showWorkPicker, showSavedSessions } from './work-return.ts';
import { openWorkmuxMonitor } from './optional/workmux-dashboard.ts';
import { registerTaskHub, showTaskHub, trackLaunchedTask, refreshTaskIndicator } from './task-hub.ts';
import { fileURLToPath } from 'node:url';
import { Text } from '@earendil-works/pi-tui';
import { approveLaunch, taskName } from './compose-panel.ts';
import { diagnosticEvent, startFlow, finishFlow } from '../src/diagnostics.mjs';

const baseExtension = fileURLToPath(import.meta.url);

// Session selection always uses an explicit source. 'Current' is not inferred to mean 'Main'.
/** A selected Pi conversation and the launch instruction are two separate sources of context. */
function currentConversationPreview(ctx: ExtensionContext): { messages: number; preview: string[] } | undefined {
  try {
    const entries = ctx.sessionManager.getBranch();
    const prompts = entries
      .filter(e => e.type === 'message' && e.message.role === 'user')
      .map(e => {
        if (e.type !== 'message' || e.message.role !== 'user') return '';
        const content = e.message.content;
        return typeof content === 'string'
          ? content
          : content.filter(c => c.type === 'text').map(c => c.text).join(' ');
      })
      .filter(Boolean);
    return {
      messages: prompts.length,
      preview: prompts.slice(-2).map(p => p.replace(/\s+/g, ' ').trim().slice(0, 180)),
    };
  } catch { return undefined; }
}


async function chooseForkSource(ctx: ExtensionContext, { includeCurrent = true }: { includeCurrent?: boolean } = {}): Promise<string | undefined> {
  const current = ctx.sessionManager.getSessionFile();
  const choices = [
    ...(current && includeCurrent ? ['Current Pi session'] : []),
    'Choose another saved session in this project',
    'Enter a session file path',
  ];
  const selected = await ctx.ui.select('Fork source session', choices);
  if (!selected) return undefined;
  if (selected === 'Current Pi session') return current;
  if (selected === 'Enter a session file path') {
    return await ctx.ui.input('Exact source Pi session file (.jsonl)', '/absolute/path/to/main-session.jsonl');
  }

  // Only discover project sessions after the user explicitly asks for that list.
  // Pi owns the session index: no custom index/registry or JSONL transcript scanning here.
  const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
  const other = sessions.filter(session => session.path !== current).slice(0, 30);
  if (other.length === 0) {
    ctx.ui.notify('No other saved project sessions found. You can select a session file path manually.', 'warning');
    return undefined;
  }
  const labels = other.map((session, index) => {
    const title = (session.name || session.firstMessage || 'Unnamed session').replace(/\s+/g, ' ').slice(0, 48);
    return `${index + 1}. ${title} [${session.id.slice(0, 8)}]`;
  });
  const choice = await ctx.ui.select('Select exact source session', labels);
  if (!choice) return undefined;
  const index = labels.indexOf(choice);
  return index < 0 ? undefined : other[index]?.path;
}

export async function showLaunchWizard(pi: ExtensionAPI, ctx: ExtensionContext, mode: 'launch' | 'preview', suppliedTask = ''): Promise<void> {
  const flow = startFlow('launch.started',{source:'slash',data:{route:mode}});
  let outcome: 'success'|'failure'|'cancelled' = 'cancelled';
  let chosenContext: 'fork'|'independent'|undefined;
  let chosenWorkspace: 'shared'|'worktree'|undefined;
  try {
  if (!ctx.hasUI) {
    ctx.ui.notify('Interactive options are required. Use the pi-compose CLI in non-UI environments.', 'warning');
    return;
  }
  const task = suppliedTask || await ctx.ui.input('Development task', 'What should the new agent do?');
  if (!task?.trim()) return;
  const contextChoice = await ctx.ui.select('Context source', ['Fork existing Pi session', 'Independent new session']);
  if (!contextChoice) return;
  const workspaceChoice = await ctx.ui.select('Workspace', ['Shared directory', 'Git Worktree']);
  if (!workspaceChoice) return;
  const context = contextChoice.startsWith('Fork') ? 'fork' : 'independent';
  const workspace = workspaceChoice === 'Git Worktree' ? 'worktree' : 'shared';
  chosenContext=context; chosenWorkspace=workspace;
  let sourceSessionFile: string | undefined;
  try {
    sourceSessionFile = context === 'fork' ? await chooseForkSource(ctx) : undefined;
  } catch (error) {
    ctx.ui.notify(`Cannot list Pi sessions: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return;
  }
  if (context === 'fork' && !sourceSessionFile?.trim()) return;
  const branch = workspace === 'worktree'
    ? await ctx.ui.input('New branch name', 'feat/example') : undefined;
  if (workspace === 'worktree' && !branch?.trim()) return;
  try {
    const plan = await planLaunch({ task, context, workspace, cwd: ctx.cwd, sourceSessionFile, branch, composeExtensionFile: baseExtension });
    if (mode === 'preview') {
      outcome='success';
      ctx.ui.notify(`Preview only: ${plan.program} ${plan.args.join(' ')}${plan.warnings.length ? `\n${plan.warnings.join('\n')}` : ''}`, 'info');
      return;
    }
    const approval = await approveLaunch(ctx, plan, {
      current: plan.source?.path === ctx.sessionManager.getSessionFile(),
      conversationPreview: currentConversationPreview(ctx)?.preview,
    });
    diagnosticEvent('launch.approval',{source:'slash',flowId:flow.flowId,outcome:approval?'success':'cancelled',data:{context,workspace}});
    if (approval !== true) return;
    const result = await executeLaunch(plan);
    outcome='success';
    const indexWarning = await trackLaunchedTask(pi, plan);
    if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
    await refreshTaskIndicator(ctx, plan.cwd);
    ctx.ui.notify(`Agent 실행 명령 전달 완료 · ${taskName(plan.task)} · 실행 상태: /compose monitor, 정확한 연결: /compose`, 'info');
    for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
  } catch (error: unknown) {
    outcome='failure';
    ctx.ui.notify(`Launch failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  } finally { finishFlow(flow,'launch.finished',{source:'slash',outcome,data:{context:chosenContext,workspace:chosenWorkspace,route:mode}}); }
}

export default function composeExtension(pi: ExtensionAPI): void {
  registerWorkReturn(pi);
  const openHub = (ctx: ExtensionContext) => showTaskHub(pi, ctx, () => showLaunchWizard(pi, ctx, 'launch'));
  registerTaskHub(pi, openHub);
  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose related agents; /compose launch, /compose monitor, /compose sessions',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      const route = ['launch','preview','monitor','dashboard','sessions','back','resume','work'].includes(subcommand||'') ? subcommand : !subcommand?'home':'invalid';
      diagnosticEvent('command.entered',{source:'slash',data:{route}});
      if(route==='invalid') diagnosticEvent('command.invalid',{source:'slash',outcome:'failure',data:{route:'invalid'}});
      if (!subcommand || subcommand === 'work') {
        await openHub(ctx);
        return;
      }
      if (subcommand === 'monitor' || subcommand === 'dashboard') {
        await openWorkmuxMonitor(pi, ctx);
        return;
      }
      if (subcommand === 'sessions') {
        await showSavedSessions(ctx, rest.join(' '));
        return;
      }
      if (subcommand === 'back') {
        await showWorkPicker(pi, ctx, rest.join(' '));
        return;
      }
      if (subcommand === 'resume') {
        if (rest.length) {
          ctx.ui.notify('Usage: /compose resume', 'warning');
          return;
        }
        if (!ctx.hasUI) {
          ctx.ui.notify('Interactive session selection is required. Use pi-compose resume from the terminal.', 'warning');
          return;
        }
        const workspaceChoice = await ctx.ui.select('Resume workspace', ['Shared directory', 'Git Worktree']);
        if (!workspaceChoice) return;
        let sessionFile: string | undefined;
        try { sessionFile = await chooseForkSource(ctx, { includeCurrent: false }); }
        catch (error) {
          ctx.ui.notify('Cannot inspect saved sessions: ' + String(error), 'error');
          return;
        }
        if (!sessionFile) return;
        const currentSession = ctx.sessionManager.getSessionFile();
        if (currentSession && sessionFile === currentSession) {
          ctx.ui.notify('The selected session is already open in this Pi process. Choose a different saved session.', 'warning');
          return;
        }
        const workspace = workspaceChoice === 'Git Worktree' ? 'worktree' : 'shared';
        const branch = workspace === 'worktree' ? await ctx.ui.input('Existing Worktree branch', 'feat/example') : undefined;
        if (workspace === 'worktree' && !branch?.trim()) return;
        try {
          const plan = await planResume({ workspace, sessionFile, cwd: ctx.cwd, branch, composeExtensionFile: baseExtension });
          const result = await executeResume(plan);
          ctx.ui.notify('Resume: ' + result.status + '. tmux target: ' + result.tmuxTarget + '. Actual Pi readiness is not verified.', 'info');
          for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
        } catch (error) {
          ctx.ui.notify('Could not resume: ' + (error instanceof Error ? error.message : String(error)), 'error');
        }
        return;
      }
      if (subcommand !== 'launch' && subcommand !== 'preview') {
        ctx.ui.notify('Usage: /compose, /compose launch [task], /compose monitor, /compose sessions [query], /compose back [query], /compose resume', 'info');
        return;
      }
      await showLaunchWizard(pi, ctx, subcommand, rest.join(' '));
    },
  });

  registerComposeLaunchTool(pi);
}

/** Same explicit natural-language handoff is available in Main and in a child Pi. */
export function registerComposeLaunchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'compose_launch',
    label: 'Launch coding agent',
    description: 'On an explicit user instruction to start/delegate implementation, call this tool directly without asking for additional conversational permission: the extension shows ONE execution approval. For planning or discussing whether to delegate, never call. Preserve established requirements, prohibitions and WHY in the task; do not invent constraints. Fork inherits the specifically selected Pi session. Do not ask for an already specified context, workspace or branch. If a required detail is missing, ask only for that detail. Never assert Fork context arrived solely from successful launch.',
    parameters: Type.Object({
      task: Type.String({ description: 'Exact actionable implementation instruction, preserving established constraints and reasons.' }),
      title: Type.Optional(Type.String({ description: 'Short human-readable task name for the Hub. Does not replace the full instruction.' })),
      context: Type.Union([Type.Literal('fork'), Type.Literal('independent')]),
      workspace: Type.Union([Type.Literal('shared'), Type.Literal('worktree')]),
      source: Type.Optional(Type.Union([
        Type.Object({ kind: Type.Literal('current') }),
        Type.Object({ kind: Type.Literal('file'), path: Type.String() }),
      ], { description: 'Required for fork: explicitly selected current Pi session or exact saved JSONL file' })),
      branch: Type.Optional(Type.String({ description: 'New branch, required for worktree' })),
      cwd: Type.Optional(Type.String({ description: 'Target directory. Defaults to this Pi session cwd' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const flow = startFlow('launch.started',{source:'natural-language',data:{context:params.context,workspace:params.workspace}});
      let outcome: 'success'|'failure'|'cancelled'|'unavailable' = 'failure';
      try {
      if (params.context === 'fork' && !params.source) {
        throw new Error('Fork requires an explicit source: current Pi session or an exact session file.');
      }
      if (params.context === 'independent' && params.source) {
        throw new Error('An independent session must not specify a Fork source.');
      }
      const sourceSessionFile = params.source?.kind === 'current'
        ? ctx.sessionManager.getSessionFile()
        : params.source?.kind === 'file' ? params.source.path : undefined;
      if (params.context === 'fork' && !sourceSessionFile) {
        throw new Error('The selected Pi session has no saved session file. Save a conversation before forking.');
      }
      // Model tool calls alone never authorize process creation. A real user's confirmation is required.
      if (!ctx.hasUI) {
        outcome='unavailable';
        return {
          content: [{ type: 'text' as const, text: 'Launch was NOT executed: confirmation UI unavailable. Ask the user to run /compose launch or use the CLI.' }],
          details: { status: 'not_executed_confirmation_unavailable' },
        };
      }
      const plan = await planLaunch({
        task: params.task, context: params.context, workspace: params.workspace,
        cwd: params.cwd || ctx.cwd, sourceSessionFile, branch: params.branch,
        composeExtensionFile: baseExtension,
      });
      const approved = await approveLaunch(ctx, plan, {
        current: params.source?.kind === 'current',
        title: params.title,
        conversationPreview: params.source?.kind === 'current'
          ? currentConversationPreview(ctx)?.preview : undefined,
      });
      diagnosticEvent('launch.approval',{source:'natural-language',flowId:flow.flowId,outcome:approved?'success':'cancelled',data:{context:params.context,workspace:params.workspace}});
      if (approved !== true) {
        outcome='cancelled';
        return { content: [{ type: 'text' as const, text: 'Launch cancelled by user. No agent was started.' }], details: { status: 'cancelled' } };
      }
      const result = await executeLaunch(plan);
      outcome='success';
      const indexWarning = await trackLaunchedTask(pi, plan, params.title);
      if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
      await refreshTaskIndicator(ctx, plan.cwd);
      return {
        content: [{ type: 'text' as const,
          text: '위임 명령 실행 완료: ' + taskName(plan.task, params.title)
            + '. 실제 Pi 활동은 미확인입니다. 관련 작업은 /compose, 실행 관찰은 /compose monitor.' }],
        details: result,
      };
      } finally { finishFlow(flow,'launch.finished',{source:'natural-language',outcome,data:{context:params.context,workspace:params.workspace}}); }
    },
    renderCall(args, theme) {
      return new Text(theme.fg('accent', '↗ 개발 위임 · ' + taskName(args.task, args.title)), 0, 0);
    },
    renderResult(result, _options, theme) {
      const status = result.details && typeof result.details === 'object' && 'status' in result.details
        ? String(result.details.status) : '';
      const message = result.content.filter(item => item.type === 'text')
        .map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
      const success = status !== 'cancelled' && status !== 'not_executed_confirmation_unavailable'
        && message.startsWith('위임 명령 실행 완료');
      return new Text(theme.fg(success ? 'success' : 'dim',
        (success ? '✓ ' : '· ') + message.slice(0, 190)), 0, 0);
    },
  });
}
