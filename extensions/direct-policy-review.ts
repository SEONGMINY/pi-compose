import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';

export function isPolicyReviewShortcut(text:string):boolean {
  return text.trim()==='>p';
}

/**
 * >p is a Main-only, zero-model-turn way to resolve a stuck policy candidate.
 * Work reports do not have authority to amend Main user approval records.
 */
export function registerDirectPolicyReview(
  pi:ExtensionAPI,openReview:(ctx:ExtensionContext)=>Promise<void>,
):void{
  let inFlight=false;
  pi.on('input',async(event,ctx)=>{
    if(event.source!=='interactive'||!/^>p(?:\s|$)/.test(event.text))
      return {action:'continue'};
    if(!ctx.hasUI)return {action:'handled'};
    if(!isPolicyReviewShortcut(event.text)){
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify('정책 후보 확인 단축어는 >p 입니다.','warning');
      return {action:'handled'};
    }
    if(event.images?.length||event.streamingBehavior){
      ctx.ui.notify('Main 응답이 끝난 뒤, 이미지 없이 >p만 입력해주세요.','warning');
      return {action:'handled'};
    }
    if(inFlight){
      ctx.ui.notify('이미 정책 후보 확인 창이 열려 있습니다.','warning');
      return {action:'handled'};
    }
    const owner=readAgentRelationship(
      ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
    if(owner?.role!=='main'){
      ctx.ui.notify('Main 승인 후보는 Main에서만 분류합니다. 소유 Main으로 이동한 후 >p를 입력해주세요.','warning');
      return {action:'handled'};
    }
    inFlight=true;
    try{await openReview(ctx);}
    catch(error){ctx.ui.notify('정책 후보 확인 실패: '+String(error),'warning');}
    finally{inFlight=false;}
    return {action:'handled'};
  });
}
