import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { listProductHandoffSessions, findParentMainSessionId } from '../src/product-sessions.ts';
import { latestPreparedHandoff } from './handoff-candidates.ts';
import { latestReviewedDraft } from './handoff-ready.ts';
import { createSelectedHandoffPackage, stablePackageId, verifyWorkSource } from '../src/handoff/package.ts';
import { putHandoff, readHandoff } from '../src/handoff/store.ts';
import { previewHandoff } from './handoff-inbox.ts';
import { assessHandoffQuality } from '../src/handoff/quality.ts';
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
    // A later Work conversation may change implementation or requirements after
    // the user's last review. Never silently ship an old reviewed snapshot.
    const activeBranch=ctx.sessionManager.getBranch();
    const reviewPosition=activeBranch.findIndex(entry=>entry.id===reviewed.reviewEntryId);
    if(reviewPosition<0 || activeBranch.slice(reviewPosition+1).some(entry=>
      entry.type==='message' &&
      (entry.message.role==='user'||entry.message.role==='assistant'||entry.message.role==='toolResult'))) {
      ctx.ui.notify('후보 검토 이후 Work 대화가 변경됐습니다. 새로운 작업 결과를 기준으로 다시 검토해야 합니다.','warning');
      return;
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
    let reviewNote=reviewed.reviewerNote ?? '';
    let pkg:HandoffPackage|undefined;
    let approved=false;
    // The reviewer may request source-backed refinements without accepting
    // freeform model rewrites or letting the model send anything.
    for(let attempt=0;attempt<4;attempt++){
      if(ctx.sessionManager.getLeafId()!==packageStartLeaf ||
         ctx.sessionManager.getSessionId()!==owner.sessionId||!ctx.isIdle())return;
      const expectedId=stablePackageId(owner.sessionId,prepared.reportEntryId,
        reviewed.reviewEntryId,destination.id,reviewed.selectedCandidateIds,reviewNote);
      let recovered=false;
      // Recover a previously approved and durably stored body if Work crashed
      // before recording the session-local acceptance receipt.
      try {
        pkg=await readHandoff(destination.id,expectedId);
        if(pkg.product!==owner.product ||
            pkg.source.workSessionId!==owner.sessionId ||
            pkg.source.workReportEntryId!==prepared.reportEntryId ||
            pkg.selectedCandidateIds.join(',')!==reviewed.selectedCandidateIds.join(','))
          throw Error('stored-handoff-review-mismatch');
        verifyWorkSource(ctx,pkg);
        recovered=true;
      } catch(error) {
        if((error as NodeJS.ErrnoException).code!=='ENOENT'){
          ctx.ui.notify('기존 Handoff 복구 검증 실패: '+String(error),'warning');return;
        }
        ctx.ui.notify('선택된 후보의 필수 맥락과 근거를 준비합니다. Main 대화는 조회하지 않습니다.','info');
        try {
          pkg=await createSelectedHandoffPackage(ctx,owner,prepared,{
            ids:reviewed.selectedCandidateIds,note:reviewNote,
            reviewEntryId:reviewed.reviewEntryId,reviewCreatedAt:reviewed.createdAt,
          },destination.id);
          verifyWorkSource(ctx,pkg);
        } catch(error) {
          ctx.ui.notify('Handoff 구성/근거 검증 실패: '+String(error)+'. Main으로 전달하지 않았습니다.','warning');
          return;
        }
      }
      if(ctx.sessionManager.getLeafId()!==packageStartLeaf)return;
      const blockingIssues:string[]=[];
      if(!recovered){
        try {
          const quality=await assessHandoffQuality(ctx,pkg);
          if(quality.verdict==='needs-revision')
            blockingIssues.push(...quality.issues.map(issue=>
              '['+issue.candidateId+' · '+issue.kind+'] '+issue.explanation));
        } catch(error) {
          blockingIssues.push('의미·누락 검증이 완료되지 않았습니다: '+String(error));
        }
      }
      if(pkg.contextAssessment==='unavailable'&&!recovered)
        blockingIssues.push('필수 맥락 검색 실패: 원문 후보만으로 충분한지 확인되지 않았습니다.');
      if(ctx.sessionManager.getLeafId()!==packageStartLeaf)return;
      const action=await previewHandoff(ctx,pkg,'outgoing',undefined,blockingIssues);
      if(action==='send'){approved=true;break;}
      if(action==='later')return;
      if(action==='revise'){
        if(attempt===3){
          ctx.ui.notify('보완 재시도 횟수를 초과했습니다. 변경된 본문은 발송되지 않습니다.','warning');return;
        }
        const note=await ctx.ui.input('Work Agent에게 보완 요청 (근거 없는 사실 추가 금지)','예: 기존 제약의 WHY와 테스트 미확인 상태를 분명히 해주세요');
        if(!note?.trim())return;
        reviewNote=(reviewNote+'\n'+note.trim()).trim().slice(0,1200);
        continue;
      }
    }
    if(!pkg||!approved)return;
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
