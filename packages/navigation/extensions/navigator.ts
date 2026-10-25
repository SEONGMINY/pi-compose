import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTaskHub, showTaskHub } from '../../../extensions/task-hub.ts';
import { showLaunchWizard } from '../../../extensions/compose.ts';
import { showWorkPicker } from '../../../extensions/work-return.ts';

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
    description: 'Pi Compose: Task Hub, /compose launch [task], /compose back',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      if (!subcommand || subcommand === 'work') return openHub(ctx);
      if (subcommand === 'launch' || subcommand === 'preview') {
        return showLaunchWizard(pi, ctx, subcommand, rest.join(' '));
      }
      if (subcommand === 'back') return showWorkPicker(pi, ctx, rest.join(' '));
      ctx.ui.notify('작업 보기: /compose 또는 Alt+W · 새 Agent: /compose launch', 'info');
    },
  });
}
