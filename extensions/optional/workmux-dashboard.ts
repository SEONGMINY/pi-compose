import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dashboardArgs, type DashboardOptions } from '../../src/dashboard.ts';

/**
 * Optional Pi view: load explicitly with -e or with Pi's settings.extensions.
 * The default pi-compose package only registers extensions/compose.ts.
 */
export default function workmuxDashboardExtension(pi: ExtensionAPI): void {
  pi.registerCommand('compose-workmux', {
    description: 'Open the optional workmux dashboard from a tmux popup: /compose-workmux [agents|worktrees]',
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input && input !== 'agents' && input !== 'worktrees') {
        ctx.ui.notify('Usage: /compose-workmux [agents|worktrees]', 'warning');
        return;
      }
      if (!ctx.hasUI || !process.env.TMUX) {
        ctx.ui.notify('The workmux View requires Pi running in tmux. You can also use "pi-compose dashboard" in a terminal.', 'warning');
        return;
      }
      const tab: DashboardOptions['tab'] = input === 'agents' || input === 'worktrees' ? input : undefined;
      // dashboardArgs contains only fixed arguments and the validated tab value.
      // No user-controlled shell fragments are passed to tmux.
      const command = ['workmux', ...dashboardArgs({ tab })].map(value => `'${value}'`).join(' ');
      try {
        const result = await pi.exec('tmux', ['display-popup', '-E', '-w', '90%', '-h', '90%', command]);
        if (result.code !== 0) {
          throw new Error(result.stderr || `tmux exited with code ${result.code}`);
        }
      } catch (error) {
        ctx.ui.notify(`Could not open workmux dashboard: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    },
  });
}
