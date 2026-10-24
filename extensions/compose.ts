import { Type } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { planLaunch, executeLaunch } from '../src/launch.ts';

// Session selection always uses an explicit source. 'Current' is not inferred to mean 'Main'.
async function chooseForkSource(ctx: ExtensionContext): Promise<string | undefined> {
  const current = ctx.sessionManager.getSessionFile();
  const choices = [
    ...(current ? ['Current Pi session'] : []),
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

export default function composeExtension(pi: ExtensionAPI): void {
  pi.registerCommand('compose', {
    description: 'Launch a coding agent using selected context and workspace: /compose launch [task] (or /compose preview [task])',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      if (subcommand !== 'launch' && subcommand !== 'preview') {
        ctx.ui.notify('Usage: /compose launch [task] or /compose preview [task]', 'info');
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify('Interactive options are required. Use the pi-compose CLI in non-UI environments.', 'warning');
        return;
      }
      const task = rest.join(' ') || await ctx.ui.input('Development task', 'What should the new agent do?');
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
        const plan = await planLaunch({ task, context, workspace, cwd: ctx.cwd, sourceSessionFile, branch });
        if (subcommand === 'preview') {
          ctx.ui.notify(`Preview only: ${plan.program} ${plan.args.join(' ')}${plan.warnings.length ? `\n${plan.warnings.join('\n')}` : ''}`, 'info');
          return;
        }
        const result = await executeLaunch(plan);
        ctx.ui.notify(`Launch command completed (${result.status}). ${result.workspace} ${result.branch || result.cwd}. Agent readiness unverified.`, 'info');
        for (const warning of result.warnings) ctx.ui.notify(warning, 'warning');
      } catch (error: unknown) {
        ctx.ui.notify(`Launch failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    },
  });

  pi.registerTool({
    name: 'compose_launch',
    label: 'Launch coding agent',
    description: 'Launch a NEW development agent only when the USER explicitly requests starting/spawning an agent. Never call for mere planning, analysis, or recommendations. Requires user confirmation before any execution. Source "current" means THIS Pi session, not an inferred Main session.',
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
      });
      const approved = await ctx.ui.confirm('Launch development agent?', [
        `Task: ${plan.task}`,
        `Context: ${plan.context}${plan.source ? ` (source: ${plan.source.id})` : ''}`,
        `Workspace: ${plan.workspace}${plan.branch ? ` (branch: ${plan.branch})` : ''}`,
        `Directory: ${plan.cwd}`,
        ...plan.warnings,
      ].join('\n'));
      if (approved !== true) {
        return { content: [{ type: 'text' as const, text: 'Launch cancelled by user. No agent was started.' }], details: { status: 'cancelled' } };
      }
      const result = await executeLaunch(plan);
      return {
        content: [{ type: 'text' as const, text: `Launch command succeeded for ${plan.task}; agent readiness is not yet verified. Workspace: ${plan.workspace}; target: ${plan.branch || plan.cwd}` }],
        details: result,
      };
    },
  });
}
