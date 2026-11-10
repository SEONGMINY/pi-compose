import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerAgentIdentity } from './agent-identity.ts';
import { registerDirectDelegation, registerDelegationAutocomplete } from './direct-delegation.ts';
import { registerDirectHandoff } from './direct-handoff.ts';
import { registerHandoff, showHandoffHistory } from './handoff.ts';
import { registerHandoffReady } from './handoff-ready.ts';
import { showGhosttySurfaces } from './ghostty-surfaces.ts';
import { registerHandoffInbox } from './handoff-inbox.ts';
import { registerSelectedHandoffSend } from './handoff-package.ts';
import { latestReviewedDraft } from './handoff-ready.ts';
import { latestPreparedHandoff } from './handoff-candidates.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';

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
  const inbox = registerHandoffInbox(pi);
  const { sendReviewed } = registerSelectedHandoffSend(pi, inbox.announce);
  // A manual < @Main request may precede the ask_user review. Retain its
  // explicitly resolved Pi session ID, never infer a recipient from a title.
  const manualRecipientByWork = new Map<string,string>();
  const { openSavedReview, showHandoffStatus } = registerHandoffReady(pi, async (ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const requested = manualRecipientByWork.get(sessionId);
    manualRecipientByWork.delete(sessionId);
    await sendReviewed(ctx, requested);
  });
  const safeWorkHandoff = async (
    ctx: Parameters<typeof sendReviewed>[0],
    options?: Parameters<typeof showHandoff>[1],
  ) => {
    const identity = readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
    if(identity?.role !== 'work') {
      await showHandoff(ctx,options);
      return;
    }
    if(options?.exactRecipientId)
      manualRecipientByWork.set(identity.sessionId,options.exactRecipientId);
    const prepared = latestPreparedHandoff(ctx);
    const reviewed = prepared && latestReviewedDraft(ctx,prepared.reportEntryId);
    if(reviewed?.selectedCandidateIds.length){
      const requested = manualRecipientByWork.get(identity.sessionId);
      manualRecipientByWork.delete(identity.sessionId);
      await sendReviewed(ctx,requested);
    } else {
      await openSavedReview(ctx);
    }
  };
  registerDirectDelegation(pi);
  registerDelegationAutocomplete(pi);
  registerDirectHandoff(pi, safeWorkHandoff, connectedRecipientIds);

  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose inbox, /compose review, /compose handoff-status, /compose handoff, /compose messages, /compose surfaces',
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === 'surfaces') {
        await showGhosttySurfaces(ctx);
        return;
      }
      if (command === 'inbox') {
        await inbox.showInbox(ctx);
        return;
      }
      if (command === 'review') {
        await openSavedReview(ctx);
        return;
      }
      if (command === 'handoff-status') {
        showHandoffStatus(ctx);
        return;
      }
      if (command === 'handoff') {
        await safeWorkHandoff(ctx,{sameProductOnly:true,draft:true,preferParentMain:true});
        return;
      }
      if (command === 'messages') {
        await showHandoffHistory(ctx);
        return;
      }
      ctx.ui.notify(
        'Usage: /compose inbox, /compose review, /compose handoff-status, /compose handoff, /compose messages, /compose surfaces. ' +
        'To start an Agent enter >w or >s; to resume use Pi /resume or pic -r.',
        'warning',
      );
    },
  });
}
