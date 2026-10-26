import { Type } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { planLaunch, executeLaunch } from '../src/launch.ts';
import { planResume, executeResume } from '../src/resume.ts';
import { registerWorkReturn, showWorkPicker } from './work-return.ts';
import { registerTaskHub, showTaskHub, trackLaunchedTask, refreshTaskIndicator } from './task-hub.ts';
import { fileURLToPath } from 'node:url';

const baseExtension = fileURLToPath(import.meta.url);

// Session selection always uses an explicit source. 'Current' is not inferred to mean 'Main'.
/** A selected Pi conversation and the launch instruction are two separate sources of context. */
function currentConversationPreview(ctx: ExtensionContext): { messages: number; preview: string[] } | undefined {
  try {
    const entries = ctx.sessionManager.getBranch();
    const prompts = entries
      .filter(e => e.type === 'message' && e.message.role === 'user')
      .map(e => e.type === 'message' && e.message.role === 'user'
        ? e.message.content.filter(c => c.type === 'text').map(c => c.text).join(' ')
        : '')
      .filter(Boolean);
    return {
      messages: prompts.length,
      preview: prompts.slice(-2).map(p => p.replace(/\s+/g, ' ').trim().slice(0, 180)),
    };
  } catch { return undefined; }
}

function launchConfirmation(plan: Awaited<ReturnType<typeof planLaunch>>, isCurrent: boolean,
  conversation: ReturnType<typeof currentConversationPreview>): string {
  return [
    '개발 Agent에게 맡길 작업:',
    plan.task,
    '',
    '컨텍스트: ' + (plan.context === 'fork'
      ? '선택한 Pi 대화 Fork (원본 세션 ' + plan.source?.id + ')' : '독립적인 새 대화'),
    ...(plan.context === 'fork' && isCurrent && conversation
      ? ['현재 대화의 사용자 메시지: ' + conversation.messages + '개',
        ...conversation.preview.map((p, i) => '최근 메시지 ' + (i + 1) + ': ' + p)] : []),
    ...(plan.context === 'fork'
      ? ['위 미리보기는 대화 전체가 아닙니다. 실제 컨텍스트는 Pi Fork가 전달합니다.']
      : ['기존 Main 대화는 전달되지 않습니다. 작업 지시만 전달됩니다.']),
    '작업 공간: ' + (plan.workspace === 'worktree' ? '별도 Git Worktree' : '현재 디렉터리'),
    ...(plan.branch ? ['브랜치: ' + plan.branch] : []),
    ...plan.warnings,
    '',
    '이 조건으로 실제 Agent를 실행할까요?',
  ].join('\n');
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
      ctx.ui.notify(`Preview only: ${plan.program} ${plan.args.join(' ')}${plan.warnings.length ? `\n${plan.warnings.join('\n')}` : ''}`, 'info');
      return;
    }
    const approval = await ctx.ui.confirm('개발 Agent 실행 확인', launchConfirmation(
      plan, plan.source?.path === ctx.sessionManager.getSessionFile(),
      currentConversationPreview(ctx),
    ));
    if (approval !== true) return;
    const result = await executeLaunch(plan);
    const indexWarning = await trackLaunchedTask(pi, plan);
    if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
    await refreshTaskIndicator(ctx, plan.cwd);
    ctx.ui.notify(`Launch command completed (${result.status}). ${result.workspace} ${result.branch || result.cwd}. Agent readiness unverified.`, 'info');
    for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
  } catch (error: unknown) {
    ctx.ui.notify(`Launch failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export default function composeExtension(pi: ExtensionAPI): void {
  registerWorkReturn(pi);
  const openHub = (ctx: ExtensionContext) => showTaskHub(pi, ctx, () => showLaunchWizard(pi, ctx, 'launch'));
  registerTaskHub(pi, openHub);
  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose or Alt+W for tasks; /compose launch [task], /compose back [query], /compose resume',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      if (!subcommand || subcommand === 'work') {
        await openHub(ctx);
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
        ctx.ui.notify('Usage: /compose launch [task], /compose preview [task], /compose work [query], /compose back [query], or /compose resume. Optional workmux View: /compose-workmux', 'info');
        return;
      }
      await showLaunchWizard(pi, ctx, subcommand, rest.join(' '));
    },
  });

  pi.registerTool({
    name: 'compose_launch',
    label: 'Launch coding agent',
    description: 'Launch a NEW coding agent only on an explicit user instruction to start/delegate work, including natural language. Never call for mere discussion or recommendations. The task must describe the actionable implementation goal using requirements already established in this conversation; do not substitute a vague phrase such as "implement what we discussed". If no concrete task was discussed, ask what to implement instead of calling the tool. Fork the current Pi session only when it is explicitly the source; independent means no inherited conversation. Show the exact task and source for approval before executing.',
    parameters: Type.Object({
      task: Type.String({ description: 'The task the NEW development agent should perform' }),
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
      const approved = await ctx.ui.confirm('개발 Agent 실행 확인', launchConfirmation(
        plan, params.source?.kind === 'current',
        params.source?.kind === 'current' ? currentConversationPreview(ctx) : undefined,
      ));
      if (approved !== true) {
        return { content: [{ type: 'text' as const, text: 'Launch cancelled by user. No agent was started.' }], details: { status: 'cancelled' } };
      }
      const result = await executeLaunch(plan);
      const indexWarning = await trackLaunchedTask(pi, plan);
      if (indexWarning) ctx.ui.notify(indexWarning, 'warning');
      await refreshTaskIndicator(ctx, plan.cwd);
      return {
        content: [{ type: 'text' as const, text: `Launch command succeeded for ${plan.task}; agent readiness is not yet verified. Workspace: ${plan.workspace}; target: ${plan.branch || plan.cwd}` }],
        details: result,
      };
    },
  });
}
