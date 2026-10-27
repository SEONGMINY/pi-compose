import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTaskHub, showTaskHub } from '../../../extensions/task-hub.ts';
import { showLaunchWizard, registerComposeLaunchTool } from '../../../extensions/compose.ts';
import { registerWorkReturn } from '../../../extensions/work-return.ts';
import { showWorkPicker, showSavedSessions } from '../../../extensions/work-return.ts';
import { openWorkmuxMonitor } from '../../../extensions/optional/workmux-dashboard.ts';
import { diagnosticEvent, startFlow, finishFlow } from '../../../src/diagnostics.mjs';
import { activeExtensionReport, versionReport } from '../../../src/provenance.mjs';

/**
 * Optional Pi package for workmux-started child Pi sessions.
 * The pic entry already loads the full Compose Extension; avoid registration
 * collisions when the user installs this package globally.
 */
const navigationModuleLoadedAt=Date.now();
const navigationLoadedProvenance=activeExtensionReport(fileURLToPath(import.meta.url),{
  root:fileURLToPath(new URL('../../../',import.meta.url)),mode:'child-navigation',startedAt:navigationModuleLoadedAt,
});
export default function navigationOnly(pi: ExtensionAPI): void {
  if (process.env.PIC_COMPOSE_CORE === '1') return;
  registerWorkReturn(pi);
  registerComposeLaunchTool(pi);
  const openHub = (ctx: Parameters<typeof showTaskHub>[1]) =>
    showTaskHub(pi, ctx, (advanced = false) => showLaunchWizard(pi, ctx, 'launch', '', advanced));
  registerTaskHub(pi, openHub);
  pi.registerCommand('compose', {
    description: 'Pi Compose: related agents, launch, monitor, sessions, back',
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      const route = ['launch','advanced','preview','monitor','dashboard','sessions','back','version','work'].includes(subcommand||'') ? subcommand : !subcommand?'home':'invalid';
      const commandFlow=startFlow('command.entered',{source:'slash',data:{route}});
      try {
      if(route==='invalid') diagnosticEvent('command.invalid',{source:'slash',outcome:'failure',data:{route:'invalid'}});
      if (!subcommand || subcommand === 'work') return openHub(ctx);
      if (subcommand === 'version') {
        const latest=activeExtensionReport(fileURLToPath(import.meta.url),
          {root:fileURLToPath(new URL('../../../',import.meta.url)),mode:'child-navigation',startedAt:navigationModuleLoadedAt});
        const details=versionReport({...navigationLoadedProvenance,
          modifiedAfterLoad:latest.modifiedAfterLoad,modifiedAt:latest.modifiedAt});
        if (ctx.hasUI) await ctx.ui.confirm('현재 Child Pi · 실제 로드된 Extension', details);
        else ctx.ui.notify(details,'info');
        return;
      }
      if (subcommand === 'monitor' || subcommand === 'dashboard') return openWorkmuxMonitor(pi, ctx);
      if (subcommand === 'sessions') return showSavedSessions(ctx, rest.join(' '));
      if (subcommand === 'launch' || subcommand === 'preview' || subcommand === 'advanced') {
        return showLaunchWizard(pi, ctx, subcommand === 'preview' ? 'preview' : 'launch',
          rest.join(' '), subcommand === 'advanced' || subcommand === 'preview');
      }
      if (subcommand === 'back') return showWorkPicker(pi, ctx, rest.join(' '));
      ctx.ui.notify('관련 Agent: /compose · 전체 작업: /compose monitor · 이전 대화: /compose sessions', 'info');
      } finally {finishFlow(commandFlow,'command.finished',{source:'slash',outcome:route==='invalid'?'failure':'unknown',data:{route}});}
    },
  });
}
