import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { dashboardArgs, type DashboardOptions } from '../../src/dashboard.ts';

/**
 * Use workmux's actual multi-project UI; no second agent status renderer.
 * Shared sessions not managed by workmux remain available from /compose.
 */
export async function openWorkmuxMonitor(
  pi: ExtensionAPI, ctx: ExtensionContext, tab?: DashboardOptions['tab'],
): Promise<boolean> {
  if (!ctx.hasUI || !process.env.TMUX) {
    ctx.ui.notify('The workmux View requires Pi running in tmux. In a terminal run: workmux dashboard. Run workmux setup to configure Pi status hooks.', 'warning');
    return false;
  }
  const command = ['workmux', ...dashboardArgs({tab})].map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
  try {
    const result = await pi.exec('tmux', ['display-popup', '-E', '-w', '90%', '-h', '90%', command], { cwd: ctx.cwd });
    if (result.code !== 0) throw new Error(result.stderr || 'tmux popup exit ' + result.code);
    return true;
  } catch (error) {
    ctx.ui.notify('Could not open workmux dashboard: ' + (error instanceof Error ? error.message : String(error)) + '. Run workmux setup for Pi status hooks.', 'error');
    return false;
  }
}

export default function workmuxDashboardExtension(pi: ExtensionAPI): void {
  pi.registerCommand('compose-workmux', {
    description: 'Optional workmux Dashboard: /compose-workmux [agents|worktrees]',
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input && input !== 'agents' && input !== 'worktrees') {
        ctx.ui.notify('Usage: /compose-workmux [agents|worktrees]', 'warning');
        return;
      }
      await openWorkmuxMonitor(pi, ctx, input === 'agents' || input === 'worktrees' ? input : undefined);
    },
  });
}
