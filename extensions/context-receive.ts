import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { showReferenceReceived } from './handoff-received-ui.ts';
import { zoomForAgent } from './handoff-zoom.ts';
import { readAgentRelationship } from '../src/agent-relationships.ts';
import type { HandoffPackage } from '../src/handoff/package.ts';
import { listInbox, setInboxStatus, watchHandoffPackages } from '../src/handoff/store.ts';
import { decideDirectReferenceImport, workOriginOnMainBranch } from '../src/handoff/direct-adoption.ts';

const IMPORT_TYPE='compose_context_review_import';
function textFromContent(content:unknown):string {
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.flatMap((p:unknown):string[]=>{
    if(!p||typeof p!=='object'||!('type' in p)||p.type!=='text'||
       !('text' in p)||typeof p.text!=='string')return [];
    return [p.text];
  }).join('\n');
}

export function hasImportReceipt(ctx:ExtensionContext,id:string):boolean {
  return ctx.sessionManager.getBranch().some(e=>
    e.type==='custom_message'&&e.customType===IMPORT_TYPE &&
    e.details&&typeof e.details==='object'&&!Array.isArray(e.details) &&
    (e.details as Record<string,unknown>).packageId===id);
}
export function hasImportedIdenticalWorkBrief(ctx:ExtensionContext,pkg:HandoffPackage):boolean {
  if(!pkg.approvedMainBrief||!pkg.approvedMainBriefHash)return false;
  return ctx.sessionManager.getBranch().some(e=>{
    if(e.type!=='custom_message'||e.customType!==IMPORT_TYPE||
       !e.details||typeof e.details!=='object'||Array.isArray(e.details))return false;
    const details=e.details as Record<string,unknown>;
    return details.approvedMainBriefHash===pkg.approvedMainBriefHash &&
      details.sourceWorkSessionId===pkg.source.workSessionId &&
      textFromContent(e.content)===pkg.approvedMainBrief;
  });
}
function mainOwner(ctx:ExtensionContext){
  const owner=readAgentRelationship(ctx.sessionManager.getSessionId(),ctx.sessionManager.getEntries());
  return owner?.role==='main'?owner:undefined;
}

function requestImport(pi:ExtensionAPI,mainId:string,pkg:HandoffPackage,leaf:string,automatic:boolean){
  pi.sendMessage({
    customType:IMPORT_TYPE,content:pkg.approvedMainBrief!,display:true,
    details:{
      packageId:pkg.id,mainSessionId:mainId,comparedLeafId:leaf,
      sourceWorkSessionId:pkg.source.workSessionId,
      approvedMainBriefHash:pkg.approvedMainBriefHash,
      userApprovedInWork:true,automaticReferenceImport:automatic,
    },
  },{triggerTurn:false});
}

