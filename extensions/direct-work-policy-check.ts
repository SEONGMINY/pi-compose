import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { getWorkPolicyStatus } from './policy-work.ts';
import { planWorkPolicyReview } from '../src/policy/work-review-request.ts';

export function isWorkPolicyShortcut(text:string):boolean{
  return text.trim()==='?p';
}

/**
 * ?p is a Work-owned, optional one-turn review of already-approved Main deltas.
 * The input transform creates the user's ONE normal Pi turn; before_agent_start
 * injects the current policy delta through the existing Work subscriber.
 * No policy registration, Main model call or Handoff is performed here.
 */
export function registerDirectWorkPolicyCheck(pi:ExtensionAPI):void{
  let activeReview:{sessionId:string}|undefined;
  const readOnly=new Set(['read','grep','find','ls','glob']);

  pi.on('input',async(event,ctx)=>{
    if(event.source!=='interactive')return {action:'continue'};
    if(!/^\s*\?p(?:\s|$)/.test(event.text)){
      // A prior transformed turn may have failed to start; do not carry a
      // read-only guard over into an unrelated later user request.
      if(activeReview&&ctx.isIdle())activeReview=undefined;
      return {action:'continue'};
    }
    if(!ctx.hasUI)return {action:'handled'};
    if(!isWorkPolicyShortcut(event.text)){
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify('정책 확인 단축어는 ?p 입니다.','warning');
      return {action:'handled'};
    }
    const identity=readAgentRelationship(ctx.sessionManager.getSessionId(),
      ctx.sessionManager.getEntries());
    if(identity?.role!=='work'){
      ctx.ui.notify('?p는 Work에서 Main의 확정 정책 변경을 확인하는 단축어입니다.','warning');
      return {action:'handled'};
    }
    if(event.images?.length||event.streamingBehavior||!ctx.isIdle()){
      ctx.ui.notify('Work의 현재 응답이 완료된 뒤 ?p만 입력해주세요.','warning');
      return {action:'handled'};
    }
    const sessionId=ctx.sessionManager.getSessionId();
    const leafId=ctx.sessionManager.getLeafId();
    try{
      // Exact owner/freshness check is deliberately on demand, not polled for
      // every Work input. The same Work resolves its own subscribed Main.
      const status=await getWorkPolicyStatus(ctx);
      if(ctx.sessionManager.getSessionId()!==sessionId||
         ctx.sessionManager.getLeafId()!==leafId||!ctx.isIdle()){
        ctx.ui.notify('Work 세션이나 활성 분기가 변경되어 정책 조회를 중단했습니다.','warning');
        return {action:'handled'};
      }
      const plan=planWorkPolicyReview(status);
      if(plan.kind==='notice'){
        ctx.ui.notify(plan.message,plan.level);
        return {action:'handled'};
      }
      activeReview={sessionId};
      return {action:'transform',text:plan.prompt};
    }catch(error){
      ctx.ui.notify('Work 정책 확인 실패: '+String(error),'warning');
      return {action:'handled'};
    }
  });

  // A ?p review may inspect read-only files, but cannot mutate the Work
  // workspace, run shell commands or send reports while the review is active.
  pi.on('tool_call',(event,ctx)=>{
    if(!activeReview||activeReview.sessionId!==ctx.sessionManager.getSessionId())return;
    if(readOnly.has(event.toolName))return;
    return {block:true,reason:'?p is a read-only policy review. Do not run commands, modify files or send Handoffs during this review.'};
  });
  pi.on('agent_settled',(_event,ctx)=>{
    if(activeReview?.sessionId===ctx.sessionManager.getSessionId())
      activeReview=undefined;
  });
  pi.on('agent_end',()=>{activeReview=undefined;});
  pi.on('session_before_switch',()=>{activeReview=undefined;});
  pi.on('session_shutdown',()=>{activeReview=undefined;});
}
