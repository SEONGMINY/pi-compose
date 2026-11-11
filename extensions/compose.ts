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
import { registerDirectPolicyReview } from './direct-policy-review.ts';
import { registerDirectWorkResume, registerWorkResumeAutocomplete } from './direct-resume.ts';

/**
 * The user starts a Work with >w and explicitly shares selected context with <.
 * The Main records approved policy decisions; Work consumes only scoped deltas.
 * A Work-approved Handoff imports by origin/integrity checks without semantic re-review.
 * >r resumes an existing Work; >p reviews unresolved policy candidates.
 */
export default function composeExtension(pi: ExtensionAPI): void {
  registerAgentIdentity(pi);
  const policyReview=registerPolicyMain(pi);
  registerPolicyWork(pi);
  registerDirectPolicyReview(pi,policyReview.openReview);
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
  registerDirectWorkResume(pi);
  registerWorkResumeAutocomplete(pi);
  registerDirectHandoff(pi, contextualHandoff, connectedRecipientIds);

  pi.registerCommand('compose', {
    description: 'Pi Compose: /compose policy, /compose handoff, /compose messages, /compose surfaces',
    handler: async(args,ctx)=>{
      const command=args.trim();
      if(command==='surfaces'){await showGhosttySurfaces(ctx);return;}
      if(command==='policy'){await policyReview.openReview(ctx);return;}
      if(command==='handoff'){
        await contextualHandoff(ctx,{sameProductOnly:true,draft:true,preferParentMain:true});
        return;
      }
      if(command==='messages'){await showHandoffHistory(ctx);return;}
      ctx.ui.notify(
        '사용법: Main에서 >w 새 Work 위임 · Work에서 < Handoff 승인 · Main에서 < 예외 수신 확인. '+
        '기타: >r 기존 Work 재개 · Main에서 >p 정책 후보 확인. '+
        '추가 명령: /compose policy, /compose handoff, /compose messages, /compose surfaces.',
        'warning',
      );
    },
  });
}
