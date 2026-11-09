import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerAgentIdentity } from './agent-identity.ts';
import { registerDirectDelegation, registerDelegationAutocomplete } from './direct-delegation.ts';
import { registerDirectHandoff } from './direct-handoff.ts';
import { registerHandoff, showHandoffHistory } from './handoff.ts';
import { showGhosttySurfaces } from './ghostty-surfaces.ts';

/**
 * Pi Compose Core: Pi owns sessions and models, Ghostty owns terminals.
 * Only direct USER inputs create agents or send Handoffs.
 *
 * The old tmux/workmux /compose launch/resume and compose_launch model tool
 * are intentionally not registered. Use bare 'pic' to start a new Main,
 * Pi -r/-c for Resume, and >w/>s for user-created agents.
 */
export default function composeExtension(pi: ExtensionAPI): void {
  registerAgentIdentity(pi);
  const { showHandoff, connectedRecipientIds } = registerHandoff(pi);
  registerDirectDelegation(pi);
  registerDelegationAutocomplete(pi);
  registerDirectHandoff(pi, showHandoff, connectedRecipientIds);

  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose surfaces, /compose handoff, /compose messages',
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === 'surfaces') {
        await showGhosttySurfaces(ctx);
        return;
      }
      if (command === 'handoff') {
        await showHandoff(ctx);
        return;
      }
      if (command === 'messages') {
        await showHandoffHistory(ctx);
        return;
      }
      ctx.ui.notify(
        'Usage: /compose surfaces, /compose handoff, /compose messages. ' +
        'To start an Agent enter >w or >s; to resume use Pi /resume or pic -r.',
        'warning',
      );
    },
  });
}
