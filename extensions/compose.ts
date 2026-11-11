import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerAgentIdentity } from './agent-identity.ts';
import { registerDirectDelegation, registerDelegationAutocomplete } from './direct-delegation.ts';
import { registerDirectHandoff } from './direct-handoff.ts';
import { registerHandoff, showHandoffHistory } from './handoff.ts';
import { showGhosttySurfaces } from './ghostty-surfaces.ts';
import { registerHandoffInbox } from './handoff-inbox.ts';
import { openWorkContextReview } from './context-review.ts';
import { openMainContextReceive, registerMainContextImportReceipts, registerAutomaticMainAdoption } from './context-receive.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { registerPolicyMain } from './policy-main.ts';
import { registerPolicyWork } from './policy-work.ts';

/**
 * The user starts a Work with >w and explicitly shares selected context with <.
 * The Main compares its current branch without starting a Main agent turn.
 * Work's one approval imports only source-attributed, conflict-free reports;
 * other results stay outside context until Main's exceptional < review.
 */
export default function composeExtension(pi: ExtensionAPI): void {
  registerAgentIdentity(pi);
  registerPolicyMain(pi);
  registerPolicyWork(pi);
  const { showHandoff, connectedRecipientIds } = registerHandoff(pi);
  const mainAdoption=registerAutomaticMainAdoption(pi);
  const receiver = registerHandoffInbox(pi,mainAdoption.onAvailable);
  registerMainContextImportReceipts(pi);
  const contextualHandoff = async (
    ctx:ExtensionContext,
    options?:Parameters<typeof showHandoff>[1],
  ) => {
    const identity=readAgentRelationship(
      ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
    if(identity?.role==='work'){
      await openWorkContextReview(pi,ctx,receiver.announce,
        options?.exactRecipientId,options?.recipientQuery);
      return;
    }
    if(identity?.role==='main'){
      await openMainContextReceive(pi,ctx);
      return;
    }
    // Retain the legacy explicit Support-to-Work and Work-to-Work intercom path.
    await showHandoff(ctx,options);
  };
  registerDirectDelegation(pi);
  registerDelegationAutocomplete(pi);
  registerDirectHandoff(pi, contextualHandoff, connectedRecipientIds);

  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose handoff, /compose messages, /compose surfaces',
    handler: async(args,ctx)=>{
      const command=args.trim();
      if(command==='surfaces'){await showGhosttySurfaces(ctx);return;}
      if(command==='handoff'){
        await contextualHandoff(ctx,{sameProductOnly:true,draft:true,preferParentMain:true});
        return;
      }
      if(command==='messages'){await showHandoffHistory(ctx);return;}
      ctx.ui.notify(
        '사용법: Main에서 >w 작업 위임 · Work에서 < Handoff Brief 승인 · Main에서 < 예외 결과 확인. '+
        '추가 명령: /compose handoff, /compose messages, /compose surfaces.',
        'warning',
      );
    },
  });
}
