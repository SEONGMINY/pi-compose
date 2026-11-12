import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { showReferenceContextReview, type ReviewState } from './handoff-review-ui.ts';
import { zoomForAgent } from './handoff-zoom.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { listProductHandoffSessions, findParentMainSessionId } from '../src/product-sessions.ts';
import { prepareManualHandoffCandidates } from './handoff-candidates.ts';
import { createSelectedHandoffPackage, verifyWorkSource, type HandoffPackage } from '../src/handoff/package.ts';
import { selectContextPackage, withPolicySync } from '../src/handoff/context-review.ts';
import { getWorkPolicyStatus } from './policy-work.ts';
import { putHandoff, readHandoff } from '../src/handoff/store.ts';

const REVIEW_PROGRESS_KEY='pi-compose/context-review-progress';

/** One persistent, truthful progress line; never append it to model context. */
export function createContextReviewProgress(
  setWidget:(key:string,content:string[]|undefined)=>void,
){
  let active=false;
  return {
    update(message:string){
      active=true;
      setWidget(REVIEW_PROGRESS_KEY,['◌ Context Review · '+message+' · 아직 전송하지 않았습니다']);
    },
    clear(){
      if(!active)return;
      active=false;
      setWidget(REVIEW_PROGRESS_KEY,undefined);
    },
  };
}

// Public name remains compatible with existing E2E tests.
export const showContextReview=showReferenceContextReview;

