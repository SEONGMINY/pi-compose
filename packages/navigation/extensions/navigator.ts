import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTaskHub, showTaskHub } from '../../../extensions/task-hub.ts';
import { showLaunchWizard } from '../../../extensions/compose.ts';
import { showWorkPicker, showSavedSessions } from '../../../extensions/work-return.ts';
import { openWorkmuxMonitor } from '../../../extensions/optional/workmux-dashboard.ts';

/**
 * Optional Pi package for workmux-started child Pi sessions.
 * The pic entry already loads the full Compose Extension; avoid registration
 * collisions when the user installs this package globally.
 */
export default function navigationOnly(pi: ExtensionAPI): void {
  if (process.env.PIC_COMPOSE_CORE === '1') return;
  const openHub = (ctx: Parameters<typeof showTaskHub>[1]) =>
    showTaskHub(pi, ctx, () => showLaunchWizard(pi, ctx, 'launch'));
  registerTaskHub(pi, openHub);
  pi.registerCommand('compose', {
    description: 'Pi Compose: related agents, launch, monitor, sessions, back',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      if (!subcommand || subcommand === 'work') return openHub(ctx);
      if (subcommand === 'monitor' || subcommand === 'dashboard') return openWorkmuxMonitor(pi, ctx);
      if (subcommand === 'sessions') return showSavedSessions(ctx, rest.join(' '));
      if (subcommand === 'launch' || subcommand === 'preview') {
        return showLaunchWizard(pi, ctx, subcommand, rest.join(' '));
      }
      if (subcommand === 'back') return showWorkPicker(pi, ctx, rest.join(' '));
      ctx.ui.notify('관련 Agent: /compose · 전체 작업: /compose monitor · 이전 대화: /compose sessions', 'info');
    },
  });
}