/** Exceptions only: a normal approved Work report never requires Main <. */
export async function openMainContextReceive(pi:ExtensionAPI,ctx:ExtensionContext):Promise<void>{
  const owner=mainOwner(ctx);
  if(!owner||!ctx.hasUI||ctx.mode!=='tui')return;
  if(!ctx.isIdle()){ctx.ui.notify('Main 응답 종료 후 확인할 수 있습니다.','warning');return;}
  let items;
  try{
    items=(await listInbox(owner.sessionId)).filter(x=>
      x.pkg.product===owner.product&&!hasImportReceipt(ctx,x.pkg.id) &&
      (x.status.status==='requires-review'||x.status.status==='pending' ||
       x.status.status==='imported'||x.status.status==='import-requested'));
  }catch(error){ctx.ui.notify('수신 목록 확인 실패: '+String(error),'warning');return;}
  if(!items.length){ctx.ui.notify('예외로 확인할 Work 보고가 없습니다.','info');return;}
  const labels=items.map((item,i)=>
    (i+1)+'. '+item.pkg.claims.map(c=>c.title).join(' / ').slice(0,66)+
    ' · '+item.status.status+' · '+item.pkg.source.workSessionId.slice(0,8));
  const selected=await ctx.ui.select('Main · 보류된 Work 보고',labels);
  if(!selected)return;
  const item=items[labels.indexOf(selected)];
  if(!item)return;
  const leaf=ctx.sessionManager.getLeafId();
  if(!leaf)return;
  const branch=new Set(ctx.sessionManager.getBranch().map(e=>e.id));
  let reason='Main의 기존 분기와 원본 Work의 계보 확인 필요';
  try{
    const valid=await workOriginOnMainBranch(item.pkg,owner.sessionId,branch);
    const outcome=decideDirectReferenceImport(item.pkg,owner.sessionId,valid);
    reason=outcome.action==='import'
      ?'전달이 보류됐습니다. Main의 현재 분기를 다시 확인할 수 있습니다.'
      :outcome.reason;
  }catch(error){reason='Work 출처 확인 오류: '+String(error);}
  const zoom=zoomForAgent(ctx);
  try{
    const opened=await showReferenceReceived(ctx,item.pkg,undefined,reason,
      item.pkg.approvedMainBrief,{onToggleZoom:zoom.toggle});
    if(!opened)return;
    const options=item.pkg.approvedMainBrief
      ?['현재 분기에 Work 참고 보고로 명시적으로 추가 (기존 정책 변경 아님)',
         '나중에 확인','보관함에서 숨기기']
      :['나중에 확인','보관함에서 숨기기'];
    const selectedAction=await ctx.ui.select('보류된 보고 처리',options);
    if(!selectedAction||selectedAction==='나중에 확인')return;
    if(ctx.sessionManager.getSessionId()!==owner.sessionId ||
       ctx.sessionManager.getLeafId()!==leaf||!ctx.isIdle()){
      ctx.ui.notify('Main 분기가 변경됐습니다. 다시 확인해주세요.','warning');return;
    }
    if(selectedAction==='보관함에서 숨기기'){
      await setInboxStatus(owner.sessionId,item.pkg.id,'archived',leaf);
      return;
    }
    if(!item.pkg.approvedMainBrief)return;
    // Explicit exception override: user chooses this branch. Never edits policy.
    await setInboxStatus(owner.sessionId,item.pkg.id,'import-requested',leaf);
    requestImport(pi,owner.sessionId,item.pkg,leaf,false);
    ctx.ui.notify('Work 참고 보고의 현재 분기 기록을 요청했습니다. 실제 Pi receipt 확인 전에는 완료가 아닙니다.','info');
  }finally{
    const warning=await zoom.close();
    if(warning&&ctx.hasUI)ctx.ui.notify(warning,'warning');
  }
}

export function registerMainContextImportReceipts(pi:ExtensionAPI):void{
  pi.on('message_end',async(event,ctx)=>{
    const msg=event.message;
    if(msg.role!=='custom'||msg.customType!==IMPORT_TYPE||!msg.details||
       typeof msg.details!=='object'||Array.isArray(msg.details))return;
    const d=msg.details as Record<string,unknown>;
    const mainId=ctx.sessionManager.getSessionId();
    if(d.mainSessionId!==mainId||typeof d.packageId!=='string')return;
    try{
      await setInboxStatus(mainId,d.packageId,'imported',
        typeof d.comparedLeafId==='string'?d.comparedLeafId:undefined);
      if(ctx.hasUI&&d.automaticReferenceImport===true)
        ctx.ui.notify('Work 승인 Brief를 출처가 있는 참고 보고로 기록했습니다. 정책 승인이나 모델 실행이 아닙니다.','info');
    }catch(error){
      if(ctx.hasUI)ctx.ui.notify('수신 기록 확인 실패, 재개 시 복구: '+String(error),'warning');
    }
  });
}

/**
 * The Work user approved the exact body. Deterministic transport and ancestry
 * checks ONLY: never call a model to rejudge Work's implementation or policies.
 */
