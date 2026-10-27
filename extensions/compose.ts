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
import { DEFAULT_DELEGATION, proposedBranch } from '../src/delegation-defaults.ts';

const baseExtension = fileURLToPath(import.meta.url);

// Fixed diagnostic categories. Never export stderr, session paths or the task prompt.
function failureKind(error: unknown, stage: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Source cwd \(|source repository root|source was created in a different cwd/i.test(message)) return 'source_cwd_mismatch';
  if (/source Pi session|source session|no saved session file|explicit source|selected Pi session/i.test(message)) return 'source_missing';
  if (/Branch already exists/i.test(message)) return 'branch_exists';
  if (stage === 'dispatch' && /workmux/i.test(message)) return 'workmux_dispatch';
  if (stage === 'dispatch' && /tmux/i.test(message)) return 'tmux_dispatch';
  if (stage === 'plan' && /git |branch|worktree/i.test(message)) return 'git_preflight';
  return 'unknown';
}
function recoveryHint(kind: string): string {
  if (kind === 'source_cwd_mismatch') return 'Worktree Fork는 원본 Pi 세션의 cwd가 Git 저장소 루트여야 합니다. 원본 Pi의 /session을 확인하거나 Fork + Shared를 사용하세요.';
  if (kind === 'branch_exists') return '기존 브랜치가 있습니다. /compose에서 기존 작업을 찾거나 새 작업에 다른 브랜치 이름을 사용하세요.';
  if (kind === 'source_missing') return '원본 Pi에서 /session으로 저장된 세션 파일을 확인하세요.';
  if (kind === 'workmux_dispatch' || kind === 'tmux_dispatch') return '부분 생성된 리소스가 있을 수 있습니다. 같은 브랜치로 다시 실행하기 전에 git worktree list와 /compose를 확인하세요. 자동으로 삭제하지 않습니다.';
  return 'pic doctor 및 세션과 Git 상태를 확인하세요. Worktree 오류 후에는 git worktree list에서 남은 작업을 먼저 확인하세요.';
}

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

