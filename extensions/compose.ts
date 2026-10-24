import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { planLaunch, executeLaunch } from '../src/launch.ts';

// Explicit /compose launch is the user's execution instruction. No agent-start hooks.
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
      const sourceSessionFile = context === 'fork'
        ? await ctx.ui.input('Exact source Pi session file (.jsonl)', '/absolute/path/to/main-session.jsonl') : undefined;
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
}