export async function openWorkContextReview(
  pi:ExtensionAPI, ctx:ExtensionContext, announce:(pkg:HandoffPackage)=>void,
  targetMainSessionId?:string, recipientQuery?:string,
):Promise<void> {
  if(!ctx.hasUI||ctx.mode!=='tui')return;
  if(!ctx.isIdle()){
    ctx.ui.notify('Work 응답이 끝난 뒤 컨텍스트 검토를 열 수 있습니다.','warning');
    return;
  }
  const source=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  if(source?.role!=='work'||!source.forkSourceSessionId||!source.forkSourceLeafId){
    ctx.ui.notify('정확한 Fork 출처를 가진 Work에서만 Main Handoff를 보낼 수 있습니다.','warning');
    return;
  }
  const progress=createContextReviewProgress((key,content)=>ctx.ui.setWidget(key,content));
  const zoom=zoomForAgent(ctx);
  progress.update('1/3 수신할 Main 확인 중');
  try {
  let sessions:Awaited<ReturnType<typeof listProductHandoffSessions>>;
  try {sessions=await listProductHandoffSessions(source.product);}
  catch {ctx.ui.notify('현재 프로젝트의 Main 목록을 확인할 수 없습니다.','warning');return;}
  const recipients=sessions.filter(item=>item.role==='main'&&item.id!==source.sessionId);
  const preferred=findParentMainSessionId(sessions,source.sessionId);
  const search=recipientQuery?.trim().toLocaleLowerCase();
  const matching=search?
    recipients.filter(item=>
      item.id.toLocaleLowerCase().includes(search) ||
      item.name.toLocaleLowerCase().includes(search))
    :recipients;
  let target=targetMainSessionId?
    recipients.find(item=>item.id===targetMainSessionId):
    recipientQuery?.trim()?(matching.length===1?matching[0]:undefined):
    recipients.find(item=>item.id===preferred);
  if(targetMainSessionId&&!target) {
    ctx.ui.notify('요청한 Main의 정확한 세션 ID를 확인하지 못했습니다.','warning');return;
  }
  if(!target){
    if(!matching.length) {ctx.ui.notify('이 프로젝트에서 일치하는 Main을 찾지 못했습니다.','warning');return;}
    const labels=matching.map(item=>item.name+' ['+item.id+']');
    const chosen=await ctx.ui.select('결과를 받을 Main',labels);
    if(!chosen)return;
    target=matching[labels.indexOf(chosen)];
  }
  if(!target)return;
  const reportLeaf=ctx.sessionManager.getLeafId();
  const reportSession=ctx.sessionManager.getSessionId();
  progress.update('2/3 Work 결과와 필수 WHY·제약을 함께 분석 중');
  const candidateResult=await prepareManualHandoffCandidates(ctx);
  if(candidateResult.status!=='prepared'){
    ctx.ui.notify('공유할 Work 보고를 준비하지 못했습니다: '+candidateResult.status+
      '. 작업 결과를 Work에 보고한 뒤 다시 시도해주세요.','warning');
    return;
  }
  if(ctx.sessionManager.getSessionId()!==reportSession||
     ctx.sessionManager.getLeafId()!==reportLeaf)return;
  const draft=candidateResult.draft;
  const ids=draft.candidates.map((_c,i)=>'HC'+(i+1));
  progress.update('3/3 기존 원문과 연결 근거 검증 중');
  let full:HandoffPackage;
  let policyAtReview:HandoffPackage['policySync'];
  try{
    full=await createSelectedHandoffPackage(ctx,source,draft,{
      ids,reviewEntryId:draft.sourceLeafId,reviewCreatedAt:draft.createdAt,
    },target.id);
    verifyWorkSource(ctx,full);
    try {policyAtReview=await getWorkPolicyStatus(ctx);}
    catch {policyAtReview={status:'unavailable',pendingDecisionIds:[],withdrawnDecisionIds:[]};}
    full=withPolicySync(full,policyAtReview);
  }catch(error){
    ctx.ui.notify('컨텍스트와 원문 근거 준비 실패: '+String(error)+'. 전송하지 않았습니다.','warning');
    return;
  }
  progress.clear(); // The interactive review replaces the progress indicator.
  // Start from the complete attributed draft. The user can remove items;
  // an empty selection used to hide every Main-facing line on first <.
  let review:ReviewState={selected:ids,focus:0,note:''};
  while(true){
    if(ctx.sessionManager.getSessionId()!==reportSession||
       ctx.sessionManager.getLeafId()!==reportLeaf||!ctx.isIdle()){
      ctx.ui.notify('검토 중 Work 분기가 변경됐습니다. 다시 검토해주세요.','warning');
      return;
    }
    const action=await showContextReview(ctx,full,review,{onToggleZoom:zoom.toggle,zoomState:zoom.state});
    if(action.type==='cancel')return;
    if(action.type==='note'){
      review={selected:action.selected,focus:action.focus,note:review.note};
      const feedback=await ctx.ui.editor(
        '현재 컨텍스트 보완 요청 또는 Main에 전달할 사용자 의견', '');
      if(!feedback?.trim())continue;
      const type=await ctx.ui.select('이 의견을 어떻게 사용할까요?',[
        '선택한 컨텍스트의 근거·WHY를 추가로 찾아보기',
        'Main에 사용자 메모로 첨부',
      ]);
      if(!type)continue;
      if(type==='Main에 사용자 메모로 첨부'){
        review.note=feedback.trim().slice(0,1200);
        continue;
      }
      if(!ctx.model){
        ctx.ui.notify('모델을 사용할 수 없어 추가 근거 검색을 수행하지 못했습니다. 기존 선택은 유지됩니다.','warning');
        continue;
      }
      progress.update('추가 WHY·근거 검색 중');
      try{
        const refined=await createSelectedHandoffPackage(ctx,source,draft,{
          ids,reviewEntryId:draft.sourceLeafId,reviewCreatedAt:draft.createdAt,
          note:feedback.trim().slice(0,1200),
        },target.id);
        verifyWorkSource(ctx,refined);
        const preserved=full.context.every(before=>
          refined.context.some(after=>after.quote===before.quote &&
            after.reason===before.reason &&
            before.requiredByClaimIds.every(id=>after.requiredByClaimIds.includes(id))));
        if(refined.contextAssessment==='unavailable'||!preserved){
          ctx.ui.notify('추가 근거 검색이 불완전하거나 기존 필수 맥락을 유지하지 못했습니다. 이전 검토 내용을 그대로 보존합니다.','warning');
        }else{
          full=withPolicySync(refined,policyAtReview);
          ctx.ui.notify('근거 검색 결과를 갱신했습니다. 선택한 범위는 그대로 유지됩니다.','info');
        }
      }catch(error){
        ctx.ui.notify('근거 보완에 실패했습니다: '+String(error)+'. 기존 선택을 보존합니다.','warning');
      }finally{
        progress.clear();
      }
      continue;
    }
    if(!action.selected.length)return;
    const freshPolicy=await getWorkPolicyStatus(ctx).catch(()=>({
      status:'unavailable' as const,pendingDecisionIds:[],withdrawnDecisionIds:[],
    }));
    if(JSON.stringify(freshPolicy)!==JSON.stringify(policyAtReview)){
      ctx.ui.notify('검토 도중 Main 정책 상태가 변경됐습니다. 새로운 기준으로 Handoff를 다시 확인해주세요.','warning');
      return;
    }
    let final:HandoffPackage;
    try {
      final=selectContextPackage(full,action.selected,
        full.source.forkLeafId+'-'+full.source.workReportEntryId,action.note);
      verifyWorkSource(ctx,final);
    }catch(error){ctx.ui.notify('전송 본문 검증 실패: '+String(error),'warning');return;}
    if(full.contextAssessment==='unavailable'){
      const agree=await ctx.ui.confirm('필수 맥락 미확인',
        '관련 WHY·조건 검색을 완전히 확인하지 못했습니다. 불확실성을 포함한 Work 원문 보고로만 전달할까요?');
      if(!agree){
        review={selected:action.selected,focus:review.focus,note:action.note};
        continue;
      }
    }
    if(ctx.sessionManager.getSessionId()!==reportSession||
       ctx.sessionManager.getLeafId()!==reportLeaf||!ctx.isIdle()){
      ctx.ui.notify('전송 전 Work 분기가 변경됐습니다. 다시 검토해주세요.','warning');return;
    }
    try{
      // Stable id prevents replaying a saved payload after a process restart.
      let existing:HandoffPackage|undefined;
      try{existing=await readHandoff(target.id,final.id);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(existing){
        ctx.ui.notify('동일한 Work 결과와 선택 범위가 이미 Main에 보관돼 있습니다.','info');return;
      }
      await putHandoff(final);
      pi.appendEntry('compose_context_review_sent',{
        packageId:final.id,mainId:target.id,reportEntryId:draft.reportEntryId,
        selectedIds:action.selected,bodyHash:final.finalMessageHash,
      });
      announce(final);
      ctx.ui.notify('승인된 Work 보고를 Main 보관함에 전달했습니다. Main이 수신을 기록하면 별도 내용 심사 없이 참고 보고로 반영됩니다.','info');
    }catch(error){
      ctx.ui.notify('Handoff 저장 실패: '+String(error)+'. 성공으로 표시하지 않았습니다.','error');
    }
    return;
    }
  } finally {
    progress.clear();
    const warning=await zoom.close();
    if(warning&&ctx.hasUI)ctx.ui.notify(warning,'warning');
  }
}
