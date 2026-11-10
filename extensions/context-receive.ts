import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { showReferenceReceived } from './handoff-received-ui.ts';
import { zoomForAgent } from './handoff-zoom.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import { type HandoffPackage } from '../src/handoff/package.ts';
import { compareHandoffWithMain, type MainComparison } from '../src/handoff/compare.ts';
import { renderMainImport } from '../src/handoff/import.ts';
import { listInbox, setInboxStatus, type InboxItem } from '../src/handoff/store.ts';
import { decideAutomaticAdoption } from '../src/handoff/automatic-adoption.ts';

const IMPORT_TYPE='compose_context_review_import';

export function hasImportReceipt(ctx:ExtensionContext,id:string):boolean {
  return ctx.sessionManager.getBranch().some(entry=>
    entry.type==='custom_message'&&entry.customType===IMPORT_TYPE&&
    entry.details && typeof entry.details==='object'&&!Array.isArray(entry.details)&&
    (entry.details as Record<string,unknown>).packageId===id);
}

/** The Main's < opens received context in place, without an Inbox command. */
export async function openMainContextReceive(
  pi:ExtensionAPI,ctx:ExtensionContext,
):Promise<void> {
  if(!ctx.hasUI||ctx.mode!=='tui')return;
  const main=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  if(main?.role!=='main'){
    ctx.ui.notify('이 작업은 Main에서만 가능합니다.','warning');return;
  }
  if(!ctx.isIdle()){
    ctx.ui.notify('Main 응답이 끝난 뒤 결과를 확인할 수 있습니다.','warning');return;
  }
  let items:InboxItem[];
  try {
    const all=(await listInbox(main.sessionId)).filter(item=>item.pkg.product===main.product);
    // Recover receipts that were written to the Pi session before status
    // persistence, e.g. a crash or delayed message_end event.
    for(const item of all){
      if(item.status.status==='import-requested'&&hasImportReceipt(ctx,item.pkg.id)){
        await setInboxStatus(main.sessionId,item.pkg.id,'imported');
      }
    }
    // Imported state is global storage metadata; the actual Pi receipt is
    // branch-local. A user who rewinds to a branch without that receipt must
    // be able to choose the context again rather than lose it permanently.
    items=(await listInbox(main.sessionId)).filter(item=>
      item.pkg.product===main.product&&
      (item.status.status==='pending'||item.status.status==='requires-review' ||
        ((item.status.status==='imported'||item.status.status==='import-requested') &&
          !hasImportReceipt(ctx,item.pkg.id))));
  }catch(error){
    ctx.ui.notify('받은 Handoff 확인 실패: '+String(error),'warning');return;
  }
  if(!items.length){
    ctx.ui.notify('확인할 Work 결과가 없습니다.','info');return;
  }
  let item=items[0];
  if(items.length>1){
    // pi-intercom recipient picker pattern: compact list, origin and status
    // visible before expanding an individual received message.
    const labels=items.map((i,index)=>{
      const title=i.pkg.claims.map(c=>c.title).join(' / ').slice(0,60);
      const status=i.status.status==='requires-review'?'확인 필요'
        :i.status.status==='pending'?'안전 검사 대기':'분기 재확인';
      return (index+1)+'. '+title+' · '+status+
        ' · Work '+i.pkg.source.workSessionId.slice(0,8);
    });
    const selected=await ctx.ui.select('Main · 확인이 필요한 Work 결과',labels);
    if(!selected)return;
    item=items[labels.indexOf(selected)];
  }
  if(!item)return;
  const comparedLeafId=ctx.sessionManager.getLeafId();
  if(!comparedLeafId)return;
  let comparison:MainComparison|undefined;
  let error:string|undefined;
  try{comparison=await compareHandoffWithMain(ctx,item.pkg);}
  catch(e){error=e instanceof Error?e.message:'대조를 완료하지 못했습니다';}
  if(ctx.sessionManager.getSessionId()!==main.sessionId||
     ctx.sessionManager.getLeafId()!==comparedLeafId||!ctx.isIdle())return;
  // A new Brief is reviewed by the sender and imported verbatim; older stored
  // packages retain their legacy partial-import presentation.
  const importText=item.pkg.approvedMainBrief ??
    (comparison?renderMainImport(item.pkg,comparison):undefined);
  // The exception is already held outside Main context; give the review
  // enough space without opening another agent or changing session state.
  const zoom=zoomForAgent(ctx);
  try{
  const open=await showReferenceReceived(ctx,item.pkg,comparison,error,importText,{
    onToggleZoom:zoom.toggle,
  });
  if(!open)return;
  const actions=importText && !error
    ? ['확인한 Brief를 Work 보고로 그대로 반영 (정책 승인 아님)','나중에 확인','무시']
    : ['나중에 확인','무시'];
  const choice=await ctx.ui.select('이 결과를 어떻게 처리할까요?',actions);
  if(!choice||choice==='나중에 확인')return;
  if(ctx.sessionManager.getSessionId()!==main.sessionId||
     ctx.sessionManager.getLeafId()!==comparedLeafId||!ctx.isIdle()){
    ctx.ui.notify('Main의 활성 분기가 변경됐습니다. 다시 확인해주세요.','warning');return;
  }
  if(choice==='무시'){
    await setInboxStatus(main.sessionId,item.pkg.id,'archived',comparedLeafId);
    ctx.ui.notify('결과를 Main에 반영하지 않았습니다.','info');
    return;
  }
  if(!importText||!comparison||choice!==actions[0])return;
  // Mark only the request, not a completed import, until Pi has recorded the
  // custom message on the active Main session. The receipt event settles it.
  try {
    await setInboxStatus(main.sessionId,item.pkg.id,'import-requested',comparedLeafId);
    pi.sendMessage({
      customType:IMPORT_TYPE,
      content:importText,display:true,
      details:{packageId:item.pkg.id,mainSessionId:main.sessionId,
        comparedLeafId,sourceWorkSessionId:item.pkg.source.workSessionId},
    },{triggerTurn:false});
    ctx.ui.notify('선택한 Work 보고를 Main 대화에 반영하도록 요청했습니다. 내용은 재작성하지 않고, 정책 승인은 아닙니다.','info');
  }catch(error){
    ctx.ui.notify('Main 반영 요청 실패: '+String(error)+'. 실제 반영 여부를 확인해주세요.','error');
  }
  }finally{
    const warning=await zoom.close();
    if(warning&&ctx.hasUI)ctx.ui.notify(warning,'warning');
  }
}