export function registerAutomaticMainAdoption(pi:ExtensionAPI):{
  onAvailable:(ctx:ExtensionContext)=>void;
}{
  const processing=new Set<string>();
  const rerun=new Set<string>();
  let watcher:{id:string;close:()=>void}|undefined;
  let epoch=0;
  const closeWatcher=()=>{epoch++;watcher?.close();watcher=undefined;};
  async function check(ctx:ExtensionContext):Promise<void>{
    const owner=mainOwner(ctx);
    if(!ctx.isIdle()||!owner)return;
    const mainId=owner.sessionId;
    if(processing.has(mainId)){rerun.add(mainId);return;}
    processing.add(mainId);
    try{
      const items=(await listInbox(mainId)).filter(item=>
        item.pkg.product===owner.product &&
        (item.status.status==='pending'||item.status.status==='import-requested'));
      for(const item of items){
        if(!ctx.isIdle()||ctx.sessionManager.getSessionId()!==mainId)break;
        const pkg=item.pkg;
        if(hasImportReceipt(ctx,pkg.id)){
          await setInboxStatus(mainId,pkg.id,'imported');
          continue;
        }
        const leaf=ctx.sessionManager.getLeafId();
        if(!leaf)break;
        const ids=new Set(ctx.sessionManager.getBranch().map(e=>e.id));
        if(item.status.status==='import-requested' &&
            (!item.status.comparedLeafId||!ids.has(item.status.comparedLeafId)))continue;
        if(hasImportedIdenticalWorkBrief(ctx,pkg)){
          await setInboxStatus(mainId,pkg.id,'duplicate',leaf);continue;
        }
        let lineage=false;
        try{lineage=await workOriginOnMainBranch(pkg,mainId,ids);}
        catch(error){
          if(ctx.hasUI)ctx.ui.notify('Work 계보 조회 오류: '+String(error),'warning');
          break; // durable pending, not a user policy conflict
        }
        const decision=decideDirectReferenceImport(pkg,mainId,lineage);
        if(decision.action==='hold'){
          await setInboxStatus(mainId,pkg.id,'requires-review',leaf);
          if(ctx.hasUI)ctx.ui.notify(
            'Work 보고의 대상 분기 또는 승인 본문을 확인해야 합니다. Main < 에서 확인할 수 있습니다.',
            'warning');
          continue;
        }
        if(ctx.sessionManager.getSessionId()!==mainId||
           ctx.sessionManager.getLeafId()!==leaf||!ctx.isIdle())break;
        await setInboxStatus(mainId,pkg.id,'import-requested',leaf);
        requestImport(pi,mainId,pkg,leaf,true);
      }
    }catch(error){
      if(ctx.hasUI)ctx.ui.notify('Work 보고 자동 수신 실패, 원본 보존: '+String(error),'warning');
    }finally{
      processing.delete(mainId);
      if(ctx.hasUI&&ctx.sessionManager.getSessionId()===mainId){
        try{
          const held=(await listInbox(mainId)).filter(x=>x.status.status==='requires-review').length;
          ctx.ui.setWidget('pi-compose/main-inbox',held
            ?['Main · 예외 확인이 필요한 Work 보고 '+held+'건 · < 로 확인']:undefined);
        }catch{/* durable source remains in the inbox */}
      }
      if(rerun.delete(mainId)&&ctx.isIdle()&&ctx.sessionManager.getSessionId()===mainId)
        void check(ctx);
    }
  }
  const onAvailable=(ctx:ExtensionContext)=>{void check(ctx);};
  async function activate(ctx:ExtensionContext){
    const owner=mainOwner(ctx);
    if(!owner){closeWatcher();return;}
    if(watcher?.id===owner.sessionId){onAvailable(ctx);return;}
    closeWatcher();
    const current=epoch;
    try{
      const close=await watchHandoffPackages(owner.sessionId,()=>{
        if(ctx.sessionManager.getSessionId()===owner.sessionId)onAvailable(ctx);
      });
      if(epoch!==current||ctx.sessionManager.getSessionId()!==owner.sessionId){
        close();return;
      }
      watcher={id:owner.sessionId,close};
    }catch(error){
      if(ctx.hasUI)ctx.ui.notify('Handoff 자동 감시 불가. Main 재개 시 복구합니다: '+String(error),'warning');
    }
    onAvailable(ctx);
  }
  pi.on('session_start',(_e,ctx)=>{void activate(ctx);});
  pi.on('session_tree',(_e,ctx)=>{void activate(ctx);});
  pi.on('agent_settled',(_e,ctx)=>onAvailable(ctx));
  pi.on('session_before_switch',()=>closeWatcher());
  pi.on('session_shutdown',()=>closeWatcher());
  return {onAvailable};
}
