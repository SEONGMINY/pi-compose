import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { listProductHandoffSessions, findParentMainSessionId } from '../src/product-sessions.ts';
import { latestPreparedHandoff } from './handoff-candidates.ts';
import { latestReviewedDraft } from './handoff-ready.ts';
import { createSelectedHandoffPackage, verifyWorkSource } from '../src/handoff/package.ts';
import { putHandoff } from '../src/handoff/store.ts';
import { previewHandoff } from './handoff-inbox.ts';
import type { HandoffPackage } from '../src/handoff/package.ts';

export function registerSelectedHandoffSend(
  pi:ExtensionAPI, announce:(pkg:HandoffPackage)=>void,
) {
  async function sendReviewed(ctx:ExtensionContext, exactRecipientId?:string):Promise<void> {
    if(!ctx.hasUI||ctx.mode!=='tui'||!ctx.isIdle()) return;
    const owner=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
    if(owner?.role!=='work') {
      ctx.ui.notify('선택된 Handoff는 Work에서만 전송할 수 있습니다.','warning');return;
    }
    const prepared=latestPreparedHandoff(ctx);
    const reviewed=prepared&&latestReviewedDraft(ctx,prepared.reportEntryId);
    if(!prepared||!reviewed||!reviewed.selectedCandidateIds?.length) {
      ctx.ui.notify('선택된 후보 기록을 찾을 수 없습니다. /compose review로 다시 선택하세요.','warning');return;
    }
    const prior=ctx.sessionManager.getBranch().some(entry=>
      entry.type==='custom'&&entry.customType==='compose_handoff_package_accepted'&&
      entry.data && typeof entry.data==='object'&&!Array.isArray(entry.data)&&
      (entry.data as Record<string,unknown>).reviewEntryId===reviewed.reviewEntryId);
    if(prior) {ctx.ui.notify('이 검토의 Handoff는 이미 수신 보관함에 저장했습니다.','info');return;}

    const recipients=(await listProductHandoffSessions(owner.product))
      .filter(session=>session.role==='main'&&session.id!==owner.sessionId);
    const preferred=findParentMainSessionId(
      await listProductHandoffSessions(owner.product),owner.sessionId);
    let destination=exactRecipientId
      ? recipients.find(recipient=>recipient.id===exactRecipientId)
      : recipients.find(recipient=>recipient.id===preferred);
    if(exactRecipientId && !destination){
      ctx.ui.notify('요청한 수신자가 같은 프로덕트의 확인된 Main이 아닙니다.','warning');return;
    }
    if(!destination){
      if(!recipients.length){
        ctx.ui.notify('같은 프로덕트의 정확한 Main 세션을 찾을 수 없습니다.','warning');return;
      }
      const labels=recipients.map((recipient,i)=>
        (i+1)+'. '+recipient.name+' ['+recipient.id+']');
      const chosen=await ctx.ui.select('받는 Main 선택 (Pi Session ID 검증)',labels);
      if(!chosen)return;
      destination=recipients[labels.indexOf(chosen)];
    }
    if(!destination || !ctx.isIdle() ||
       ctx.sessionManager.getSessionId()!==owner.sessionId)return;

    const packageStartLeaf=ctx.sessionManager.getLeafId();
    ctx.ui.notify('선택된 후보의 필수 맥락과 근거를 준비합니다. Main 대화는 조회하지 않습니다.','info');
    let pkg:HandoffPackage;
    try {
      pkg=await createSelectedHandoffPackage(ctx,owner,prepared,{
        ids:reviewed.selectedCandidateIds,note:reviewed.reviewerNote,
      },destination.id);
      verifyWorkSource(ctx,pkg);
    } catch(error){
      ctx.ui.notify('Handoff 구성/근거 검증 실패: '+String(error)+'. Main으로 전달하지 않았습니다.','warning');
      return;
    }
    if(ctx.sessionManager.getLeafId()!==packageStartLeaf)return;
    if(pkg.contextAssessment==='unavailable'){
      ctx.ui.notify('필수 맥락 검색이 실패했습니다. 원문이 확인된 후보만 포함했습니다. 전송 전 검토하세요.','warning');
    }
    const action=await previewHandoff(ctx,pkg,'outgoing');
    if(action!=='send') {
      ctx.ui.notify('Handoff 전송을 보류했습니다. Main에는 아무것도 추가되지 않았습니다.','info');
      return;
    }
    if(ctx.sessionManager.getLeafId()!==packageStartLeaf ||
       ctx.sessionManager.getSessionId()!==owner.sessionId||
       !ctx.isIdle()){
      ctx.ui.notify('검토 중 Work 세션/분기가 변경됐습니다. 전송하지 않았습니다.','warning');return;
    }
    try {
      verifyWorkSource(ctx,pkg);
      // Store the *exact* previewed body first. No model call may rewrite it.
      const saved=await putHandoff(pkg);
      pi.appendEntry('compose_handoff_package_accepted',{
        packageId:pkg.id,reviewEntryId:reviewed.reviewEntryId,
        targetMainSessionId:pkg.targetMainSessionId,finalMessageHash:pkg.finalMessageHash,
        saved,timestamp:new Date().toISOString(),
      });
      announce(pkg); // Best-effort UI notification; never delivery authority.
      ctx.ui.notify('Handoff가 Main의 비컨텍스트 보관함에 저장됐습니다. Main은 /compose inbox에서 검토합니다.','info');
    } catch(error){
      ctx.ui.notify('Handoff 보관 실패: '+String(error)+'. 완료된 전송으로 표시하지 않습니다.','error');
    }
  }
  return {sendReviewed};
}