export function registerMainContextImportReceipts(pi:ExtensionAPI):void {
  pi.on('message_end',async(event,ctx)=>{
    const msg=event.message;
    if(msg.role!=='custom'||msg.customType!==IMPORT_TYPE||
       !msg.details||typeof msg.details!=='object'||Array.isArray(msg.details))return;
    const details=msg.details as Record<string,unknown>;
    const mainId=ctx.sessionManager.getSessionId();
    if(details.mainSessionId!==mainId||typeof details.packageId!=='string')return;
    try{
      await setInboxStatus(mainId,details.packageId,'imported',
        typeof details.comparedLeafId==='string'?details.comparedLeafId:undefined);
      if(ctx.hasUI&&details.automaticReferenceImport===true)
        ctx.ui.notify('Work에서 승인한 Brief가 Main에 참고 보고로 기록됐습니다. 모델 실행·정책 승인은 아닙니다.','info');
    }
    catch(error){
      if(ctx.hasUI)ctx.ui.notify('반영 기록 저장 실패: '+String(error)+'. 세션 재개 시 복구할 수 있습니다.','warning');
    }
  });
}


/**
 * A Work user already approved the *exact* Brief. On the intended Main, add
 * that same Brief as a source-attributed Work report when latest-branch checks
 * find no conflict. Do not start a Main model turn or approve a product policy.
 *
 * Only the Main process can examine the current Main projection and append its
 * custom message. If offline, the durable package remains pending until the
 * original Main session is resumed. Uncertain cases stay outside context.
 */