export async function showLaunchWizard(pi: ExtensionAPI, ctx: ExtensionContext, mode: 'launch' | 'preview', suppliedTask = '', advanced = false): Promise<void> {
  const flow = startFlow('launch.started',{source:'slash',data:{route:mode}});
  let outcome: 'success'|'failure'|'cancelled'|'unavailable' = 'cancelled';
  let chosenContext: 'fork'|'independent'|undefined;
  let chosenWorkspace: 'shared'|'worktree'|undefined;
  let stage='input';
  try {
  if (!ctx.hasUI) {
    ctx.ui.notify('Interactive options are required. Use the pi-compose CLI in non-UI environments.', 'warning');
    return;
  }
  const task = suppliedTask || await ctx.ui.input('Development task', 'What should the new agent do?');
  if (!task?.trim()) return;
  // Kiro's prompt-first entry, Orca's default worktree: one confirmation for the normal case.
  // Explicit advanced mode preserves all four independent Context/Workspace combinations.
  let context: 'fork' | 'independent' = DEFAULT_DELEGATION.context;
  let workspace: 'worktree' | 'shared' = DEFAULT_DELEGATION.workspace;
  if (advanced || mode === 'preview') {
    const contextChoice = await ctx.ui.select('대화 맥락', ['Fork existing Pi session', 'Independent new session']);
    if (!contextChoice) return;
    const workspaceChoice = await ctx.ui.select('작업 공간', ['Shared directory', 'Git Worktree']);
    if (!workspaceChoice) return;
    context = contextChoice.startsWith('Fork') ? 'fork' : 'independent';
    workspace = workspaceChoice === 'Git Worktree' ? 'worktree' : 'shared';
  }
  chosenContext=context; chosenWorkspace=workspace;
  let sourceSessionFile: string | undefined;
  try {
    sourceSessionFile = context === 'fork'
      ? (advanced || mode === 'preview' ? await chooseForkSource(ctx) : ctx.sessionManager.getSessionFile())
      : undefined;
  } catch (error) {
    outcome='failure';
    diagnosticEvent('launch.stage',{source:'slash',flowId:flow.flowId,outcome:'failure',
      data:{stage:'input',failureKind:'source_missing'}});
    ctx.ui.notify(`저장된 Pi 대화를 찾을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return;
  }
  if (context === 'fork' && !sourceSessionFile?.trim()) {
    outcome='unavailable';
    ctx.ui.notify('현재 Pi 세션이 저장되지 않아 Fork할 수 없습니다. Main에서 한 번 대화를 저장한 다음 다시 실행하세요. 자동으로 Independent로 바꾸지는 않습니다.', 'warning');
    return;
  }
  const branch = workspace === 'worktree'
    ? (advanced || mode === 'preview'
        ? await ctx.ui.input('New branch name', proposedBranch(task))
        : proposedBranch(task))
    : undefined;
  if (workspace === 'worktree' && !branch?.trim()) return;
  stage='plan';
  try {
    const plan = await planLaunch({ task, context, workspace, cwd: ctx.cwd, sourceSessionFile, branch, composeExtensionFile: baseExtension });
    if (mode === 'preview') {
      diagnosticEvent('launch.stage',{source:'slash',flowId:flow.flowId,outcome:'success',data:{stage:'plan'}});
      outcome='success';
      ctx.ui.notify(`Preview only: ${plan.program} ${plan.args.join(' ')}${plan.warnings.length ? `\n${plan.warnings.join('\n')}` : ''}`, 'info');
      return;
    }
    stage='approval';
    const approval = await approveLaunch(ctx, plan, {
      current: plan.source?.path === ctx.sessionManager.getSessionFile(),
      conversationPreview: currentConversationPreview(ctx)?.preview,
    });
    diagnosticEvent('launch.approval',{source:'slash',flowId:flow.flowId,outcome:approval?'success':'cancelled',data:{context,workspace}});
    if (approval !== true) return;
    stage='dispatch';
    const result = await executeLaunch(plan);
    outcome='success'; // Dispatch succeeded; Pi/model readiness is distinct.
    diagnosticEvent('launch.stage',{source:'slash',flowId:flow.flowId,outcome:'success',data:{stage}});
    stage='target';
    const indexWarning = await trackLaunchedTask(pi, plan, undefined, flow.flowId);
    diagnosticEvent('launch.stage',{source:'slash',flowId:flow.flowId,outcome:indexWarning?'unavailable':'success',data:{stage,failureKind:indexWarning?'record_unlinked':undefined}});
    if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
    await refreshTaskIndicator(ctx, plan.cwd);
    ctx.ui.notify(`실행 요청 전달: ${taskName(plan.task)}. 실제 Child Pi의 모델 실행과 개발 지시 처리는 확인되지 않았습니다.\n다음: /compose → 해당 작업 → 기존 Agent 화면으로 이동해 확인하세요. 결과 보고서는 Agent가 /compose-handoff를 실행한 뒤에만 나타납니다.`, 'info');
    for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
  } catch (error: unknown) {
    if (stage !== 'target') outcome='failure';
    const kind=failureKind(error,stage);
    diagnosticEvent('launch.stage',{source:'slash',flowId:flow.flowId,outcome:'failure',data:{stage,failureKind:kind}});
    ctx.ui.notify(`Launch problem (${stage}): ${error instanceof Error ? error.message : String(error)}\n${recoveryHint(kind)}`, 'error');
  }
  } finally { finishFlow(flow,'launch.finished',{source:'slash',outcome,data:{context:chosenContext,workspace:chosenWorkspace,route:mode}}); }
}

export default function composeExtension(pi: ExtensionAPI): void {
  registerWorkReturn(pi);
  const openHub = (ctx: ExtensionContext) => showTaskHub(pi, ctx, (advanced = false) => showLaunchWizard(pi, ctx, 'launch', '', advanced));
  registerTaskHub(pi, openHub);
  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose related agents; /compose launch, /compose monitor, /compose sessions',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      const route = ['launch','advanced','preview','monitor','dashboard','sessions','back','resume','work'].includes(subcommand||'') ? subcommand : !subcommand?'home':'invalid';
      const commandFlow=startFlow('command.entered',{source:'slash',data:{route}});
      try {
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
      if (subcommand !== 'launch' && subcommand !== 'preview' && subcommand !== 'advanced') {
        ctx.ui.notify('Usage: /compose (작업 열기), /compose launch [task], /compose advanced [task], /compose sessions [query]', 'info');
        return;
      }
      await showLaunchWizard(pi, ctx, subcommand === 'preview' ? 'preview' : 'launch',
        rest.join(' '), subcommand === 'advanced' || subcommand === 'preview');
      } finally {finishFlow(commandFlow,'command.finished',{source:'slash',outcome:route==='invalid'?'failure':'unknown',data:{route}});}
    },
  });

  registerComposeLaunchTool(pi);
}

/** Same explicit natural-language handoff is available in Main and in a child Pi. */
export function registerComposeLaunchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'compose_launch',
    label: 'Launch coding agent',
    description: 'On an explicit user instruction to start/delegate implementation, call this tool directly without asking for additional conversational permission: the extension shows ONE execution approval. For planning or discussing whether to delegate, never call. Preserve established requirements, prohibitions and WHY in the task; do not invent constraints. Fork inherits the specifically selected Pi session. Do not ask for an already specified context, workspace or branch. Default to the current Pi conversation Fork plus a new Worktree and generate a unique branch if unspecified. Ask only for an unusable source or missing task. Explicit Context/Workspace choices override defaults. Never assert Fork context arrived solely from successful launch.',
    parameters: Type.Object({
      task: Type.String({ description: 'Exact actionable implementation instruction, preserving established constraints and reasons.' }),
      title: Type.Optional(Type.String({ description: 'Short human-readable task name for the Hub. Does not replace the full instruction.' })),
      context: Type.Optional(Type.Union([Type.Literal('fork'), Type.Literal('independent')])),
      workspace: Type.Optional(Type.Union([Type.Literal('shared'), Type.Literal('worktree')])),
      source: Type.Optional(Type.Union([
        Type.Object({ kind: Type.Literal('current') }),
        Type.Object({ kind: Type.Literal('file'), path: Type.String() }),
      ], { description: 'Required for fork: explicitly selected current Pi session or exact saved JSONL file' })),
      branch: Type.Optional(Type.String({ description: 'New branch, required for worktree' })),
      cwd: Type.Optional(Type.String({ description: 'Target directory. Defaults to this Pi session cwd' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const context = params.context ?? DEFAULT_DELEGATION.context;
      const workspace = params.workspace ?? DEFAULT_DELEGATION.workspace;
      const source = context === 'fork' ? (params.source ?? { kind: 'current' as const }) : params.source;
      const flow = startFlow('launch.started',{source:'natural-language',data:{context,workspace}});
      let outcome: 'success'|'failure'|'cancelled'|'unavailable' = 'failure';
      let stage='plan';
      try {
      if (context === 'independent' && source) {
        throw new Error('An independent session must not specify a Fork source.');
      }
      const sourceSessionFile = source?.kind === 'current'
        ? ctx.sessionManager?.getSessionFile()
        : source?.kind === 'file' ? source.path : undefined;
      if (context === 'fork' && !sourceSessionFile) {
        throw new Error('The selected Pi conversation is not saved. Discuss it in Main first or choose a saved source.');
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
        task: params.task, context, workspace,
        cwd: params.cwd || ctx.cwd, sourceSessionFile,
        branch: workspace === 'worktree' ? (params.branch ?? proposedBranch(params.task)) : params.branch,
        composeExtensionFile: baseExtension,
      });
      stage='approval';
      const approved = await approveLaunch(ctx, plan, {
        current: source?.kind === 'current',
        title: params.title,
        conversationPreview: source?.kind === 'current'
          ? currentConversationPreview(ctx)?.preview : undefined,
      });
      diagnosticEvent('launch.approval',{source:'natural-language',flowId:flow.flowId,outcome:approved?'success':'cancelled',data:{context,workspace}});
      if (approved !== true) {
        outcome='cancelled';
        return { content: [{ type: 'text' as const, text: 'Launch cancelled by user. No agent was started.' }], details: { status: 'cancelled' } };
      }
      stage='dispatch';
      const result = await executeLaunch(plan);
      outcome='success'; // Dispatch only.
      diagnosticEvent('launch.stage',{source:'natural-language',flowId:flow.flowId,outcome:'success',data:{stage}});
      stage='target';
      const indexWarning = await trackLaunchedTask(pi, plan, params.title, flow.flowId);
      diagnosticEvent('launch.stage',{source:'natural-language',flowId:flow.flowId,outcome:indexWarning?'unavailable':'success',data:{stage,failureKind:indexWarning?'record_unlinked':undefined}});
      if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
      await refreshTaskIndicator(ctx, plan.cwd);
      return {
        content: [{ type: 'text' as const,
          text: '위임 요청 전송: ' + taskName(plan.task, params.title)
            + '. Child Pi에서 모델 작업은 아직 확인되지 않았습니다. /compose → 해당 작업 → 기존 Agent 화면으로 이동해 확인하세요. /compose-handoff 이후 보고서가 표시됩니다.' }],
        details: result,
      };
      } catch(error) {
        outcome='failure';
        diagnosticEvent('launch.stage',{source:'natural-language',flowId:flow.flowId,outcome:'failure',
          data:{stage,failureKind:failureKind(error,stage)}});
        throw error;
      } finally { finishFlow(flow,'launch.finished',{source:'natural-language',outcome,data:{context,workspace}}); }
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
        && message.startsWith('위임 요청 전송');
      return new Text(theme.fg(success ? 'success' : 'dim',
        (success ? '✓ ' : '· ') + message.slice(0, 190)), 0, 0);
    },
  });
}