export function registerAutomaticMainAdoption(pi:ExtensionAPI):{
  onAvailable:(ctx:ExtensionContext)=>void;
}{
  const processing=new Set<string>();
  const retryAfterCurrent=new Set<string>();
  async function check(ctx:ExtensionContext):Promise<void>{
    if(!ctx.isIdle()||!ctx.model)return;
    const owner=readAgentRelationship(
      ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
    if(owner?.role!=='main')return;
    const mainId=owner.sessionId;
    if(processing.has(mainId)){
      // A new Work Handoff can arrive while an earlier one is comparing.
      // Do not lose the notification just because the first scan is active.
      retryAfterCurrent.add(mainId);
      return;
    }
    processing.add(mainId);
    const statusKey='pi-compose/auto-adopt';
    try{
      const items=(await listInbox(mainId)).filter(item=>
        item.pkg.product===owner.product &&
        (item.status.status==='pending'||item.status.status==='import-requested'));
      for(const item of items){
        if(!ctx.isIdle()||ctx.sessionManager.getSessionId()!==mainId)break;
        const pkg=item.pkg;
        if(hasImportReceipt(ctx,pkg.id)){
          if(item.status.status!=='imported')await setInboxStatus(mainId,pkg.id,'imported');
          continue;
        }
        const baseLeaf=ctx.sessionManager.getLeafId();
        if(!baseLeaf)break;
        const activeEntries=ctx.sessionManager.getBranch();
        const branchIds=new Set(activeEntries.map(entry=>entry.id));
        // A request that may have reached a different branch must not be
        // automatically replayed into a rewound or unrelated branch.
        if(item.status.status==='import-requested' &&
           (!item.status.comparedLeafId || !branchIds.has(item.status.comparedLeafId)))
          continue;
        if(!pkg.approvedMainBrief||!pkg.approvedMainBriefHash ||
           pkg.source.forkSourceSessionId!==mainId ||
           !branchIds.has(pkg.source.forkLeafId) ||
           pkg.contextAssessment==='unavailable'){
          await setInboxStatus(mainId,pkg.id,'requires-review',baseLeaf);
          ctx.ui.notify('Work 결과에 Main의 확인이 필요한 출처·맥락이 있습니다. < 로 확인해주세요.','warning');
          continue;
        }
        let comparison:MainComparison;
        try{
          if(ctx.hasUI)ctx.ui.setStatus(statusKey,'Work 결과와 현재 Main 결정 비교 중');
          comparison=await compareHandoffWithMain(ctx,pkg);
        }catch{
          // JSON/model failures are not proof of safety, nor proof of conflict.
          if(ctx.sessionManager.getSessionId()===mainId &&
             ctx.sessionManager.getLeafId()===baseLeaf)
            await setInboxStatus(mainId,pkg.id,'requires-review',baseLeaf);
          if(ctx.hasUI)ctx.ui.notify('Work 보고의 자동 비교를 완료하지 못했습니다. 원문은 보관됐으며 Main에서 < 로 확인할 수 있습니다.','warning');
          break;
        }finally{
          if(ctx.hasUI)ctx.ui.setStatus(statusKey,undefined);
        }
        if(!ctx.isIdle()||ctx.sessionManager.getSessionId()!==mainId ||
           ctx.sessionManager.getLeafId()!==baseLeaf)break;
        const decision=decideAutomaticAdoption(pkg,comparison,mainId,branchIds);
        if(decision.action==='hold'){
          await setInboxStatus(mainId,pkg.id,'requires-review',baseLeaf);
          if(ctx.hasUI)ctx.ui.notify(
            'Work Handoff 일부가 현재 Main과 충돌하거나 불확실합니다. 자동 반영하지 않고 보관했습니다. < 로 확인해주세요.','warning');
          continue;
        }
        if(decision.action==='duplicate'){
          await setInboxStatus(mainId,pkg.id,'duplicate',baseLeaf);
          if(ctx.hasUI)ctx.ui.notify('Work 결과가 현재 Main에 이미 있어 중복 반영하지 않았습니다.','info');
          continue;
        }
        // This is a custom Work report, not a new human policy decision.
        // Persist the intent first; message_end and active-branch receipt
        // reconcile the durable status after Pi actually appends the message.
        await setInboxStatus(mainId,pkg.id,'import-requested',baseLeaf);
        pi.sendMessage({
          customType:IMPORT_TYPE,
          content:pkg.approvedMainBrief!,
          display:true,
          details:{
            packageId:pkg.id,mainSessionId:mainId,
            comparedLeafId:baseLeaf,
            sourceWorkSessionId:pkg.source.workSessionId,
            approvedMainBriefHash:pkg.approvedMainBriefHash,
            userApprovedInWork:true,automaticReferenceImport:true,
          },
        },{triggerTurn:false});
        if(ctx.hasUI)ctx.ui.notify('Work에서 승인한 Brief의 Main 기록을 요청했습니다. 기록 확인 전까지 완료로 판단하지 않습니다.','info');
      }
    }catch(error){
      if(ctx.hasUI)ctx.ui.notify('Main Handoff 자동 처리 중 오류가 발생했습니다. 보관된 결과는 유지됩니다: '+String(error),'warning');
    }finally{
      if(ctx.hasUI){
        ctx.ui.setStatus(statusKey,undefined);
        // Refresh the passive notification after async comparisons settle.
        // There is no Main agent turn to trigger an ordinary UI refresh.
        try{
          if(ctx.sessionManager.getSessionId()===mainId){
            const current=(await listInbox(mainId)).filter(item=>item.pkg.product===owner.product);
            const held=current.filter(item=>item.status.status==='requires-review');
            const waiting=current.filter(item=>item.status.status==='pending');
            ctx.ui.setWidget('pi-compose/main-inbox',held.length
              ? ['Main · 확인이 필요한 Work 결과 '+held.length+'건 · < 로 확인']
              :waiting.length
                ? ['Main · Work 결과 '+waiting.length+'건 안전 검사 대기 중']
                :undefined);
          }
        }catch{/* The durable store remains authoritative, even if UI refresh fails. */}
      }
      processing.delete(mainId);
      if(retryAfterCurrent.delete(mainId)&&ctx.isIdle()&&
         ctx.sessionManager.getSessionId()===mainId)void check(ctx);
    }
  }
  const onAvailable=(ctx:ExtensionContext)=>{void check(ctx);};
  // A pending package is durable, so a fresh Main may recover it without
  // any intercom message. Do not do work on Work/Support sessions.
  pi.on('session_start',(_event,ctx)=>onAvailable(ctx));
  pi.on('session_tree',(_event,ctx)=>onAvailable(ctx));
  pi.on('agent_settled',(_event,ctx)=>onAvailable(ctx));
  pi.on('model_select',(_event,ctx)=>onAvailable(ctx));
  return {onAvailable};
}
